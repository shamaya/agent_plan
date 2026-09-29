"""Harness 层的 Pydantic 请求响应模型：约束 profile + 错误回收规则。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ===== 约束 profile =====
class ConstraintProfileCreate(BaseModel):
    name: str
    max_iterations: int = 10
    token_budget: int = 8000
    allowed_tools: list = Field(default_factory=lambda: ["*"])
    forbidden_actions: list = Field(default_factory=list)
    tool_failure_threshold: int = 3
    compression_policy: dict[str, Any] = Field(
        default_factory=lambda: {"enabled": True, "trigger_ratio": 0.8, "keep_recent_turns": 4}
    )


class ConstraintProfileRead(BaseModel):
    id: int
    name: str
    max_iterations: int
    token_budget: int
    allowed_tools: list
    forbidden_actions: list
    tool_failure_threshold: int
    compression_policy: dict[str, Any]
    created_at: datetime | None = None


# ===== 错误回收规则 =====
class RecoveryRuleCreate(BaseModel):
    agent_id: int | None = None
    trigger: dict[str, Any] = Field(default_factory=dict)  # {tool, error_pattern}
    action: str = "retry_with_advice"  # disable_tool | downgrade | retry_with_advice
    advice: str = ""
    source_trace_id: int | None = None


class RecoveryRuleRead(BaseModel):
    id: int
    agent_id: int | None
    trigger: dict[str, Any]
    action: str
    advice: str
    source_trace_id: int | None
    created_at: datetime | None = None


class LearnResult(BaseModel):
    rule_draft: RecoveryRuleRead
    trace_summary: dict[str, Any] = Field(default_factory=dict)
