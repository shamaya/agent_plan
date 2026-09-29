"""JSON 辅助：参数 schema 校验、安全 JSON 序列化。"""
from __future__ import annotations

import json


def safe_json_loads(text: str | None, default=None):
    """安全解析 JSON，失败返回默认值。"""
    if not text:
        return default
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return default


def safe_json_dumps(obj) -> str:
    """安全序列化 JSON，失败返回空串。"""
    try:
        return json.dumps(obj, ensure_ascii=False)
    except (TypeError, ValueError):
        return ""
