"""MCP 服务 / 工具的 Pydantic 请求响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ===== 请求 =====
class McpServerCreate(BaseModel):
    name: str
    transport_type: str = "stdio"  # stdio | sse | http
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class McpServerUpdate(BaseModel):
    name: str | None = None
    transport_type: str | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class ToolInvokeRequest(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)


# ===== 响应 =====
class McpServerRead(BaseModel):
    id: int
    name: str
    transport_type: str
    config: dict[str, Any]
    enabled: bool
    health_status: str
    last_check_at: datetime | None = None
    created_at: datetime | None = None
    tools_count: int = 0


class McpToolRead(BaseModel):
    id: int
    server_id: int
    name: str
    description: str
    input_schema: dict[str, Any]
    discovered_at: datetime | None = None


class ToolInvokeResult(BaseModel):
    ok: bool
    result: Any = None
    error: str = ""
