"""Harness 路由：约束 profile CRUD + 错误回收规则 + 从失败学习。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db.engine import get_session
from app.db.models import ConstraintProfile, ErrorRecoveryRule
from app.modules.harness import recovery
from app.modules.harness.schemas import (
    ConstraintProfileCreate, ConstraintProfileRead,
    RecoveryRuleCreate, RecoveryRuleRead, LearnResult,
)

router = APIRouter(tags=["harness"])


# ===== 约束 profile =====
def _cp_to_read(p: ConstraintProfile) -> ConstraintProfileRead:
    return ConstraintProfileRead(
        id=p.id, name=p.name, max_iterations=p.max_iterations,
        token_budget=p.token_budget, allowed_tools=p.allowed_tools,
        forbidden_actions=p.forbidden_actions,
        tool_failure_threshold=p.tool_failure_threshold,
        compression_policy=p.compression_policy, created_at=p.created_at,
    )


@router.get("/constraints", response_model=list[ConstraintProfileRead])
def list_constraints(session: Session = Depends(get_session)):
    rows = session.exec(select(ConstraintProfile).order_by(ConstraintProfile.id)).all()
    return [_cp_to_read(p) for p in rows]


@router.post("/constraints", response_model=ConstraintProfileRead)
def create_constraint(data: ConstraintProfileCreate, session: Session = Depends(get_session)):
    p = ConstraintProfile(
        name=data.name, max_iterations=data.max_iterations,
        token_budget=data.token_budget, allowed_tools=data.allowed_tools,
        forbidden_actions=data.forbidden_actions,
        tool_failure_threshold=data.tool_failure_threshold,
        compression_policy=data.compression_policy,
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return _cp_to_read(p)


@router.put("/constraints/{profile_id}", response_model=ConstraintProfileRead)
def update_constraint(profile_id: int, data: ConstraintProfileCreate, session: Session = Depends(get_session)):
    p = session.get(ConstraintProfile, profile_id)
    if not p:
        raise HTTPException(404, "约束 profile 不存在")
    p.name = data.name
    p.max_iterations = data.max_iterations
    p.token_budget = data.token_budget
    p.allowed_tools = data.allowed_tools
    p.forbidden_actions = data.forbidden_actions
    p.tool_failure_threshold = data.tool_failure_threshold
    p.compression_policy = data.compression_policy
    session.add(p)
    session.commit()
    session.refresh(p)
    return _cp_to_read(p)


@router.delete("/constraints/{profile_id}")
def delete_constraint(profile_id: int, session: Session = Depends(get_session)):
    p = session.get(ConstraintProfile, profile_id)
    if not p:
        raise HTTPException(404, "约束 profile 不存在")
    session.delete(p)
    session.commit()
    return {"ok": True}


# ===== 错误回收规则 =====
def _rule_to_read(r: ErrorRecoveryRule) -> RecoveryRuleRead:
    return RecoveryRuleRead(
        id=r.id, agent_id=r.agent_id, trigger=r.trigger,
        action=r.action, advice=r.advice,
        source_trace_id=r.source_trace_id, created_at=r.created_at,
    )


@router.get("/recovery-rules", response_model=list[RecoveryRuleRead])
def list_recovery_rules(agent_id: int | None = None, session: Session = Depends(get_session)):
    stmt = select(ErrorRecoveryRule).order_by(ErrorRecoveryRule.id)
    if agent_id is not None:
        stmt = stmt.where(ErrorRecoveryRule.agent_id == agent_id)
    rows = session.exec(stmt).all()
    return [_rule_to_read(r) for r in rows]


@router.post("/recovery-rules", response_model=RecoveryRuleRead)
def create_recovery_rule(data: RecoveryRuleCreate, session: Session = Depends(get_session)):
    r = ErrorRecoveryRule(
        agent_id=data.agent_id, trigger=data.trigger,
        action=data.action, advice=data.advice,
        source_trace_id=data.source_trace_id,
    )
    session.add(r)
    session.commit()
    session.refresh(r)
    return _rule_to_read(r)


@router.delete("/recovery-rules/{rule_id}")
def delete_recovery_rule(rule_id: int, session: Session = Depends(get_session)):
    r = session.get(ErrorRecoveryRule, rule_id)
    if not r:
        raise HTTPException(404, "规则不存在")
    session.delete(r)
    session.commit()
    return {"ok": True}


# ===== 从失败 trace 学习 =====
@router.post("/traces/{trace_id}/learn-from-failure", response_model=LearnResult)
def learn_from_failure(trace_id: int, session: Session = Depends(get_session)):
    draft = recovery.learn_from_failure(session, trace_id)
    if not draft:
        raise HTTPException(404, "trace 不存在")
    # 预生成 rule 草稿（不落库，返回给前端编辑后 POST）
    rule_draft = RecoveryRuleRead(
        id=0, agent_id=draft.get("agent_id"), trigger=draft.get("trigger", {}),
        action=draft.get("action", "retry_with_advice"),
        advice=draft.get("advice", ""),
        source_trace_id=draft.get("source_trace_id"),
        created_at=None,
    )
    return LearnResult(rule_draft=rule_draft, trace_summary=draft.get("trace_summary", {}))
