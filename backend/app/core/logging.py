"""结构化日志：控制台输出 + 可选写 trace 表（由 trace 模块负责，这里只提供 logger）。

日志格式：时间 + level + module + message。
"""
from __future__ import annotations

import logging
import sys


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("agent_platform")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(fmt)
    logger.addHandler(handler)
    logger.propagate = False
    return logger


logger = setup_logging()
