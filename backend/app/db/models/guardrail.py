"""Guardrail 规则表：输出校验 + 重试。

规则类型 type:
  - regex        : 正则匹配（config.pattern / config.negate）
  - length       : 长度约束（config.min / config.max）
  - keyword      : 禁用关键词（config.keywords 列表）
  - json_format  : JSON 格式校验（config.schema 可选，config.required_fields）
  - json_schema  : JSON Schema 校验（config.schema）
  - starts_with  : 必须以某前缀开头（config.prefix）

动作 action:
  - reject          : 直接拒绝，返回错误
  - retry           : 追加反馈提示，重试 LLM（最多 retry_count 次）
  - append_warning  : 保留输出，追加警告标记

agent_id 为 null 表示全局规则（应用于所有 Agent）。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class GuardrailRule(SQLModel, table=True):
    __tablename__ = "guardrail_rules"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    agent_id: Optional[int] = Field(default=None, foreign_key="agents.id", index=True)
    type: str  # regex | length | keyword | json_format | json_schema | starts_with
    config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    action: str = Field(default="retry")  # reject | retry | append_warning
    retry_count: int = Field(default=1)
    enabled: bool = Field(default=True)
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
