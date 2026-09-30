"""Agent 定义表：组装 model + skill + mcp + kb + 约束 profile + 上下文配置。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Agent(SQLModel, table=True):
    __tablename__ = "agents"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    system_prompt: str = ""
    model_id: Optional[int] = Field(default=None, foreign_key="models.id")
    skill_ids: list = Field(default_factory=list, sa_column=Column(JSON))
    mcp_server_ids: list = Field(default_factory=list, sa_column=Column(JSON))
    kb_ids: list = Field(default_factory=list, sa_column=Column(JSON))
    constraint_profile_id: Optional[int] = Field(default=None, foreign_key="constraint_profiles.id")
    context_config: dict[str, Any] = Field(
        default_factory=lambda: {"top_k": 4},
        sa_column=Column(JSON),
    )
    approval_config: dict[str, Any] = Field(
        default_factory=lambda: {"enabled": False, "tools": []},
        sa_column=Column(JSON),
    )
    routing_config: dict[str, Any] = Field(
        default_factory=lambda: {
            "enabled": False,
            "simple_model_id": None,
            "complex_model_id": None,
            "threshold": 0.5,
        },
        sa_column=Column(JSON),
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
