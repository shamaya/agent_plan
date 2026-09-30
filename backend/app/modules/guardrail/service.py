"""Guardrail CRUD。"""
from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import GuardrailRule, Agent
from app.modules.guardrail.schemas import (
    GuardrailRuleCreate, GuardrailRuleUpdate, GuardrailRuleRead,
)


def _to_read(r: GuardrailRule, session: Session) -> GuardrailRuleRead:
    agent_name = ""
    if r.agent_id:
        a = session.get(Agent, r.agent_id)
        if a:
            agent_name = a.name
    return GuardrailRuleRead(
        id=r.id, name=r.name, agent_id=r.agent_id, agent_name=agent_name,
        type=r.type, config=r.config or {}, action=r.action,
        retry_count=r.retry_count, enabled=r.enabled,
        sort_order=r.sort_order, created_at=r.created_at,
    )


def list_rules(session: Session, agent_id: Optional[int] = None) -> list[GuardrailRuleRead]:
    stmt = select(GuardrailRule).order_by(GuardrailRule.sort_order, GuardrailRule.id)
    if agent_id is not None:
        stmt = stmt.where(GuardrailRule.agent_id == agent_id)
    rows = session.exec(stmt).all()
    return [_to_read(r, session) for r in rows]


def get_rule(session: Session, rid: int) -> Optional[GuardrailRuleRead]:
    r = session.get(GuardrailRule, rid)
    return _to_read(r, session) if r else None


def create_rule(session: Session, data: GuardrailRuleCreate) -> GuardrailRuleRead:
    r = GuardrailRule(
        name=data.name, agent_id=data.agent_id, type=data.type,
        config=data.config, action=data.action,
        retry_count=data.retry_count, enabled=data.enabled,
        sort_order=data.sort_order,
    )
    session.add(r)
    session.commit()
    session.refresh(r)
    logger.info(f"创建 guardrail id={r.id} name={r.name} type={r.type}")
    return _to_read(r, session)


def update_rule(session: Session, rid: int, data: GuardrailRuleUpdate) -> Optional[GuardrailRuleRead]:
    r = session.get(GuardrailRule, rid)
    if not r:
        return None
    for f in ("name", "agent_id", "type", "config", "action",
              "retry_count", "enabled", "sort_order"):
        v = getattr(data, f)
        if v is not None:
            setattr(r, f, v)
    session.add(r)
    session.commit()
    session.refresh(r)
    return _to_read(r, session)


def delete_rule(session: Session, rid: int) -> bool:
    r = session.get(GuardrailRule, rid)
    if not r:
        return False
    session.delete(r)
    session.commit()
    return True


def get_rules_for_agent(session: Session, agent_id: int) -> list[GuardrailRule]:
    """取对该 Agent 生效的规则（agent_id 匹配 + 全局规则），按 sort_order 排序。"""
    rows = session.exec(
        select(GuardrailRule)
        .where(
            (GuardrailRule.enabled == True) &  # noqa: E712
            ((GuardrailRule.agent_id == agent_id) | (GuardrailRule.agent_id.is_(None)))
        )
        .order_by(GuardrailRule.sort_order, GuardrailRule.id)
    ).all()
    return list(rows)
