"""评估 CRUD。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Evaluation, EvaluationRun, Agent, Model, EvaluationVersion
from app.modules.evaluation.schemas import (
    EvaluationCreate, EvaluationUpdate, EvaluationRead,
    EvaluationRunRead, EvaluationVersionRead,
)


def _to_read(e: Evaluation, session: Session) -> EvaluationRead:
    agent = session.get(Agent, e.agent_id)
    agent_name = agent.name if agent else f"Agent#{e.agent_id}"
    judge_model_name = ""
    if e.judge_model_id:
        m = session.get(Model, e.judge_model_id)
        if m:
            judge_model_name = m.model_name
    return EvaluationRead(
        id=e.id, name=e.name, agent_id=e.agent_id,
        agent_name=agent_name, description=e.description,
        criteria=e.criteria or [],
        judge_model_id=e.judge_model_id,
        judge_model_name=judge_model_name,
        created_at=e.created_at, updated_at=e.updated_at,
    )


def list_evaluations(session: Session, agent_id: Optional[int] = None) -> list[EvaluationRead]:
    stmt = select(Evaluation).order_by(Evaluation.id.desc())
    if agent_id is not None:
        stmt = stmt.where(Evaluation.agent_id == agent_id)
    rows = session.exec(stmt).all()
    return [_to_read(e, session) for e in rows]


def get_evaluation(session: Session, eid: int) -> Optional[EvaluationRead]:
    e = session.get(Evaluation, eid)
    return _to_read(e, session) if e else None


def create_evaluation(session: Session, data: EvaluationCreate) -> EvaluationRead:
    e = Evaluation(
        name=data.name, agent_id=data.agent_id, description=data.description,
        criteria=[c.model_dump() for c in data.criteria],
        judge_model_id=data.judge_model_id,
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    logger.info(f"创建 evaluation id={e.id} name={e.name} agent={e.agent_id}")
    return _to_read(e, session)


def update_evaluation(session: Session, eid: int, data: EvaluationUpdate) -> Optional[EvaluationRead]:
    e = session.get(Evaluation, eid)
    if not e:
        return None
    # 更新前先存快照
    _save_version(session, eid, note="更新前快照")
    if data.name is not None:
        e.name = data.name
    if data.description is not None:
        e.description = data.description
    if data.criteria is not None:
        e.criteria = [c.model_dump() for c in data.criteria]
    if data.judge_model_id is not None:
        e.judge_model_id = data.judge_model_id
    e.updated_at = datetime.utcnow()
    session.add(e)
    session.commit()
    session.refresh(e)
    return _to_read(e, session)


def delete_evaluation(session: Session, eid: int) -> bool:
    e = session.get(Evaluation, eid)
    if not e:
        return False
    runs = session.exec(
        select(EvaluationRun).where(EvaluationRun.evaluation_id == eid)
    ).all()
    for r in runs:
        session.delete(r)
    versions = session.exec(
        select(EvaluationVersion).where(EvaluationVersion.evaluation_id == eid)
    ).all()
    for v in versions:
        session.delete(v)
    session.delete(e)
    session.commit()
    return True


# ===== Run =====
def list_runs(session: Session, eid: int) -> list[EvaluationRunRead]:
    rows = session.exec(
        select(EvaluationRun).where(EvaluationRun.evaluation_id == eid)
        .order_by(EvaluationRun.id.asc())  # 按时间升序，便于趋势图
    ).all()
    return [
        EvaluationRunRead(
            id=r.id, evaluation_id=r.evaluation_id, status=r.status,
            input_prompt=r.input_prompt, results=r.results or {},
            started_at=r.started_at, finished_at=r.finished_at, error=r.error or "",
        )
        for r in rows
    ]


def get_run(session: Session, run_id: int) -> Optional[EvaluationRunRead]:
    r = session.get(EvaluationRun, run_id)
    if not r:
        return None
    return EvaluationRunRead(
        id=r.id, evaluation_id=r.evaluation_id, status=r.status,
        input_prompt=r.input_prompt, results=r.results or {},
        started_at=r.started_at, finished_at=r.finished_at, error=r.error or "",
    )


def create_run(session: Session, eid: int, input_prompt: str) -> EvaluationRun:
    r = EvaluationRun(evaluation_id=eid, status="pending", input_prompt=input_prompt)
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


def update_run(session: Session, run: EvaluationRun, **fields) -> EvaluationRun:
    for k, v in fields.items():
        setattr(run, k, v)
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


# ===== 版本管理 =====
def _save_version(session: Session, eid: int, note: str = "") -> Optional[EvaluationVersion]:
    """保存当前 evaluation 快照为新版本。"""
    e = session.get(Evaluation, eid)
    if not e:
        return None
    latest = session.exec(
        select(EvaluationVersion).where(EvaluationVersion.evaluation_id == eid)
        .order_by(EvaluationVersion.version.desc())
    ).first()
    next_ver = (latest.version + 1) if latest else 1
    snap = {
        "name": e.name, "description": e.description,
        "agent_id": e.agent_id, "criteria": e.criteria or [],
        "judge_model_id": e.judge_model_id,
    }
    v = EvaluationVersion(evaluation_id=eid, version=next_ver, snapshot=snap, note=note)
    session.add(v)
    session.commit()
    session.refresh(v)
    logger.info(f"evaluation id={eid} 保存版本 v{next_ver}")
    return v


def save_version(session: Session, eid: int, note: str = "") -> Optional[EvaluationVersionRead]:
    v = _save_version(session, eid, note)
    if not v:
        return None
    return EvaluationVersionRead(
        id=v.id, evaluation_id=v.evaluation_id, version=v.version,
        snapshot=v.snapshot or {}, note=v.note, created_at=v.created_at,
    )


def list_versions(session: Session, eid: int) -> list[EvaluationVersionRead]:
    rows = session.exec(
        select(EvaluationVersion).where(EvaluationVersion.evaluation_id == eid)
        .order_by(EvaluationVersion.version.desc())
    ).all()
    return [EvaluationVersionRead(
        id=v.id, evaluation_id=v.evaluation_id, version=v.version,
        snapshot=v.snapshot or {}, note=v.note, created_at=v.created_at,
    ) for v in rows]


def rollback_version(session: Session, eid: int, version_id: int) -> Optional[EvaluationRead]:
    """回滚到指定版本：用快照覆盖当前 evaluation，并生成新版本记录。"""
    e = session.get(Evaluation, eid)
    if not e:
        return None
    v = session.get(EvaluationVersion, version_id)
    if not v or v.evaluation_id != eid:
        return None
    snap = v.snapshot or {}
    # 回滚前再存一次当前状态
    _save_version(session, eid, note=f"回滚到 v{v.version} 前快照")
    e.name = snap.get("name", e.name)
    e.description = snap.get("description", e.description)
    e.criteria = snap.get("criteria", [])
    e.judge_model_id = snap.get("judge_model_id")
    e.updated_at = datetime.utcnow()
    session.add(e)
    session.commit()
    session.refresh(e)
    _save_version(session, eid, note=f"回滚到 v{v.version}")
    logger.info(f"evaluation id={eid} 回滚到版本 v{v.version}")
    return _to_read(e, session)
