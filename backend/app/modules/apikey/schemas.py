"""ApiKey 的 Pydantic 请求响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class ApiKeyCreate(BaseModel):
    name: str
    allowed_agent_ids: list[int] = []  # 空列表=全部 agent
    expires_at: Optional[datetime] = None


class ApiKeyUpdate(BaseModel):
    name: str | None = None
    allowed_agent_ids: list[int] | None = None
    enabled: bool | None = None
    expires_at: Optional[datetime] = None


class ApiKeyRead(BaseModel):
    """列表/详情读取（不含明文 key）。"""
    id: int
    name: str
    key_prefix: str
    allowed_agent_ids: list[int]
    enabled: bool
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    call_count: int = 0
    created_at: Optional[datetime] = None


class ApiKeyCreated(ApiKeyRead):
    """创建时返回，含明文 key（仅此一次）。"""
    key: str


class ApiKeyInvoke(BaseModel):
    """第三方调用智能体的请求体。"""
    message: str
    variables: dict[str, Any] = {}  # 模板变量，替换 system_prompt 中的 {{var}}
    conversation_id: Optional[int] = None  # 可选，续接已有对话
    callback_url: str = ""  # 带此字段则转异步 Webhook 回调
    timeout: int = 60  # 秒，上限 300
