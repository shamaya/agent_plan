"""Workflow 路由：CRUD + 运行 + SSE 流式。

端点（prefix=/api）：
  GET    /workflows                        列表
  POST   /workflows                        创建
  GET    /workflows/{wf_id}                详情
  PUT    /workflows/{wf_id}                更新
  DELETE /workflows/{wf_id}                删除
  POST   /workflows/{wf_id}/validate       校验 DAG（不执行）
  POST   /workflows/{wf_id}/run            运行（SSE 流式）
  GET    /workflows/{wf_id}/runs           运行历史
  GET    /workflows/runs/{run_id}          运行详情
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.core.logging import logger
from app.db.engine import engine, get_session
from app.db.models import Workflow, WorkflowRun
from app.modules.workflow import service, engine as wf_engine
from app.modules.workflow.schemas import (
    WorkflowCreate, WorkflowUpdate, WorkflowRead,
    WorkflowRunCreate, WorkflowRunRead, WorkflowValidationError,
    WorkflowVersionCreate, WorkflowVersionRead,
)

router = APIRouter(tags=["workflow"])


# ===== CRUD =====
@router.get("/workflows", response_model=list[WorkflowRead])
def list_workflows(session: Session = Depends(get_session)):
    return service.list_workflows(session)


@router.post("/workflows", response_model=WorkflowRead)
def create_workflow(data: WorkflowCreate, session: Session = Depends(get_session)):
    return service.create_workflow(session, data)


@router.get("/workflows/{wf_id}", response_model=WorkflowRead)
def get_workflow(wf_id: int, session: Session = Depends(get_session)):
    w = service.get_workflow(session, wf_id)
    if not w:
        raise HTTPException(404, "工作流不存在")
    return w


@router.put("/workflows/{wf_id}", response_model=WorkflowRead)
def update_workflow(wf_id: int, data: WorkflowUpdate,
                    session: Session = Depends(get_session)):
    w = service.update_workflow(session, wf_id, data)
    if not w:
        raise HTTPException(404, "工作流不存在")
    return w


@router.delete("/workflows/{wf_id}")
def delete_workflow(wf_id: int, session: Session = Depends(get_session)):
    if not service.delete_workflow(session, wf_id):
        raise HTTPException(404, "工作流不存在")
    return {"ok": True}


# ===== 校验 =====
@router.post("/workflows/{wf_id}/validate", response_model=WorkflowValidationError)
def validate_workflow(wf_id: int, session: Session = Depends(get_session)):
    w = session.get(Workflow, wf_id)
    if not w:
        raise HTTPException(404, "工作流不存在")
    ok, errors = wf_engine.validate_dag(w.nodes or [])
    return WorkflowValidationError(ok=ok, errors=errors)


@router.post("/workflows/validate", response_model=WorkflowValidationError)
def validate_draft(data: WorkflowCreate):
    """校验草稿（不落库）。"""
    ok, errors = wf_engine.validate_dag([n.model_dump() for n in data.nodes])
    return WorkflowValidationError(ok=ok, errors=errors)


# ===== 运行 =====
@router.post("/workflows/{wf_id}/run")
async def run_workflow(wf_id: int, req: WorkflowRunCreate):
    """SSE 流式运行工作流。"""
    from app.llm.stream import sse_event, error_event

    async def event_gen():
        with Session(engine, expire_on_commit=False) as session:
            wf = session.get(Workflow, wf_id)
            if not wf:
                yield error_event("工作流不存在")
                return
            run = service.create_run(session, wf_id, req.input)
            yield sse_event("run_created", {
                "run_id": run.id, "workflow_id": wf_id,
            })
            try:
                async for sse_str in wf_engine.run_workflow(wf, run, session):
                    yield sse_str
            except Exception as e:
                logger.exception(f"工作流运行异常: {e}")
                yield error_event(f"工作流运行异常：{e}")
                service.update_run(session, run,
                    status="failed", error=str(e),
                    finished_at=__import__("datetime").datetime.utcnow())

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/workflows/{wf_id}/runs", response_model=list[WorkflowRunRead])
def list_runs(wf_id: int, session: Session = Depends(get_session)):
    return service.list_runs(session, wf_id)


@router.get("/workflows/runs/{run_id}", response_model=WorkflowRunRead)
def get_run(run_id: int, session: Session = Depends(get_session)):
    r = service.get_run(session, run_id)
    if not r:
        raise HTTPException(404, "运行记录不存在")
    return r


# ===== 版本管理 =====
@router.get("/workflows/{wf_id}/versions", response_model=list[WorkflowVersionRead])
def list_workflow_versions(wf_id: int, session: Session = Depends(get_session)):
    return service.list_versions(session, wf_id)


@router.post("/workflows/{wf_id}/versions", response_model=WorkflowVersionRead)
def save_workflow_version(wf_id: int, data: WorkflowVersionCreate,
                          session: Session = Depends(get_session)):
    v = service.save_version(session, wf_id, data.note)
    if not v:
        raise HTTPException(404, "工作流不存在")
    return v


@router.post("/workflows/{wf_id}/versions/{version_id}/rollback", response_model=WorkflowRead)
def rollback_workflow_version(wf_id: int, version_id: int,
                              session: Session = Depends(get_session)):
    w = service.rollback_version(session, wf_id, version_id)
    if not w:
        raise HTTPException(404, "工作流或版本不存在")
    return w
