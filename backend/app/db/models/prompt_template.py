"""Prompt 模板市场：可复用的 prompt 模板，可应用到 Agent 或直接测试。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class PromptTemplate(SQLModel, table=True):
    __tablename__ = "prompt_templates"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str = ""
    category: str = "general"  # general | coding | writing | analysis | role | ...
    content: str = ""  # 模板正文，支持 {{变量}} 占位符
    variables: list = Field(default_factory=list, sa_column=Column(JSON))  # [{name, description, default}]
    tags: list = Field(default_factory=list, sa_column=Column(JSON))
    is_public: bool = Field(default=True)  # 是否在市场公开
    usage_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PromptCache(SQLModel, table=True):
    """Prompt 缓存：按 prompt_hash 缓存 LLM 响应，减少重复调用。"""
    __tablename__ = "prompt_cache"
    id: Optional[int] = Field(default=None, primary_key=True)
    prompt_hash: str = Field(index=True, unique=True)
    model_name: str = Field(index=True)
    prompt: str = ""
    response: str = ""
    token_in: int = 0
    token_out: int = 0
    hit_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used_at: datetime = Field(default_factory=datetime.utcnow)
