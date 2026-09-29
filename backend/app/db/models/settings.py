"""运行时杂项设置：key-value。"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class SettingsRow(SQLModel, table=True):
    __tablename__ = "settings"
    key: str = Field(primary_key=True)
    value: Any = Field(default=None, sa_column=Column(JSON))
