"""对话 + 消息 + Trace 表。

关键：messages.is_compressed_summary 标记压缩摘要消息；被压缩的旧消息不删除，仅从活跃上下文剔除。
conversations.compression_state 记录压缩历史。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"
    id: Optional[int] = Field(default=None, primary_key=True)
    agent_id: Optional[int] = Field(default=None, foreign_key="agents.id", index=True)
    title: str = ""
    summary: str = ""
    compression_state: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Message(SQLModel, table=True):
    __tablename__ = "messages"
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversations.id", index=True)
    role: str  # system | user | assistant | tool
    content: str = ""
    images: list = Field(default_factory=list, sa_column=Column(JSON))  # 多模态：图片 URL 列表
    tool_calls: list = Field(default_factory=list, sa_column=Column(JSON))
    tool_results: list = Field(default_factory=list, sa_column=Column(JSON))
    token_count: int = 0
    is_compressed_summary: bool = False  # 标记压缩摘要消息
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Trace(SQLModel, table=True):
    __tablename__ = "traces"
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: Optional[int] = Field(default=None, foreign_key="conversations.id", index=True)
    agent_id: Optional[int] = Field(default=None, foreign_key="agents.id", index=True)
    iteration: int = 0
    step_type: str  # llm_call | tool_call | retrieval | compression | constraint_check
    tool_name: str = ""
    input: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    output: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    latency_ms: int = 0
    token_in: int = 0
    token_out: int = 0
    status: str = "ok"  # ok | error
    error: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
