"""MCP 服务表：server 注册 + 工具发现缓存。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class McpServer(SQLModel, table=True):
    __tablename__ = "mcp_servers"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    transport_type: str = "stdio"  # stdio | sse | http
    config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    enabled: bool = True
    health_status: str = "unknown"  # unknown | healthy | unhealthy
    last_check_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class McpTool(SQLModel, table=True):
    __tablename__ = "mcp_tools"
    id: Optional[int] = Field(default=None, primary_key=True)
    server_id: int = Field(foreign_key="mcp_servers.id", index=True)
    name: str
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    discovered_at: datetime = Field(default_factory=datetime.utcnow)
