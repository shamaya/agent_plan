"""Guardrail 路由：规则 CRUD + 测试校验。

端点（prefix=/api）：
  GET    /guardrails                       规则列表（可按 agent_id 过滤）
  POST   /guardrails                       创建
  GET    /guardrails/{rid}                 详情
  PUT    /guardrails/{rid}                 更新
  DELETE /guardrails/{rid}                 删除
  POST   /guardrails/test                  测试：传入 content + rule_ids 或 agent_id，返回校验结果
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.db.engine import get_session
from app.db.models import GuardrailRule
from app.modules.guardrail import service, engine
from app.modules.guardrail.schemas import (
    GuardrailRuleCreate, GuardrailRuleUpdate, GuardrailRuleRead,
    GuardrailBatchResult,
)

router = APIRouter(tags=["guardrail"])


# ===== CRUD =====
@router.get("/guardrails", response_model=list[GuardrailRuleRead])
def list_guardrails(agent_id: Optional[int] = None,
                    session: Session = Depends(get_session)):
    return service.list_rules(session, agent_id)


@router.post("/guardrails", response_model=GuardrailRuleRead)
def create_guardrail(data: GuardrailRuleCreate,
                     session: Session = Depends(get_session)):
    return service.create_rule(session, data)


@router.get("/guardrails/{rid}", response_model=GuardrailRuleRead)
def get_guardrail(rid: int, session: Session = Depends(get_session)):
    r = service.get_rule(session, rid)
    if not r:
        raise HTTPException(404, "规则不存在")
    return r


@router.put("/guardrails/{rid}", response_model=GuardrailRuleRead)
def update_guardrail(rid: int, data: GuardrailRuleUpdate,
                     session: Session = Depends(get_session)):
    r = service.update_rule(session, rid, data)
    if not r:
        raise HTTPException(404, "规则不存在")
    return r


@router.delete("/guardrails/{rid}")
def delete_guardrail(rid: int, session: Session = Depends(get_session)):
    if not service.delete_rule(session, rid):
        raise HTTPException(404, "规则不存在")
    return {"ok": True}


# ===== 测试校验 =====
class GuardrailTestRequest(BaseModel):
    content: str = Field(..., description="待校验的文本")
    rule_ids: list[int] = Field(default_factory=list, description="指定规则 id 列表（为空则用 agent_id 的生效规则）")
    agent_id: Optional[int] = None


@router.post("/guardrails/test", response_model=GuardrailBatchResult)
def test_guardrails(req: GuardrailTestRequest,
                    session: Session = Depends(get_session)):
    """测试校验：返回每条规则的通过情况。"""
    rules: list[GuardrailRule] = []
    if req.rule_ids:
        for rid in req.rule_ids:
            r = session.get(GuardrailRule, rid)
            if r and r.enabled:
                rules.append(r)
    elif req.agent_id is not None:
        rules = service.get_rules_for_agent(session, req.agent_id)
    else:
        raise HTTPException(400, "请提供 rule_ids 或 agent_id")
    return engine.check_all(rules, req.content)
