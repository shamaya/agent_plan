"""Workflow / Evaluation 版本快照表：每次保存生成快照，支持回滚。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class WorkflowVersion(SQLModel, table=True):
    __tablename__ = "workflow_versions"
    id: Optional[int] = Field(default=None, primary_key=True)
    workflow_id: int = Field(foreign_key="workflows.id", index=True)
    version: int
    snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    note: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EvaluationVersion(SQLModel, table=True):
    __tablename__ = "evaluation_versions"
    id: Optional[int] = Field(default=None, primary_key=True)
    evaluation_id: int = Field(foreign_key="evaluations.id", index=True)
    version: int
    snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    note: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
