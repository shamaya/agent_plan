"""Agent 业务层：CRUD + 对话管理 + 版本快照 + 导入导出。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Agent, Conversation, Message, AgentVersion, Skill, McpServer, KnowledgeBase, Model, ConstraintProfile
from app.modules.agent.schemas import (
    AgentCreate, AgentUpdate, AgentRead,
    ConversationRead, MessageRead,
    AgentVersionRead, AgentExport,
)


def _agent_to_read(a: Agent, session: Session | None = None) -> AgentRead:
    version = 1
    if session is not None:
        latest = session.exec(
            select(AgentVersion).where(AgentVersion.agent_id == a.id)
            .order_by(AgentVersion.version.desc())
        ).first()
        if latest:
            version = latest.version
    return AgentRead(
        id=a.id, name=a.name, system_prompt=a.system_prompt,
        model_id=a.model_id, skill_ids=a.skill_ids or [],
        mcp_server_ids=a.mcp_server_ids or [], kb_ids=a.kb_ids or [],
        constraint_profile_id=a.constraint_profile_id,
        context_config=a.context_config or {}, version=version,
        created_at=a.created_at,
    )


def list_agents(session: Session) -> list[AgentRead]:
    rows = session.exec(select(Agent).order_by(Agent.id)).all()
    return [_agent_to_read(a, session) for a in rows]


def get_agent(session: Session, agent_id: int) -> Optional[AgentRead]:
    a = session.get(Agent, agent_id)
    return _agent_to_read(a, session) if a else None


def create_agent(session: Session, data: AgentCreate) -> AgentRead:
    a = Agent(
        name=data.name, system_prompt=data.system_prompt,
        model_id=data.model_id, skill_ids=data.skill_ids,
        mcp_server_ids=data.mcp_server_ids, kb_ids=data.kb_ids,
        constraint_profile_id=data.constraint_profile_id,
        context_config=data.context_config,
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    _save_version(session, a.id, note="初始版本")
    logger.info(f"创建 agent id={a.id} name={a.name}")
    return _agent_to_read(a, session)


def update_agent(session: Session, agent_id: int, data: AgentUpdate) -> Optional[AgentRead]:
    a = session.get(Agent, agent_id)
    if not a:
        return None
    if data.name is not None:
        a.name = data.name
    if data.system_prompt is not None:
        a.system_prompt = data.system_prompt
    if data.model_id is not None:
        a.model_id = data.model_id
    if data.skill_ids is not None:
        a.skill_ids = data.skill_ids
    if data.mcp_server_ids is not None:
        a.mcp_server_ids = data.mcp_server_ids
    if data.kb_ids is not None:
        a.kb_ids = data.kb_ids
    if data.constraint_profile_id is not None:
        a.constraint_profile_id = data.constraint_profile_id
    if data.context_config is not None:
        a.context_config = data.context_config
    session.add(a)
    session.commit()
    session.refresh(a)
    logger.info(f"更新 agent id={agent_id}")
    return _agent_to_read(a, session)


def delete_agent(session: Session, agent_id: int) -> bool:
    a = session.get(Agent, agent_id)
    if not a:
        return False
    # 删版本快照
    versions = session.exec(
        select(AgentVersion).where(AgentVersion.agent_id == agent_id)
    ).all()
    for v in versions:
        session.delete(v)
    session.delete(a)
    session.commit()
    logger.info(f"删除 agent id={agent_id}")
    return True


# ===== 版本管理 =====
def _save_version(session: Session, agent_id: int, note: str = "") -> AgentVersion:
    """保存当前 agent 快照为新版本。"""
    a = session.get(Agent, agent_id)
    if not a:
        return None
    latest = session.exec(
        select(AgentVersion).where(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version.desc())
    ).first()
    next_ver = (latest.version + 1) if latest else 1
    snap = {
        "name": a.name, "system_prompt": a.system_prompt,
        "model_id": a.model_id, "skill_ids": a.skill_ids or [],
        "mcp_server_ids": a.mcp_server_ids or [], "kb_ids": a.kb_ids or [],
        "constraint_profile_id": a.constraint_profile_id,
        "context_config": a.context_config or {},
    }
    v = AgentVersion(agent_id=agent_id, version=next_ver, snapshot=snap, note=note)
    session.add(v)
    session.commit()
    session.refresh(v)
    logger.info(f"agent id={agent_id} 保存版本 v{next_ver}")
    return v


def save_version(session: Session, agent_id: int, note: str = "") -> Optional[AgentVersionRead]:
    v = _save_version(session, agent_id, note)
    if not v:
        return None
    return AgentVersionRead(
        id=v.id, agent_id=v.agent_id, version=v.version,
        snapshot=v.snapshot or {}, note=v.note, created_at=v.created_at,
    )


def list_versions(session: Session, agent_id: int) -> list[AgentVersionRead]:
    rows = session.exec(
        select(AgentVersion).where(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version.desc())
    ).all()
    return [AgentVersionRead(
        id=v.id, agent_id=v.agent_id, version=v.version,
        snapshot=v.snapshot or {}, note=v.note, created_at=v.created_at,
    ) for v in rows]


def rollback_version(session: Session, agent_id: int, version_id: int) -> Optional[AgentRead]:
    """回滚到指定版本：用快照覆盖当前 agent，并生成新版本记录。"""
    a = session.get(Agent, agent_id)
    if not a:
        return None
    v = session.get(AgentVersion, version_id)
    if not v or v.agent_id != agent_id:
        return None
    snap = v.snapshot or {}
    a.name = snap.get("name", a.name)
    a.system_prompt = snap.get("system_prompt", a.system_prompt)
    a.model_id = snap.get("model_id")
    a.skill_ids = snap.get("skill_ids", [])
    a.mcp_server_ids = snap.get("mcp_server_ids", [])
    a.kb_ids = snap.get("kb_ids", [])
    a.constraint_profile_id = snap.get("constraint_profile_id")
    a.context_config = snap.get("context_config", {})
    session.add(a)
    session.commit()
    session.refresh(a)
    _save_version(session, agent_id, note=f"回滚到 v{v.version}")
    logger.info(f"agent id={agent_id} 回滚到版本 v{v.version}")
    return _agent_to_read(a, session)


# ===== 导入导出 =====
def export_agent(session: Session, agent_id: int) -> Optional[AgentExport]:
    a = session.get(Agent, agent_id)
    if not a:
        return None
    # 按名称解析关联实体
    skill_names = []
    for sid in (a.skill_ids or []):
        s = session.get(Skill, sid)
        if s:
            skill_names.append(s.name)
    mcp_names = []
    for mid in (a.mcp_server_ids or []):
        m = session.get(McpServer, mid)
        if m:
            mcp_names.append(m.name)
    kb_names = []
    for kid in (a.kb_ids or []):
        k = session.get(KnowledgeBase, kid)
        if k:
            kb_names.append(k.name)
    model_name = ""
    if a.model_id:
        m = session.get(Model, a.model_id)
        if m:
            model_name = m.model_name
    profile_name = ""
    if a.constraint_profile_id:
        p = session.get(ConstraintProfile, a.constraint_profile_id)
        if p:
            profile_name = p.name
    return AgentExport(
        name=a.name, system_prompt=a.system_prompt,
        model_name=model_name, skill_names=skill_names,
        mcp_server_names=mcp_names, kb_names=kb_names,
        constraint_profile_name=profile_name,
        context_config=a.context_config or {},
    )


def import_agent(session: Session, data: AgentExport) -> AgentRead:
    """导入 Agent：按名称匹配 model/skill/mcp/kb/profile，找不到则留空。"""
    # model
    model_id = None
    if data.model_name:
        m = session.exec(
            select(Model).where(Model.model_name == data.model_name)
        ).first()
        model_id = m.id if m else None
    # skills
    skill_ids = []
    for name in data.skill_names:
        s = session.exec(select(Skill).where(Skill.name == name)).first()
        if s:
            skill_ids.append(s.id)
    # mcp servers
    mcp_ids = []
    for name in data.mcp_server_names:
        m = session.exec(select(McpServer).where(McpServer.name == name)).first()
        if m:
            mcp_ids.append(m.id)
    # knowledge bases
    kb_ids = []
    for name in data.kb_names:
        k = session.exec(select(KnowledgeBase).where(KnowledgeBase.name == name)).first()
        if k:
            kb_ids.append(k.id)
    # constraint profile
    profile_id = None
    if data.constraint_profile_name:
        p = session.exec(
            select(ConstraintProfile).where(ConstraintProfile.name == data.constraint_profile_name)
        ).first()
        profile_id = p.id if p else None

    a = Agent(
        name=data.name, system_prompt=data.system_prompt,
        model_id=model_id, skill_ids=skill_ids,
        mcp_server_ids=mcp_ids, kb_ids=kb_ids,
        constraint_profile_id=profile_id,
        context_config=data.context_config,
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    _save_version(session, a.id, note="导入版本")
    logger.info(f"导入 agent id={a.id} name={a.name}")
    return _agent_to_read(a, session)


def get_or_create_conversation(session: Session, agent_id: int,
                                conv_id: int | None, title: str = "") -> Optional[Conversation]:
    """取已有对话或新建。"""
    if conv_id:
        c = session.get(Conversation, conv_id)
        if c and c.agent_id == agent_id:
            return c
        return None
    c = Conversation(agent_id=agent_id, title=title or "新对话")
    session.add(c)
    session.commit()
    session.refresh(c)
    return c


def list_conversations(session: Session, agent_id: int | None = None) -> list[ConversationRead]:
    stmt = select(Conversation).order_by(Conversation.id.desc())
    if agent_id is not None:
        stmt = stmt.where(Conversation.agent_id == agent_id)
    rows = session.exec(stmt).all()
    return [ConversationRead(
        id=c.id, agent_id=c.agent_id, title=c.title, summary=c.summary,
        compression_state=c.compression_state or {},
        created_at=c.created_at, updated_at=c.updated_at,
    ) for c in rows]


def list_messages(session: Session, conv_id: int) -> list[MessageRead]:
    rows = session.exec(
        select(Message).where(Message.conversation_id == conv_id)
        .order_by(Message.id)
    ).all()
    return [MessageRead(
        id=m.id, conversation_id=m.conversation_id, role=m.role,
        content=m.content or "", tool_calls=m.tool_calls or [],
        tool_results=m.tool_results or [], token_count=m.token_count,
        is_compressed_summary=m.is_compressed_summary, created_at=m.created_at,
    ) for m in rows]


def delete_conversation(session: Session, conv_id: int) -> bool:
    """删除对话及其消息、trace。"""
    c = session.get(Conversation, conv_id)
    if not c:
        return False
    from app.db.models import Trace
    msgs = session.exec(select(Message).where(Message.conversation_id == conv_id)).all()
    for m in msgs:
        session.delete(m)
    traces = session.exec(select(Trace).where(Trace.conversation_id == conv_id)).all()
    for t in traces:
        session.delete(t)
    session.delete(c)
    session.commit()
    logger.info(f"删除对话 id={conv_id}")
    return True
