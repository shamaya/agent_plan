"""API Key 表：第三方接入鉴权 + 多 Agent 白名单。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class ApiKey(SQLModel, table=True):
    __tablename__ = "api_keys"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)  # Key 用途名称（如 "客户A-订单助手"）
    key_prefix: str  # 前 8 位明文，用于列表展示识别
    key_hash: str = Field(index=True, unique=True)  # SHA-256 哈希
    allowed_agent_ids: list = Field(default_factory=list, sa_column=Column(JSON))  # 空列表=全部 agent
    enabled: bool = True
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    call_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
