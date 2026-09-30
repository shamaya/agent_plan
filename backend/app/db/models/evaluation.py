"""评估框架表：LLM-as-Judge。

- Evaluation：评估定义（Agent + 评估准则 + 评分模型）
  criteria: [{"id": "c1", "name": "准确性", "description": "...", "weight": 1.0, "rubric": "..."}, ...]
- EvaluationRun：一次评估运行的结果
  results: {"overall_score": 4.2, "criteria": {"c1": {"score": 4.5, "reason": "..."}}, "response": "...", "judge_raw": "..."}
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Evaluation(SQLModel, table=True):
    __tablename__ = "evaluations"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    agent_id: int = Field(foreign_key="agents.id", index=True)
    description: str = ""
    # 评估准则列表
    criteria: list = Field(default_factory=list, sa_column=Column(JSON))
    # 评分用的 model（judge），若为空则用 agent 自身 model
    judge_model_id: Optional[int] = Field(default=None, foreign_key="models.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class EvaluationRun(SQLModel, table=True):
    __tablename__ = "evaluation_runs"
    id: Optional[int] = Field(default=None, primary_key=True)
    evaluation_id: int = Field(foreign_key="evaluations.id", index=True)
    status: str = Field(default="pending")  # pending | running | completed | failed
    input_prompt: str = ""
    # { overall_score, criteria: {cid: {score, reason}}, response, judge_raw }
    results: dict = Field(default_factory=dict, sa_column=Column(JSON))
    started_at: Optional[datetime] = Field(default=None)
    finished_at: Optional[datetime] = Field(default=None)
    error: str = ""
