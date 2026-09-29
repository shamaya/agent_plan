"""SQLModel engine + 会话依赖。

SQLite 连接：check_same_thread=False（FastAPI 多 worker / 异步安全）。
get_session 作为 FastAPI 依赖注入。
"""
from __future__ import annotations

from sqlmodel import Session, SQLModel, create_engine
from app.config import settings
from app.core.logging import logger

# 确保目录存在
settings.sqlite_path.parent.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False}
engine = create_engine(
    f"sqlite:///{settings.sqlite_path}",
    connect_args=connect_args,
    echo=False,
    # 长事务对话场景，关闭 expire_on_commit 避免重复加载
)


def get_session():
    """FastAPI 依赖：yield 一个 Session。expire_on_commit=False 避免 commit 后属性 expire 触发重复加载。"""
    with Session(engine, expire_on_commit=False) as session:
        yield session


def init_db() -> None:
    """建表 + seed 默认数据。"""
    # 必须先 import 所有 model，SQLModel.metadata 才能收集到所有表
    from app.db import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    logger.info(f"数据库已初始化：{settings.sqlite_path}")
