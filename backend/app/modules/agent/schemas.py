"""Agent / 对话的 Pydantic 请求响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ===== Agent =====
class AgentCreate(BaseModel):
    name: str
    system_prompt: str = ""
    model_id: int | None = None
    skill_ids: list[int] = Field(default_factory=list)
    mcp_server_ids: list[int] = Field(default_factory=list)
    kb_ids: list[int] = Field(default_factory=list)
    constraint_profile_id: int | None = None
    context_config: dict[str, Any] = Field(default_factory=lambda: {"top_k": 4})


class AgentUpdate(BaseModel):
    name: str | None = None
    system_prompt: str | None = None
    model_id: int | None = None
    skill_ids: list[int] | None = None
    mcp_server_ids: list[int] | None = None
    kb_ids: list[int] | None = None
    constraint_profile_id: int | None = None
    context_config: dict[str, Any] | None = None


class AgentRead(BaseModel):
    id: int
    name: str
    system_prompt: str
    model_id: int | None
    skill_ids: list[int]
    mcp_server_ids: list[int]
    kb_ids: list[int]
    constraint_profile_id: int | None
    context_config: dict[str, Any]
    version: int = 1
    created_at: datetime | None = None


class AgentExport(BaseModel):
    """Agent 导出包：完整配置快照，可在另一实例导入。"""
    name: str
    system_prompt: str
    model_name: str = ""  # 导出时记录模型名，导入时按名匹配
    skill_names: list[str] = Field(default_factory=list)
    mcp_server_names: list[str] = Field(default_factory=list)
    kb_names: list[str] = Field(default_factory=list)
    constraint_profile_name: str = ""
    context_config: dict[str, Any] = Field(default_factory=dict)
    version: str = "1.0"


class AgentVersionRead(BaseModel):
    id: int
    agent_id: int
    version: int
    snapshot: dict[str, Any]
    note: str = ""
    created_at: datetime | None = None


class AgentVersionCreate(BaseModel):
    note: str = ""


class ChatRequest(BaseModel):
    message: str
    conversation_id: int | None = None  # None 表示新对话


# ===== 对话 =====
class ConversationRead(BaseModel):
    id: int
    agent_id: int | None
    title: str
    summary: str
    compression_state: dict[str, Any]
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MessageRead(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    tool_calls: list = Field(default_factory=list)
    tool_results: list = Field(default_factory=list)
    token_count: int = 0
    is_compressed_summary: bool = False
    created_at: datetime | None = None
