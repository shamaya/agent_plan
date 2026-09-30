"""Guardrail Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class GuardrailRuleCreate(BaseModel):
    name: str
    agent_id: Optional[int] = None
    type: str  # regex | length | keyword | json_format | json_schema | starts_with
    config: dict[str, Any] = Field(default_factory=dict)
    action: str = "retry"  # reject | retry | append_warning
    retry_count: int = 1
    enabled: bool = True
    sort_order: int = 0


class GuardrailRuleUpdate(BaseModel):
    name: str | None = None
    agent_id: Optional[int] = None
    type: str | None = None
    config: dict[str, Any] | None = None
    action: str | None = None
    retry_count: int | None = None
    enabled: bool | None = None
    sort_order: int | None = None


class GuardrailRuleRead(BaseModel):
    id: int
    name: str
    agent_id: Optional[int]
    agent_name: str = ""
    type: str
    config: dict[str, Any]
    action: str
    retry_count: int
    enabled: bool
    sort_order: int
    created_at: datetime


class GuardrailCheckResult(BaseModel):
    """单条规则校验结果。"""
    rule_id: int
    rule_name: str
    passed: bool
    message: str = ""
    action: str = ""


class GuardrailBatchResult(BaseModel):
    """批量校验结果。"""
    passed: bool
    results: list[GuardrailCheckResult]
    violated_rule_ids: list[int] = Field(default_factory=list)
