"""开放 API 端点（第三方接入，prefix=/api/v1）。

认证：X-API-Key Header（不走前端 X-Master-Key）。
端点：POST /agents/{agent_id}/invoke
  - 无 callback_url：同步返回 {content, tool_calls, conversation_id}
  - 有 callback_url：立即返回 {task_id, status:"processing"}，后台完成后 POST 到 callback_url
"""
from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db.engine import engine
from app.db.models import Agent, ApiKey
from app.modules.apikey.auth import get_api_key_principal
from app.modules.apikey import service as apikey_service
from app.modules.apikey.schemas import ApiKeyInvoke
from app.modules.agent import service as agent_service
from app.modules.openapi import service as openapi_service

router = APIRouter()


@router.post("/agents/{agent_id}/invoke")
async def invoke_agent(agent_id: int, req: ApiKeyInvoke,
                       principal: ApiKey = Depends(get_api_key_principal)):
    """第三方调用智能体。"""
    # 自建 session（避免 Depends session 在 Webhook task 跨请求生命周期失效）
    with Session(engine, expire_on_commit=False) as session:
        agent = session.get(Agent, agent_id)
        if not agent:
            raise HTTPException(404, "Agent 不存在")
        # 白名单校验
        if not apikey_service.can_access_agent(principal, agent_id):
            raise HTTPException(403, "此 API Key 无权调用该 Agent")

        # 新建/续接对话
        conv = agent_service.get_or_create_conversation(
            session, agent_id, req.conversation_id,
            title=f"[API] {req.message[:30]}",
        )
        if conv is None:
            raise HTTPException(400, "conversation_id 不属于该 Agent")

        # Webhook 模式：立即返回 task_id，后台执行
        if req.callback_url:
            task_id = uuid.uuid4().hex
            # 这里 session 在 with 块结束即关闭，webhook task 需独立 session
            asyncio.create_task(_run_webhook_with_session(
                agent_id, req, conv.id, task_id, req.callback_url,
            ))
            return {"task_id": task_id, "status": "processing", "conversation_id": conv.id}

        # 同步模式
        timeout = min(req.timeout, 300)
        try:
            result = await asyncio.wait_for(
                openapi_service.invoke_sync(agent, req.message, conv, session, req.variables),
                timeout=timeout,
            )
            return result
        except asyncio.TimeoutError:
            raise HTTPException(504, f"调用超时（{timeout}s）")
        except Exception as e:
            raise HTTPException(500, f"调用失败：{e}")


async def _run_webhook_with_session(agent_id: int, req: ApiKeyInvoke,
                                     conv_id: int, task_id: str, callback_url: str) -> None:
    """Webhook 后台任务：独立 session 执行调用 + 回调。"""
    from app.db.models import Conversation
    with Session(engine, expire_on_commit=False) as session:
        agent = session.get(Agent, agent_id)
        conv = session.get(Conversation, conv_id)
        if not agent or not conv:
            return
        await openapi_service.invoke_webhook(agent, req, conv, session, task_id, callback_url)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, principal: ApiKey = Depends(get_api_key_principal)):
    """查询 Webhook 任务状态（内存表，重启即丢）。"""
    status = openapi_service.get_task_status(task_id)
    if not status:
        raise HTTPException(404, "任务不存在或已过期")
    return status
