"""Trace 路由：查询 trace / 全局统计 / 实时流 / 错误聚合 / Token 统计。"""
from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.db.engine import get_session, engine
from app.db.models import Trace
from app.modules.trace import service
from app.modules.trace.schemas import TraceRead, Stats, ErrorGroup, TokenStats

router = APIRouter(tags=["trace"])


@router.get("/traces", response_model=list[TraceRead])
def list_traces(conv_id: int | None = None, limit: int = 200,
                session: Session = Depends(get_session)):
    return service.list_traces(session, conv_id=conv_id, limit=limit)


@router.get("/traces/stream")
async def stream_traces(since_id: int = 0, conv_id: int | None = None):
    """Trace 实时流：SSE 推送自 since_id 之后的新 trace，每 2 秒轮询一次。

    客户端用 EventSource 连接，传 ?since_id= 上次收到的最大 id。
    无新数据时发送心跳注释行保持连接。
    """
    async def event_gen():
        import json
        last_id = since_id
        while True:
            with Session(engine, expire_on_commit=False) as session:
                stmt = select(Trace).where(Trace.id > last_id)
                if conv_id is not None:
                    stmt = stmt.where(Trace.conversation_id == conv_id)
                stmt = stmt.order_by(Trace.id)
                rows = session.exec(stmt).all()
                for t in rows:
                    payload = {
                        "id": t.id, "conversation_id": t.conversation_id,
                        "agent_id": t.agent_id, "iteration": t.iteration,
                        "step_type": t.step_type, "tool_name": t.tool_name,
                        "status": t.status, "error": t.error,
                        "token_in": t.token_in, "token_out": t.token_out,
                        "latency_ms": t.latency_ms,
                        "created_at": t.created_at.isoformat() if t.created_at else None,
                    }
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    last_id = t.id
            # 心跳
            yield f": heartbeat {datetime.utcnow().isoformat()}\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/traces/{trace_id}", response_model=TraceRead)
def get_trace(trace_id: int, session: Session = Depends(get_session)):
    t = service.get_trace(session, trace_id)
    if not t:
        raise HTTPException(404, "trace 不存在")
    return t


@router.get("/stats", response_model=Stats)
def get_stats(session: Session = Depends(get_session)):
    return service.stats(session)


@router.get("/stats/errors", response_model=list[ErrorGroup])
def get_error_groups(limit: int = 20, session: Session = Depends(get_session)):
    return service.error_groups(session, limit)


@router.get("/stats/tokens", response_model=list[TokenStats])
def get_token_stats(session: Session = Depends(get_session)):
    return service.token_by_agent(session)
