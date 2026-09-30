"""评估路由：CRUD + 运行（SSE）+ 运行历史 + 趋势数据。

端点（prefix=/api）：
  GET    /evaluations                       列表（可按 agent_id 过滤）
  POST   /evaluations                       创建
  GET    /evaluations/{eid}                 详情
  PUT    /evaluations/{eid}                 更新
  DELETE /evaluations/{eid}                 删除
  POST   /evaluations/{eid}/run             运行（SSE 流式）
  GET    /evaluations/{eid}/runs            运行历史（趋势数据）
  GET    /evaluations/runs/{run_id}         单次运行详情
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.core.logging import logger
from app.db.engine import engine, get_session
from app.db.models import Evaluation, EvaluationRun
from app.modules.evaluation import service, engine as eval_engine
from app.modules.evaluation.schemas import (
    EvaluationCreate, EvaluationUpdate, EvaluationRead,
    EvaluationRunCreate, EvaluationRunRead,
    EvaluationVersionCreate, EvaluationVersionRead,
)

router = APIRouter(tags=["evaluation"])


# ===== CRUD =====
@router.get("/evaluations", response_model=list[EvaluationRead])
def list_evaluations(agent_id: int | None = None,
                     session: Session = Depends(get_session)):
    return service.list_evaluations(session, agent_id)


@router.post("/evaluations", response_model=EvaluationRead)
def create_evaluation(data: EvaluationCreate,
                      session: Session = Depends(get_session)):
    return service.create_evaluation(session, data)


@router.get("/evaluations/{eid}", response_model=EvaluationRead)
def get_evaluation(eid: int, session: Session = Depends(get_session)):
    e = service.get_evaluation(session, eid)
    if not e:
        raise HTTPException(404, "评估不存在")
    return e


@router.put("/evaluations/{eid}", response_model=EvaluationRead)
def update_evaluation(eid: int, data: EvaluationUpdate,
                      session: Session = Depends(get_session)):
    e = service.update_evaluation(session, eid, data)
    if not e:
        raise HTTPException(404, "评估不存在")
    return e


@router.delete("/evaluations/{eid}")
def delete_evaluation(eid: int, session: Session = Depends(get_session)):
    if not service.delete_evaluation(session, eid):
        raise HTTPException(404, "评估不存在")
    return {"ok": True}


# ===== 运行 =====
@router.post("/evaluations/{eid}/run")
async def run_evaluation(eid: int, req: EvaluationRunCreate):
    """SSE 流式评估。"""
    from app.llm.stream import sse_event, error_event

    async def event_gen():
        with Session(engine, expire_on_commit=False) as session:
            ev = session.get(Evaluation, eid)
            if not ev:
                yield error_event("评估不存在")
                return
            run = service.create_run(session, eid, req.input_prompt)
            yield sse_event("run_created", {"run_id": run.id, "evaluation_id": eid})
            try:
                async for sse_str in eval_engine.run_evaluation(ev, run, session):
                    yield sse_str
            except Exception as e:
                logger.exception(f"评估运行异常: {e}")
                yield error_event(f"评估运行异常：{e}")
                service.update_run(session, run,
                    status="failed", error=str(e),
                    finished_at=__import__("datetime").datetime.utcnow())

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/evaluations/{eid}/runs", response_model=list[EvaluationRunRead])
def list_runs(eid: int, session: Session = Depends(get_session)):
    return service.list_runs(session, eid)


@router.get("/evaluations/runs/{run_id}", response_model=EvaluationRunRead)
def get_run(run_id: int, session: Session = Depends(get_session)):
    r = service.get_run(session, run_id)
    if not r:
        raise HTTPException(404, "运行记录不存在")
    return r


# ===== 版本管理 =====
@router.get("/evaluations/{eid}/versions", response_model=list[EvaluationVersionRead])
def list_evaluation_versions(eid: int, session: Session = Depends(get_session)):
    return service.list_versions(session, eid)


@router.post("/evaluations/{eid}/versions", response_model=EvaluationVersionRead)
def save_evaluation_version(eid: int, data: EvaluationVersionCreate,
                            session: Session = Depends(get_session)):
    v = service.save_version(session, eid, data.note)
    if not v:
        raise HTTPException(404, "评估不存在")
    return v


@router.post("/evaluations/{eid}/versions/{version_id}/rollback", response_model=EvaluationRead)
def rollback_evaluation_version(eid: int, version_id: int,
                                session: Session = Depends(get_session)):
    e = service.rollback_version(session, eid, version_id)
    if not e:
        raise HTTPException(404, "评估或版本不存在")
    return e
