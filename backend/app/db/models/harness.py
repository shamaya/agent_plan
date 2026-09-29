"""Harness Engineering 层：约束声明 + 错误回收规则。

- constraint_profiles：可声明的 agent 行为约束（max_iter/token_budget/allowed_tools/...）
- error_recovery_rules："每犯错就设计机制使其不再犯"的规则存储
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class ConstraintProfile(SQLModel, table=True):
    __tablename__ = "constraint_profiles"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    max_iterations: int = 10
    token_budget: int = 8000
    allowed_tools: list = Field(default_factory=lambda: ["*"], sa_column=Column(JSON))
    forbidden_actions: list = Field(default_factory=list, sa_column=Column(JSON))
    tool_failure_threshold: int = 3
    compression_policy: dict[str, Any] = Field(
        default_factory=lambda: {"enabled": True, "trigger_ratio": 0.8, "keep_recent_turns": 4},
        sa_column=Column(JSON),
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ErrorRecoveryRule(SQLModel, table=True):
    __tablename__ = "error_recovery_rules"
    id: Optional[int] = Field(default=None, primary_key=True)
    agent_id: Optional[int] = Field(default=None, foreign_key="agents.id", index=True)
    trigger: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))  # {tool, error_pattern}
    action: str = "retry_with_advice"  # disable_tool | downgrade | retry_with_advice
    advice: str = ""
    source_trace_id: Optional[int] = Field(default=None, foreign_key="traces.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
