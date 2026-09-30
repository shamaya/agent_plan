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
    _migrate_agents_columns()
    _migrate_messages_columns()
    logger.info(f"数据库已初始化：{settings.sqlite_path}")


def _migrate_messages_columns() -> None:
    """对已存在的 messages 表增量补充新列（多模态 images 等）。"""
    from sqlalchemy import text

    new_cols = [
        ("images", "JSON", "'[]'"),
    ]
    with Session(engine) as session:
        try:
            rows = session.exec(text("PRAGMA table_info(messages)")).all()
        except Exception:
            return  # 表不存在
        existing = {r[1] for r in rows}
        for col, col_type, default in new_cols:
            if col in existing:
                continue
            try:
                session.exec(text(
                    f"ALTER TABLE messages ADD COLUMN {col} {col_type} DEFAULT {default}"
                ))
                session.commit()
                logger.info(f"迁移：messages 表新增列 {col}")
            except Exception as e:
                logger.warning(f"迁移 messages.{col} 失败: {e}")


def _migrate_agents_columns() -> None:
    """对已存在的 agents 表增量补充新列（create_all 不会 ALTER 旧表）。

    幂等：通过 PRAGMA table_info 检查列是否存在，已存在则跳过。
    新增列在 models 中定义后，旧数据库需要这里手动 ADD COLUMN。
    """
    from sqlalchemy import text

    new_cols = [
        ("approval_config", "JSON", '{"enabled": false, "tools": []}'),
        ("routing_config", "JSON",
         '{"enabled": false, "simple_model_id": null, '
         '"complex_model_id": null, "threshold": 0.5}'),
    ]
    with Session(engine) as session:
        try:
            rows = session.exec(text("PRAGMA table_info(agents)")).all()
        except Exception:
            return  # 表不存在（首次建表），跳过迁移
        existing = {r[1] for r in rows}  # 第 2 列是列名
        for col, col_type, default in new_cols:
            if col in existing:
                continue
            try:
                session.exec(text(
                    f"ALTER TABLE agents ADD COLUMN {col} {col_type} "
                    f"DEFAULT '{default}'"
                ))
                session.commit()
                logger.info(f"迁移：agents 表新增列 {col}")
            except Exception as e:
                logger.warning(f"迁移 agents.{col} 失败（可能已存在）: {e}")
