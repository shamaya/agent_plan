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
    AgentWorkerCreate, AgentWorkerRead,
    AgentMemoryCreate, AgentMemoryUpdate, AgentMemoryRead,
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
            async for sse_str in loop.run_agent(agent, req.message, conv, session, images=req.images):
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


# ===== 多智能体协同（Worker 池）=====
@router.get("/agents/{agent_id}/workers", response_model=list[AgentWorkerRead])
def list_workers(agent_id: int, session: Session = Depends(get_session)):
    """列出 Agent 的 Worker 池。表为空时表示 Auto 模式（可委托任意 Agent）。"""
    return service.list_workers(session, agent_id)


@router.post("/agents/{agent_id}/workers", response_model=AgentWorkerRead)
def add_worker(agent_id: int, data: AgentWorkerCreate, session: Session = Depends(get_session)):
    """添加 Worker。有 Worker 池后切换为 Managed 模式。"""
    try:
        return service.add_worker(session, agent_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/agents/{agent_id}/workers/{worker_row_id}")
def remove_worker(agent_id: int, worker_row_id: int, session: Session = Depends(get_session)):
    """移除 Worker。Worker 池清空后回到 Auto 模式。"""
    if not service.remove_worker(session, agent_id, worker_row_id):
        raise HTTPException(404, "Worker 关联不存在")
    return {"ok": True}


# ===== HITL 审批 =====
from app.modules.agent.approval import approval_manager
from pydantic import BaseModel


class ApprovalDecision(BaseModel):
    approved: bool
    reason: str = ""


@router.post("/approvals/{approval_id}")
def resolve_approval(approval_id: str, body: ApprovalDecision):
    """前端提交审批结果（批准/拒绝）。"""
    ok = approval_manager.resolve(approval_id, body.approved, body.reason)
    if not ok:
        raise HTTPException(404, "审批不存在或已处理")
    return {"ok": True}


# ===== 长期记忆 =====
from app.modules.agent import memory as memory_service


@router.get("/agents/{agent_id}/memories", response_model=list[AgentMemoryRead])
def list_memories(agent_id: int, session: Session = Depends(get_session)):
    """列出 Agent 的所有长期记忆。"""
    return memory_service.list_memories(session, agent_id)


@router.post("/agents/{agent_id}/memories", response_model=AgentMemoryRead)
def create_memory(agent_id: int, data: AgentMemoryCreate, session: Session = Depends(get_session)):
    """手动新增一条记忆。"""
    return memory_service.create_memory(
        session, agent_id, data.content, data.memory_type,
        data.importance, data.metadata,
    )


@router.put("/agents/{agent_id}/memories/{memory_id}", response_model=AgentMemoryRead)
def update_memory(agent_id: int, memory_id: int, data: AgentMemoryUpdate,
                  session: Session = Depends(get_session)):
    """编辑记忆内容/类型/重要度。"""
    m = memory_service.update_memory(
        session, memory_id, data.content, data.importance, data.memory_type,
    )
    if not m:
        raise HTTPException(404, "记忆不存在")
    return m


@router.delete("/agents/{agent_id}/memories/{memory_id}")
def delete_memory(agent_id: int, memory_id: int, session: Session = Depends(get_session)):
    """删除单条记忆。"""
    if not memory_service.delete_memory(session, memory_id):
        raise HTTPException(404, "记忆不存在")
    return {"ok": True}


@router.get("/agents/{agent_id}/memories/search")
def search_memories(agent_id: int, q: str, session: Session = Depends(get_session)):
    """按关键词检索记忆（返回匹配的记忆列表）。"""
    return memory_service.search_memories(session, agent_id, q, top_k=20)


@router.post("/agents/{agent_id}/memories/extract")
async def extract_memories(agent_id: int, session: Session = Depends(get_session)):
    """手动触发：从 Agent 最近对话中提取记忆。"""
    agent = session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(404, "agent 不存在")
    # 取最近 5 个对话的消息
    from app.db.models import Conversation, Message
    from sqlmodel import select as sel
    convs = session.exec(
        sel(Conversation).where(Conversation.agent_id == agent_id)
        .order_by(Conversation.id.desc()).limit(5)
    ).all()
    all_msgs: list[dict] = []
    for c in convs:
        msgs = session.exec(
            sel(Message).where(Message.conversation_id == c.id)
            .order_by(Message.id)
        ).all()
        all_msgs.extend({"role": m.role, "content": m.content} for m in msgs)
    if not all_msgs:
        return {"extracted": 0, "message": "暂无对话可提取"}
    saved = await memory_service.extract_memories(session, agent_id, all_msgs)
    return {"extracted": len(saved), "memories": saved}
