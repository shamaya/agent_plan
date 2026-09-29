"""开放 API 业务层：参数注入 + 同步调用 + Webhook 回调。

复用 agent loop.run_agent（async generator），消费其 SSE 流提取最终结果。
参数注入：在离线 Agent 实例（不写库）上覆写 system_prompt，做 {{var}} 模板变量替换。
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any

import httpx
from sqlmodel import Session

from app.core.logging import logger
from app.db.engine import engine
from app.db.models import Agent, ApiKey, Conversation
from app.modules.apikey.schemas import ApiKeyInvoke
from app.modules.agent import loop, service as agent_service
from app.llm.stream import sse_event  # noqa: F401  仅为引用格式

# 内存任务表（简化版，不持久化；进程重启即丢失）
_tasks: dict[str, dict] = {}


def _clone_agent_with_vars(agent: Agent, variables: dict[str, Any]) -> Agent:
    """创建离线 Agent 实例（不入库），覆写 system_prompt 做模板变量替换。"""
    prompt = agent.system_prompt or ""
    for k, v in (variables or {}).items():
        prompt = prompt.replace("{{" + str(k) + "}}", str(v))
    return Agent(
        id=agent.id,
        name=agent.name,
        system_prompt=prompt,
        model_id=agent.model_id,
        skill_ids=agent.skill_ids or [],
        mcp_server_ids=agent.mcp_server_ids or [],
        kb_ids=agent.kb_ids or [],
        constraint_profile_id=agent.constraint_profile_id,
        context_config=agent.context_config or {},
        created_at=agent.created_at,
    )


async def invoke_sync(agent: Agent, user_msg: str, conv: Conversation,
                      session: Session, variables: dict[str, Any]) -> dict:
    """同步调用 agent，收集最终结果。复用 run_agent SSE 流。"""
    agent_clone = _clone_agent_with_vars(agent, variables)
    final_content = ""
    tool_calls: list[dict] = []
    error_msg = ""
    async for sse_str in loop.run_agent(agent_clone, user_msg, conv, session):
        # sse_str 格式：data: {json}\n\n
        try:
            payload = json.loads(sse_str.removeprefix("data: "))
        except Exception:
            continue
        t = payload.get("type")
        if t == "done":
            final_content = payload.get("final", "")
        elif t == "tool_call":
            tool_calls.append({"tool": payload.get("tool"), "args": payload.get("args")})
        elif t == "error":
            error_msg = payload.get("message", "")
    return {
        "content": final_content,
        "tool_calls": tool_calls,
        "conversation_id": conv.id,
        "error": error_msg,
    }


async def invoke_webhook(agent: Agent, req: ApiKeyInvoke, conv: Conversation,
                         session: Session, task_id: str, callback_url: str) -> None:
    """后台执行调用，完成后 POST 结果到 callback_url。"""
    try:
        result = await asyncio.wait_for(
            invoke_sync(agent, req.message, conv, session, req.variables),
            timeout=req.timeout,
        )
        result["task_id"] = task_id
        result["status"] = "completed"
        _tasks[task_id] = result
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(callback_url, json=result)
        logger.info(f"webhook 回调完成 task={task_id}")
    except asyncio.TimeoutError:
        _tasks[task_id] = {"task_id": task_id, "status": "timeout"}
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(callback_url, json={"task_id": task_id, "status": "timeout"})
    except Exception as e:
        _tasks[task_id] = {"task_id": task_id, "status": "error", "error": str(e)}
        logger.exception(f"webhook 任务失败 task={task_id}: {e}")


def get_task_status(task_id: str) -> dict | None:
    return _tasks.get(task_id)
