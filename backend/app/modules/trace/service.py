"""Trace 业务层：写 trace / 查 trace / 全局统计。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session, select

from app.db.models import (
    Trace, Conversation, Agent, Provider, Model, Skill,
    McpServer, McpTool, KnowledgeBase,
)
from app.modules.trace.schemas import TraceRead, Stats, ErrorGroup, TokenStats


def write_trace(session: Session, **fields) -> Trace:
    """写一条 trace 记录。"""
    t = Trace(**fields)
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


def _to_read(t: Trace) -> TraceRead:
    return TraceRead(
        id=t.id, conversation_id=t.conversation_id, agent_id=t.agent_id,
        iteration=t.iteration, step_type=t.step_type, tool_name=t.tool_name,
        input=t.input or {}, output=t.output or {}, latency_ms=t.latency_ms,
        token_in=t.token_in, token_out=t.token_out, status=t.status,
        error=t.error, created_at=t.created_at,
    )


def list_traces(session: Session, conv_id: int | None = None, limit: int = 200) -> list[TraceRead]:
    stmt = select(Trace).order_by(Trace.id.desc())
    if conv_id is not None:
        stmt = stmt.where(Trace.conversation_id == conv_id)
    rows = session.exec(stmt.limit(limit)).all()
    return [_to_read(t) for t in rows]


def get_trace(session: Session, trace_id: int) -> Optional[TraceRead]:
    t = session.get(Trace, trace_id)
    return _to_read(t) if t else None


def stats(session: Session) -> Stats:
    """全局统计：各表计数 + 近 10 条 trace + token/错误聚合。"""
    def _count(model_cls):
        return session.exec(select(model_cls)).all().__len__()

    recent = session.exec(select(Trace).order_by(Trace.id.desc()).limit(10)).all()
    # token / 错误 / 延迟统计
    all_traces = session.exec(select(Trace)).all()
    total_in = sum(t.token_in or 0 for t in all_traces)
    total_out = sum(t.token_out or 0 for t in all_traces)
    error_count = sum(1 for t in all_traces if t.status == "error")
    latencies = [t.latency_ms for t in all_traces if t.latency_ms > 0]
    avg_latency = sum(latencies) / len(latencies) if latencies else 0.0

    return Stats(
        providers=_count(Provider),
        models=_count(Model),
        skills=_count(Skill),
        mcp_servers=_count(McpServer),
        mcp_tools=_count(McpTool),
        knowledge_bases=_count(KnowledgeBase),
        agents=_count(Agent),
        conversations=_count(Conversation),
        traces=_count(Trace),
        recent_traces=[_to_read(t) for t in recent],
        total_token_in=total_in,
        total_token_out=total_out,
        error_count=error_count,
        avg_latency_ms=round(avg_latency, 1),
    )


def error_groups(session: Session, limit: int = 20) -> list[ErrorGroup]:
    """错误聚合：按错误消息前 60 字符分组，返回 Top N。"""
    rows = session.exec(
        select(Trace).where(Trace.status == "error").order_by(Trace.id.desc())
    ).all()
    groups: dict[str, dict] = {}
    for t in rows:
        key = (t.error or "未知错误")[:60]
        if key not in groups:
            groups[key] = {"count": 0, "sample": t.error or "", "last_at": ""}
        groups[key]["count"] += 1
        if not groups[key]["last_at"] and t.created_at:
            groups[key]["last_at"] = t.created_at.isoformat()
    result = [ErrorGroup(error_key=k, **v) for k, v in groups.items()]
    result.sort(key=lambda x: x.count, reverse=True)
    return result[:limit]


def token_by_agent(session: Session) -> list[TokenStats]:
    """按 agent 维度统计 token 用量。"""
    rows = session.exec(select(Trace).where(Trace.step_type == "llm_call")).all()
    by_agent: dict[int, dict] = {}
    for t in rows:
        aid = t.agent_id or 0
        if aid not in by_agent:
            by_agent[aid] = {"token_in": 0, "token_out": 0, "count": 0, "latencies": []}
        by_agent[aid]["token_in"] += t.token_in or 0
        by_agent[aid]["token_out"] += t.token_out or 0
        by_agent[aid]["count"] += 1
        if t.latency_ms > 0:
            by_agent[aid]["latencies"].append(t.latency_ms)
    result = []
    for aid, d in by_agent.items():
        agent = session.get(Agent, aid) if aid else None
        lats = d["latencies"]
        result.append(TokenStats(
            agent_id=aid or None,
            agent_name=agent.name if agent else "未知",
            token_in=d["token_in"],
            token_out=d["token_out"],
            call_count=d["count"],
            avg_latency_ms=round(sum(lats) / len(lats), 1) if lats else 0.0,
        ))
    result.sort(key=lambda x: x.token_in + x.token_out, reverse=True)
    return result
