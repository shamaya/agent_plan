"""Skill 表：可复用能力单元（prompt 模板 + 参数 schema + 工具链）。版本化。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Skill(SQLModel, table=True):
    __tablename__ = "skills"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    category: str = ""
    description: str = ""
    prompt_template: str = ""
    parameters_schema: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    tool_chain: list = Field(default_factory=list, sa_column=Column(JSON))
    version: int = 1
    enabled: bool = True
    parent_version_id: Optional[int] = Field(default=None, foreign_key="skills.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SkillVersion(SQLModel, table=True):
    __tablename__ = "skill_versions"
    id: Optional[int] = Field(default=None, primary_key=True)
    skill_id: int = Field(foreign_key="skills.id", index=True)
    version: int
    snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
