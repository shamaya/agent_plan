"""Workflow CRUD + DAG 校验。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Workflow, WorkflowRun, WorkflowVersion
from app.modules.workflow.schemas import (
    WorkflowCreate, WorkflowUpdate, WorkflowRead,
    WorkflowRunRead, WorkflowVersionRead,
)


def _to_read(w: Workflow) -> WorkflowRead:
    return WorkflowRead(
        id=w.id, name=w.name, description=w.description,
        nodes=w.nodes or [], created_at=w.created_at, updated_at=w.updated_at,
    )


def _to_run_read(r: WorkflowRun) -> WorkflowRunRead:
    return WorkflowRunRead(
        id=r.id, workflow_id=r.workflow_id, status=r.status,
        input=r.input or {}, node_results=r.node_results or {},
        started_at=r.started_at, finished_at=r.finished_at, error=r.error or "",
    )


# ===== CRUD =====
def list_workflows(session: Session) -> list[WorkflowRead]:
    rows = session.exec(select(Workflow).order_by(Workflow.id.desc())).all()
    return [_to_read(w) for w in rows]


def get_workflow(session: Session, wf_id: int) -> Optional[WorkflowRead]:
    w = session.get(Workflow, wf_id)
    return _to_read(w) if w else None


def create_workflow(session: Session, data: WorkflowCreate) -> WorkflowRead:
    w = Workflow(
        name=data.name, description=data.description,
        nodes=[n.model_dump() for n in data.nodes],
    )
    session.add(w)
    session.commit()
    session.refresh(w)
    logger.info(f"创建 workflow id={w.id} name={w.name} 节点数={len(w.nodes)}")
    return _to_read(w)


def update_workflow(session: Session, wf_id: int, data: WorkflowUpdate) -> Optional[WorkflowRead]:
    w = session.get(Workflow, wf_id)
    if not w:
        return None
    # 更新前先存快照
    _save_version(session, wf_id, note="更新前快照")
    if data.name is not None:
        w.name = data.name
    if data.description is not None:
        w.description = data.description
    if data.nodes is not None:
        w.nodes = [n.model_dump() for n in data.nodes]
    w.updated_at = datetime.utcnow()
    session.add(w)
    session.commit()
    session.refresh(w)
    return _to_read(w)


def delete_workflow(session: Session, wf_id: int) -> bool:
    w = session.get(Workflow, wf_id)
    if not w:
        return False
    # 同步删除运行记录 + 版本快照
    runs = session.exec(
        select(WorkflowRun).where(WorkflowRun.workflow_id == wf_id)
    ).all()
    for r in runs:
        session.delete(r)
    versions = session.exec(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == wf_id)
    ).all()
    for v in versions:
        session.delete(v)
    session.delete(w)
    session.commit()
    return True


# ===== Run =====
def list_runs(session: Session, wf_id: int) -> list[WorkflowRunRead]:
    rows = session.exec(
        select(WorkflowRun).where(WorkflowRun.workflow_id == wf_id)
        .order_by(WorkflowRun.id.desc())
    ).all()
    return [_to_run_read(r) for r in rows]


def get_run(session: Session, run_id: int) -> Optional[WorkflowRunRead]:
    r = session.get(WorkflowRun, run_id)
    return _to_run_read(r) if r else None


def create_run(session: Session, wf_id: int, input_data: dict) -> WorkflowRun:
    """创建运行记录（status=pending），返回 ORM 对象供 engine 更新。"""
    r = WorkflowRun(workflow_id=wf_id, status="pending", input=input_data)
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


def update_run(session: Session, run: WorkflowRun, **fields) -> WorkflowRun:
    """更新运行记录字段。"""
    for k, v in fields.items():
        setattr(run, k, v)
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def update_node_result(session: Session, run: WorkflowRun,
                        node_id: str, result: dict) -> None:
    """合并写入节点结果（不破坏其他节点的结果）。"""
    nr = dict(run.node_results or {})
    nr[node_id] = result
    run.node_results = nr
    session.add(run)
    session.commit()


# ===== 版本管理 =====
def _save_version(session: Session, wf_id: int, note: str = "") -> Optional[WorkflowVersion]:
    """保存当前 workflow 快照为新版本。"""
    w = session.get(Workflow, wf_id)
    if not w:
        return None
    latest = session.exec(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == wf_id)
        .order_by(WorkflowVersion.version.desc())
    ).first()
    next_ver = (latest.version + 1) if latest else 1
    snap = {
        "name": w.name, "description": w.description,
        "nodes": w.nodes or [],
    }
    v = WorkflowVersion(workflow_id=wf_id, version=next_ver, snapshot=snap, note=note)
    session.add(v)
    session.commit()
    session.refresh(v)
    logger.info(f"workflow id={wf_id} 保存版本 v{next_ver}")
    return v


def save_version(session: Session, wf_id: int, note: str = "") -> Optional[WorkflowVersionRead]:
    v = _save_version(session, wf_id, note)
    if not v:
        return None
    return WorkflowVersionRead(
        id=v.id, workflow_id=v.workflow_id, version=v.version,
        snapshot=v.snapshot or {}, note=v.note, created_at=v.created_at,
    )


def list_versions(session: Session, wf_id: int) -> list[WorkflowVersionRead]:
    rows = session.exec(
        select(WorkflowVersion).where(WorkflowVersion.workflow_id == wf_id)
        .order_by(WorkflowVersion.version.desc())
    ).all()
    return [WorkflowVersionRead(
        id=v.id, workflow_id=v.workflow_id, version=v.version,
        snapshot=v.snapshot or {}, note=v.note, created_at=v.created_at,
    ) for v in rows]


def rollback_version(session: Session, wf_id: int, version_id: int) -> Optional[WorkflowRead]:
    """回滚到指定版本：用快照覆盖当前 workflow，并生成新版本记录。"""
    w = session.get(Workflow, wf_id)
    if not w:
        return None
    v = session.get(WorkflowVersion, version_id)
    if not v or v.workflow_id != wf_id:
        return None
    snap = v.snapshot or {}
    # 回滚前再存一次当前状态
    _save_version(session, wf_id, note=f"回滚到 v{v.version} 前快照")
    w.name = snap.get("name", w.name)
    w.description = snap.get("description", w.description)
    w.nodes = snap.get("nodes", [])
    w.updated_at = datetime.utcnow()
    session.add(w)
    session.commit()
    session.refresh(w)
    _save_version(session, wf_id, note=f"回滚到 v{v.version}")
    logger.info(f"workflow id={wf_id} 回滚到版本 v{v.version}")
    return _to_read(w)
