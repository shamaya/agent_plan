"""Agent Worker 关联表：多智能体协同（Supervisor-Worker 模式）。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class AgentWorker(SQLModel, table=True):
    __tablename__ = "agent_workers"
    id: Optional[int] = Field(default=None, primary_key=True)
    supervisor_id: int = Field(foreign_key="agents.id", index=True)
    worker_id: int = Field(foreign_key="agents.id")
    role_description: str = ""
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
