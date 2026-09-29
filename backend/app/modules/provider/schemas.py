"""Provider / Model 的 Pydantic 请求响应模型。

关键：响应永不回传明文 key，仅返回 has_key / key_preview。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ===== 请求 =====
class ProviderCreate(BaseModel):
    name: str
    kind: str = "chat"  # chat | embedding | both
    base_url: str
    api_key: str = ""  # 明文，service 层加密存库
    headers: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class ProviderUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    base_url: str | None = None
    api_key: str | None = None  # 留空表示不改 key
    headers: dict[str, Any] | None = None
    enabled: bool | None = None


class ModelUpsert(BaseModel):
    model_name: str
    context_window: int = 8192
    max_tokens: int = 1024
    is_default: bool = False
    enabled: bool = True


class ModelBatchUpsert(BaseModel):
    models: list[ModelUpsert]


# ===== 响应 =====
class ModelRead(BaseModel):
    id: int | None
    provider_id: int
    model_name: str
    context_window: int
    max_tokens: int
    is_default: bool
    enabled: bool
    created_at: datetime | None = None


class ProviderRead(BaseModel):
    id: int
    name: str
    kind: str
    base_url: str
    has_key: bool  # 是否配置了 key
    key_preview: str = ""  # sk-***x9f2
    headers: dict[str, Any] = Field(default_factory=dict)
    enabled: bool
    created_at: datetime | None = None
    model_count: int = 0


class ProviderTestResult(BaseModel):
    ok: bool
    models: list[str] = Field(default_factory=list)  # 远端返回的模型名列表
    error: str = ""
