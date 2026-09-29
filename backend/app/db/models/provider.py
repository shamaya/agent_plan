"""LLM Provider / Model 表。key 用 Fernet 加密存储，永不回传明文。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Provider(SQLModel, table=True):
    __tablename__ = "providers"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    kind: str = Field(default="chat")  # chat | embedding | both
    base_url: str
    api_key_enc: str = ""  # 加密后的 api_key
    headers: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Model(SQLModel, table=True):
    __tablename__ = "models"
    id: Optional[int] = Field(default=None, primary_key=True)
    provider_id: int = Field(foreign_key="providers.id", index=True)
    model_name: str
    context_window: int = 8192
    max_tokens: int = 1024
    is_default: bool = False  # 每个 kind 一个默认
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
