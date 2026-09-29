"""建表 + seed 默认 settings。

可作为独立脚本运行：python -m app.db.init
"""
from __future__ import annotations

from app.core.logging import logger
from app.db.engine import init_db, engine
from sqlmodel import Session, select

from app.db.models import SettingsRow


DEFAULT_SETTINGS = {
    "default_embedding": "local",  # local | api
    "compression_trigger_ratio": 0.8,
    "compression_keep_recent_turns": 4,
}


def seed_settings() -> None:
    """seed 默认 settings（已存在则跳过）。"""
    with Session(engine) as session:
        for k, v in DEFAULT_SETTINGS.items():
            existing = session.exec(select(SettingsRow).where(SettingsRow.key == k)).first()
            if not existing:
                session.add(SettingsRow(key=k, value=v))
        session.commit()
        logger.info("默认 settings 已 seed")
        for k, v in DEFAULT_SETTINGS.items():
            row = session.exec(select(SettingsRow).where(SettingsRow.key == k)).first()
            logger.info(f"  setting {k} = {row.value if row else v}")


def main() -> None:
    init_db()
    seed_settings()
    logger.info("数据库初始化完成")


if __name__ == "__main__":
    main()
