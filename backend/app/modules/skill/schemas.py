"""Skill 的 Pydantic 请求响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SkillCreate(BaseModel):
    name: str
    category: str = ""
    description: str = ""
    prompt_template: str = ""
    parameters_schema: dict[str, Any] = Field(default_factory=dict)
    tool_chain: list = Field(default_factory=list)
    enabled: bool = True


class SkillUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    description: str | None = None
    prompt_template: str | None = None
    parameters_schema: dict[str, Any] | None = None
    tool_chain: list | None = None
    enabled: bool | None = None


class SkillRead(BaseModel):
    id: int
    name: str
    category: str
    description: str
    prompt_template: str
    parameters_schema: dict[str, Any]
    tool_chain: list
    version: int
    enabled: bool
    parent_version_id: int | None = None
    created_at: datetime | None = None


class SkillVersionRead(BaseModel):
    id: int
    skill_id: int
    version: int
    snapshot: dict[str, Any]
    created_at: datetime | None = None


class SkillImportRequest(BaseModel):
    """标准 skill Markdown 导入请求（YAML frontmatter + body）。"""
    content: str


class SkillTestRequest(BaseModel):
    """Skill 在线测试：参数渲染 + 可选 LLM 运行。"""
    parameters: dict[str, Any] = Field(default_factory=dict)
    model_id: int | None = None  # 提供则实际调用 LLM 返回结果
