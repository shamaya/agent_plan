"""Prompt 模板 Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class PromptVariable(BaseModel):
    name: str
    description: str = ""
    default: Any = ""


class PromptTemplateCreate(BaseModel):
    name: str
    description: str = ""
    category: str = "general"
    content: str
    variables: list[PromptVariable] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    is_public: bool = True


class PromptTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    content: str | None = None
    variables: list[PromptVariable] | None = None
    tags: list[str] | None = None
    is_public: bool | None = None


class PromptTemplateRead(BaseModel):
    id: int
    name: str
    description: str
    category: str
    content: str
    variables: list[dict]
    tags: list[str]
    is_public: bool
    usage_count: int
    created_at: datetime
    updated_at: datetime


class PromptTemplateApply(BaseModel):
    """应用模板到 Agent：把渲染后的 content 写入 Agent 的 system_prompt。"""
    variables: dict[str, Any] = Field(default_factory=dict)


class PromptTemplateRenderRequest(BaseModel):
    variables: dict[str, Any] = Field(default_factory=dict)


class PromptTemplateRenderResponse(BaseModel):
    rendered: str


class PromptCacheStats(BaseModel):
    total_entries: int
    total_hits: int
    total_token_saved: int
