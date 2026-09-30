"""DAG 工作流表：多 Agent 编排（拓扑序执行 + 上下文传递）。

节点（Node）结构（存在 Workflow.nodes JSON 数组里）：
  {
    "id": "n1",
    "name": "调研",
    "agent_id": 3,
    "prompt_template": "请调研：{{topic}}\n上游产物：{{upstream.n2}}",
    "depends_on": ["n0"],
    "variables": {"max_tokens": 2000}
  }

- depends_on 决定拓扑序；上游节点的输出按节点 id 注入到本节点 prompt 的 {{upstream.<node_id>}}。
- prompt_template 支持占位符：{{input.<key>}}（工作流输入） / {{upstream.<node_id>}}（上游输出）。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Workflow(SQLModel, table=True):
    __tablename__ = "workflows"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str = ""
    # nodes: list[dict]，结构见模块 docstring
    nodes: list = Field(default_factory=list, sa_column=Column(JSON))
    # edges 隐含在 depends_on 中，不单独存
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WorkflowRun(SQLModel, table=True):
    __tablename__ = "workflow_runs"
    id: Optional[int] = Field(default=None, primary_key=True)
    workflow_id: int = Field(foreign_key="workflows.id", index=True)
    status: str = Field(default="pending")  # pending | running | completed | failed | canceled
    input: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    # node_results: { node_id: { "status": ..., "content": ..., "started_at": ..., "finished_at": ..., "error": ... } }
    node_results: dict = Field(default_factory=dict, sa_column=Column(JSON))
    started_at: Optional[datetime] = Field(default=None)
    finished_at: Optional[datetime] = Field(default=None)
    error: str = ""
