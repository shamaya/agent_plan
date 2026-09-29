"""Trace / 统计的 Pydantic 响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TraceRead(BaseModel):
    id: int
    conversation_id: int | None
    agent_id: int | None
    iteration: int
    step_type: str
    tool_name: str = ""
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0
    token_in: int = 0
    token_out: int = 0
    status: str = "ok"
    error: str = ""
    created_at: datetime | None = None


class Stats(BaseModel):
    providers: int = 0
    models: int = 0
    skills: int = 0
    mcp_servers: int = 0
    mcp_tools: int = 0
    knowledge_bases: int = 0
    agents: int = 0
    conversations: int = 0
    traces: int = 0
    recent_traces: list[TraceRead] = Field(default_factory=list)
    # 扩展统计
    total_token_in: int = 0
    total_token_out: int = 0
    error_count: int = 0
    avg_latency_ms: float = 0.0


class ErrorGroup(BaseModel):
    """错误聚合：按错误前缀分组统计。"""
    error_key: str
    count: int
    sample: str = ""
    last_at: str = ""


class TokenStats(BaseModel):
    """按 agent / model 维度的 token 用量统计。"""
    agent_id: int | None = None
    agent_name: str = ""
    token_in: int = 0
    token_out: int = 0
    call_count: int = 0
    avg_latency_ms: float = 0.0
