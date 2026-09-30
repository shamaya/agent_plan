"""Agent 长期记忆表：跨会话记忆提取与检索。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class AgentMemory(SQLModel, table=True):
    __tablename__ = "agent_memories"
    id: Optional[int] = Field(default=None, primary_key=True)
    agent_id: int = Field(foreign_key="agents.id", index=True)
    content: str = ""                        # 记忆内容
    memory_type: str = "fact"               # fact | preference | episodic
    importance: float = 0.5                 # 0-1 重要程度
    metadata_: dict = Field(
        default_factory=dict, sa_column=Column("metadata", JSON),
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
