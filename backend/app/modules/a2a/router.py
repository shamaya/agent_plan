"""A2A Protocol 路由：Agent Card + 任务接入。

端点（prefix=/a2a）：
  GET    /a2a/agents                              列出所有 A2A 可见 Agent（轻量名片）
  GET    /a2a/agents/{agent_id}/card             单个 Agent 的完整 Card
  POST   /a2a/agents/{agent_id}/tasks/send       同步发送任务
  POST   /a2a/agents/{agent_id}/tasks/sendSubscribe  SSE 流式订阅任务
  GET    /a2a/tasks/{task_id}                     查询任务状态
  POST   /a2a/tasks/{task_id}/cancel              取消任务

认证：X-API-Key Header（复用 ApiKey 表；若目标 Agent 标记公开则无需 key）。
"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.logging import logger
from app.db.engine import engine, get_session
from app.db.models import Agent, ApiKey
from app.modules.apikey import service as apikey_service
from app.modules.apikey.auth import get_api_key_principal
from app.modules.agent import service as agent_service, loop as agent_loop
from app.modules.openapi import service as openapi_service
from app.modules.provider.service import get_active_model

router = APIRouter()


# ===== 请求 / 响应模型 =====
class A2ATaskRequest(BaseModel):
    """A2A 任务请求（兼容 JSON-RPC 风格 payload）。"""
    message: str = Field(..., description="任务消息内容")
    conversation_id: int | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    callback_url: str | None = None
    timeout: int = 120


class A2ATaskResponse(BaseModel):
    task_id: str
    status: str  # working | completed | failed | canceled
    content: str = ""
    tool_calls: list = Field(default_factory=list)
    conversation_id: int | None = None
    agent_id: int
    agent_name: str = ""


# ===== Agent Card =====
@router.get("/agents")
def list_a2a_agents(session: Session = Depends(get_session)):
    """列出所有 A2A 可见 Agent（轻量名片）。"""
    rows = session.exec(select(Agent).order_by(Agent.id)).all()
    return [
        {
            "id": a.id, "name": a.name,
            "description": (a.system_prompt or "")[:120],
            "has_tools": bool(a.mcp_server_ids),
            "has_skills": bool(a.skill_ids),
            "has_kb": bool(a.kb_ids),
        }
        for a in rows
    ]


@router.get("/agents/{agent_id}/card")
def get_agent_card(agent_id: int, request: Request,
                   session: Session = Depends(get_session)):
    """返回 A2A Agent Card（公开访问，无需 API Key）。"""
    agent = session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(404, "Agent 不存在")
    # 这里不查 request.app.state.session，直接用当前 session 查 skills
    skills_meta = []
    for sid in (agent.skill_ids or []):
        from app.db.models import Skill
        s = session.get(Skill, sid)
        if s:
            skills_meta.append({"id": s.id, "name": s.name, "category": s.category})
    base_url = str(request.base_url).rstrip("/")
    return {
        "name": agent.name,
        "description": agent.system_prompt[:200] if agent.system_prompt else "",
        "version": f"v{agent.id}",
        "capabilities": {
            "streaming": True,
            "tools": bool(agent.mcp_server_ids),
            "knowledge": bool(agent.kb_ids),
            "skills": skills_meta,
        },
        "endpoints": {
            "card": f"{base_url}/a2a/agents/{agent.id}/card",
            "send": f"{base_url}/a2a/agents/{agent.id}/tasks/send",
            "sendSubscribe": f"{base_url}/a2a/agents/{agent.id}/tasks/sendSubscribe",
        },
        "authentication": {
            "type": "api_key",
            "header": "X-API-Key",
            "note": "在 /apikeys 页创建 ApiKey 并授权本 Agent",
        },
    }


# ===== 任务端点 =====
@router.post("/agents/{agent_id}/tasks/send")
async def send_task(agent_id: int, req: A2ATaskRequest,
                    principal: ApiKey = Depends(get_api_key_principal)):
    """同步发送任务：阻塞至完成，返回最终结果。"""
    with Session(engine, expire_on_commit=False) as session:
        agent = session.get(Agent, agent_id)
        if not agent:
            raise HTTPException(404, "Agent 不存在")
        if not apikey_service.can_access_agent(principal, agent_id):
            raise HTTPException(403, "此 API Key 无权调用该 Agent")

        conv = agent_service.get_or_create_conversation(
            session, agent_id, req.conversation_id,
            title=f"[A2A] {req.message[:30]}",
        )
        if conv is None:
            raise HTTPException(400, "conversation_id 不属于该 Agent")

        if req.callback_url:
            # 异步 webhook 模式
            task_id = uuid.uuid4().hex
            asyncio.create_task(_run_webhook_with_session(
                agent_id, req, conv.id, task_id,
            ))
            return A2ATaskResponse(
                task_id=task_id, status="working",
                conversation_id=conv.id, agent_id=agent_id, agent_name=agent.name,
            )

        # 同步模式
        timeout = min(req.timeout, 300)
        task_id = uuid.uuid4().hex
        try:
            result = await asyncio.wait_for(
                _invoke_sync_collect(agent, req.message, conv, session, req.variables),
                timeout=timeout,
            )
            openapi_service.set_task_status(task_id, {
                "status": "completed", "content": result["content"],
                "conversation_id": conv.id, "agent_id": agent_id,
            })
            return A2ATaskResponse(
                task_id=task_id, status="completed",
                content=result["content"],
                tool_calls=result.get("tool_calls", []),
                conversation_id=conv.id, agent_id=agent_id, agent_name=agent.name,
            )
        except asyncio.TimeoutError:
            openapi_service.set_task_status(task_id, {"status": "failed", "error": "timeout"})
            raise HTTPException(504, f"调用超时（{timeout}s）")
        except Exception as e:
            logger.exception(f"A2A send 失败: {e}")
            openapi_service.set_task_status(task_id, {"status": "failed", "error": str(e)})
            raise HTTPException(500, f"调用失败：{e}")


@router.post("/agents/{agent_id}/tasks/sendSubscribe")
async def send_subscribe(agent_id: int, req: A2ATaskRequest,
                         principal: ApiKey = Depends(get_api_key_principal)):
    """SSE 流式订阅任务：流式返回 token + 工具调用 + 最终 done。"""
    with Session(engine, expire_on_commit=False) as session:
        agent = session.get(Agent, agent_id)
        if not agent:
            raise HTTPException(404, "Agent 不存在")
        if not apikey_service.can_access_agent(principal, agent_id):
            raise HTTPException(403, "此 API Key 无权调用该 Agent")

        conv = agent_service.get_or_create_conversation(
            session, agent_id, req.conversation_id,
            title=f"[A2A-SSE] {req.message[:30]}",
        )
        if conv is None:
            raise HTTPException(400, "conversation_id 不属于该 Agent")

        task_id = uuid.uuid4().hex
        openapi_service.set_task_status(task_id, {
            "status": "working", "conversation_id": conv.id, "agent_id": agent_id,
        })

    async def event_gen():
        from app.llm.stream import sse_event, done_event, error_event
        from app.db.models import Conversation
        # 新建 session（StreamingResponse 跨 generator 生命周期）
        with Session(engine, expire_on_commit=False) as session:
            agent = session.get(Agent, agent_id)
            conv = session.get(Conversation, conv.id)
            if not agent or not conv:
                yield error_event("agent 或 conversation 不存在")
                return
            yield sse_event("task", {"task_id": task_id, "status": "working"})
            try:
                async for sse_str in agent_loop.run_agent(agent, req.message, conv, session):
                    yield sse_str
                openapi_service.set_task_status(task_id, {
                    "status": "completed", "conversation_id": conv.id,
                })
            except Exception as e:
                yield error_event(str(e))
                openapi_service.set_task_status(task_id, {
                    "status": "failed", "error": str(e),
                })

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/tasks/{task_id}")
def get_task_status(task_id: str,
                   principal: ApiKey = Depends(get_api_key_principal)):
    """查询 A2A 任务状态（复用 openapi 内存任务表）。"""
    status = openapi_service.get_task_status(task_id)
    if not status:
        raise HTTPException(404, "任务不存在或已过期")
    return status


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str,
                principal: ApiKey = Depends(get_api_key_principal)):
    """取消 A2A 任务（简化实现：仅标记状态，不中断运行中的 LLM 调用）。"""
    status = openapi_service.get_task_status(task_id)
    if not status:
        raise HTTPException(404, "任务不存在或已过期")
    if status.get("status") in ("completed", "failed", "canceled"):
        raise HTTPException(409, f"任务已处于终态：{status['status']}")
    openapi_service.set_task_status(task_id, {"status": "canceled"})
    return {"task_id": task_id, "status": "canceled"}


# ===== 内部辅助 =====
async def _invoke_sync_collect(agent: Agent, message: str, conv,
                                session: Session, variables: dict) -> dict:
    """同步调用 agent loop 并收集最终内容 + tool_calls。"""
    content_parts: list[str] = []
    tool_calls: list[dict] = []
    async for sse_str in agent_loop.run_agent(agent, message, conv, session):
        # 解析 sse_str 取 token + tool_call
        if not sse_str.startswith("data: "):
            continue
        try:
            evt = json.loads(sse_str[6:])
        except Exception:
            continue
        if evt.get("type") == "token":
            content_parts.append(evt.get("text", ""))
        elif evt.get("type") == "tool_call":
            tool_calls.append({"name": evt.get("tool"), "args": evt.get("args", {})})
        elif evt.get("type") == "done":
            final = evt.get("final", "")
            if final and not content_parts:
                content_parts.append(final)
        elif evt.get("type") == "error":
            raise RuntimeError(evt.get("message", "未知错误"))
    return {"content": "".join(content_parts), "tool_calls": tool_calls}


async def _run_webhook_with_session(agent_id: int, req: A2ATaskRequest,
                                      conv_id: int, task_id: str) -> None:
    """Webhook 后台任务：独立 session 执行 + 回调。"""
    import json
    import urllib.request
    with Session(engine, expire_on_commit=False) as session:
        from app.db.models import Conversation
        agent = session.get(Agent, agent_id)
        conv = session.get(Conversation, conv_id)
        if not agent or not conv:
            return
        openapi_service.set_task_status(task_id, {
            "status": "working", "conversation_id": conv_id, "agent_id": agent_id,
        })
        try:
            result = await _invoke_sync_collect(agent, req.message, conv, session, req.variables)
            openapi_service.set_task_status(task_id, {
                "status": "completed", "content": result["content"],
                "conversation_id": conv_id, "agent_id": agent_id,
            })
            payload = {
                "task_id": task_id, "status": "completed",
                "content": result["content"], "agent_id": agent_id,
            }
        except Exception as e:
            openapi_service.set_task_status(task_id, {"status": "failed", "error": str(e)})
            payload = {"task_id": task_id, "status": "failed", "error": str(e)}
        # 回调通知
        if req.callback_url:
            try:
                req_body = json.dumps(payload).encode()
                r = urllib.request.Request(
                    req.callback_url, data=req_body,
                    headers={"Content-Type": "application/json"}, method="POST",
                )
                urllib.request.urlopen(r, timeout=30).read()
            except Exception as e:
                logger.warning(f"A2A webhook 回调失败 {req.callback_url}: {e}")
