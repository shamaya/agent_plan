"""Agent 路由：CRUD + 版本 + 导入导出 + SSE 对话 + 对话/消息查询。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.db.engine import get_session, engine
from app.db.models import Agent
from app.modules.agent import service, loop
from app.modules.agent.schemas import (
    AgentCreate, AgentUpdate, AgentRead,
    ChatRequest, ConversationRead, MessageRead,
    AgentExport, AgentVersionRead, AgentVersionCreate,
)

router = APIRouter(tags=["agent"])


# ===== Agent CRUD =====
@router.get("/agents", response_model=list[AgentRead])
def list_agents(session: Session = Depends(get_session)):
    return service.list_agents(session)


@router.post("/agents", response_model=AgentRead)
def create_agent(data: AgentCreate, session: Session = Depends(get_session)):
    return service.create_agent(session, data)


@router.get("/agents/{agent_id}", response_model=AgentRead)
def get_agent(agent_id: int, session: Session = Depends(get_session)):
    a = service.get_agent(session, agent_id)
    if not a:
        raise HTTPException(404, "agent 不存在")
    return a


@router.put("/agents/{agent_id}", response_model=AgentRead)
def update_agent(agent_id: int, data: AgentUpdate, session: Session = Depends(get_session)):
    a = service.update_agent(session, agent_id, data)
    if not a:
        raise HTTPException(404, "agent 不存在")
    return a


@router.delete("/agents/{agent_id}")
def delete_agent(agent_id: int, session: Session = Depends(get_session)):
    if not service.delete_agent(session, agent_id):
        raise HTTPException(404, "agent 不存在")
    return {"ok": True}


# ===== 版本管理 =====
@router.post("/agents/{agent_id}/versions", response_model=AgentVersionRead)
def save_version(agent_id: int, data: AgentVersionCreate, session: Session = Depends(get_session)):
    """保存当前配置为新版本快照。"""
    v = service.save_version(session, agent_id, data.note)
    if not v:
        raise HTTPException(404, "agent 不存在")
    return v


@router.get("/agents/{agent_id}/versions", response_model=list[AgentVersionRead])
def list_versions(agent_id: int, session: Session = Depends(get_session)):
    return service.list_versions(session, agent_id)


@router.post("/agents/{agent_id}/versions/{version_id}/rollback", response_model=AgentRead)
def rollback_version(agent_id: int, version_id: int, session: Session = Depends(get_session)):
    a = service.rollback_version(session, agent_id, version_id)
    if not a:
        raise HTTPException(404, "agent 或版本不存在")
    return a


# ===== 导入导出 =====
@router.get("/agents/{agent_id}/export", response_model=AgentExport)
def export_agent(agent_id: int, session: Session = Depends(get_session)):
    e = service.export_agent(session, agent_id)
    if not e:
        raise HTTPException(404, "agent 不存在")
    return e


@router.post("/agents/import", response_model=AgentRead)
def import_agent(data: AgentExport, session: Session = Depends(get_session)):
    return service.import_agent(session, data)


# ===== SSE 对话 =====
@router.post("/agents/{agent_id}/chat")
async def chat(agent_id: int, req: ChatRequest):
    """SSE 流式对话。返回 StreamingResponse。

    关键：不用 Depends(get_session) 的 session——FastAPI 在 endpoint 返回后会清理依赖、
    关闭 session，导致 async generator 内 agent 对象 detached 触发 DetachedInstanceError。
    改为在 generator 内自建 session（expire_on_commit=False），贯穿整个流式生命周期。
    """
    from app.llm.stream import sse_event, error_event

    async def event_gen():
        with Session(engine, expire_on_commit=False) as session:
            agent = session.get(Agent, agent_id)
            if not agent:
                yield error_event("agent 不存在")
                return
            conv = service.get_or_create_conversation(
                session, agent_id, req.conversation_id, title=req.message[:30]
            )
            if conv is None:
                yield error_event("对话不存在或不属于该 agent")
                return
            # 首个事件回传会话 id（前端首次发消息 conversation_id=null，需回传以续接）
            yield sse_event("session", {"conversation_id": conv.id, "agent_id": agent_id})
            async for sse_str in loop.run_agent(agent, req.message, conv, session):
                yield sse_str

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ===== 对话 / 消息 =====
@router.get("/conversations", response_model=list[ConversationRead])
def list_conversations(agent_id: int | None = None, session: Session = Depends(get_session)):
    return service.list_conversations(session, agent_id)


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageRead])
def list_messages(conv_id: int, session: Session = Depends(get_session)):
    return service.list_messages(session, conv_id)


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, session: Session = Depends(get_session)):
    if not service.delete_conversation(session, conv_id):
        raise HTTPException(404, "对话不存在")
    return {"ok": True}
