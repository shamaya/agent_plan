"""Workflow Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class WorkflowNode(BaseModel):
    """节点定义。"""
    id: str = Field(..., description="节点 id，工作流内唯一")
    name: str = Field("", description="节点显示名")
    agent_id: int = Field(..., description="执行的 Agent id")
    prompt_template: str = Field("", description="Prompt 模板，支持 {{input.x}} 和 {{upstream.n}} 占位符")
    depends_on: list[str] = Field(default_factory=list, description="依赖的节点 id 列表")
    variables: dict[str, Any] = Field(default_factory=dict, description="节点级变量")


class WorkflowCreate(BaseModel):
    name: str
    description: str = ""
    nodes: list[WorkflowNode] = Field(default_factory=list)


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    nodes: list[WorkflowNode] | None = None


class WorkflowRead(BaseModel):
    id: int
    name: str
    description: str
    nodes: list[dict]
    created_at: datetime
    updated_at: datetime


class WorkflowRunCreate(BaseModel):
    """启动一次工作流运行。"""
    input: dict[str, Any] = Field(default_factory=dict, description="工作流输入参数")


class WorkflowRunRead(BaseModel):
    id: int
    workflow_id: int
    status: str
    input: dict[str, Any]
    node_results: dict[str, Any]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    error: str = ""


class WorkflowValidationError(BaseModel):
    """DAG 校验错误详情。"""
    ok: bool
    errors: list[str] = Field(default_factory=list)


# ===== 版本管理 =====
class WorkflowVersionCreate(BaseModel):
    note: str = ""


class WorkflowVersionRead(BaseModel):
    id: int
    workflow_id: int
    version: int
    snapshot: dict[str, Any]
    note: str
    created_at: datetime
