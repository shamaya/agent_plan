"""评估框架 Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class EvaluationCriterion(BaseModel):
    id: str
    name: str
    description: str = ""
    weight: float = 1.0
    rubric: str = ""  # 评分标准说明


class EvaluationCreate(BaseModel):
    name: str
    agent_id: int
    description: str = ""
    criteria: list[EvaluationCriterion] = Field(default_factory=list)
    judge_model_id: Optional[int] = None


class EvaluationUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    criteria: list[EvaluationCriterion] | None = None
    judge_model_id: Optional[int] = None


class EvaluationRead(BaseModel):
    id: int
    name: str
    agent_id: int
    agent_name: str = ""
    description: str
    criteria: list[dict]
    judge_model_id: Optional[int]
    judge_model_name: str = ""
    created_at: datetime
    updated_at: datetime


class EvaluationRunCreate(BaseModel):
    input_prompt: str = Field(..., description="发送给被评估 Agent 的测试 prompt")


class EvaluationRunRead(BaseModel):
    id: int
    evaluation_id: int
    status: str
    input_prompt: str
    results: dict[str, Any]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    error: str = ""


# ===== 版本管理 =====
class EvaluationVersionCreate(BaseModel):
    note: str = ""


class EvaluationVersionRead(BaseModel):
    id: int
    evaluation_id: int
    version: int
    snapshot: dict[str, Any]
    note: str
    created_at: datetime
