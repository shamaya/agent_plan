"""Agent 版本快照表：每次保存生成快照，支持回滚。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class AgentVersion(SQLModel, table=True):
    __tablename__ = "agent_versions"
    id: Optional[int] = Field(default=None, primary_key=True)
    agent_id: int = Field(foreign_key="agents.id", index=True)
    version: int
    snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    note: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
