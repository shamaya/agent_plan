"""Token 预算计算：约束 agent 上下文不超限。

threshold = context_window - max_tokens - tools_tokens - system_tokens
当历史 token 超过 threshold 时触发压缩。
"""
from __future__ import annotations

from app.utils.tokens import count_messages_tokens


def estimate_tools_tokens(tools: list[dict]) -> int:
    """估算 tools schema 占用的 token（按 JSON 文本估算）。"""
    if not tools:
        return 0
    from app.utils.tokens import count_tokens
    import json
    return count_tokens(json.dumps(tools, ensure_ascii=False))


def compute_threshold(context_window: int, max_tokens: int,
                      tools_tokens: int, system_tokens: int) -> int:
    """计算压缩触发阈值。

    预留：max_tokens（生成）+ tools_tokens（工具定义）+ system_tokens（系统提示）+ 安全余量。
    """
    # 额外 256 token 安全余量
    safety = 256
    threshold = context_window - max_tokens - tools_tokens - system_tokens - safety
    return max(threshold, 512)  # 至少留 512


def history_tokens(messages: list[dict]) -> int:
    """计算历史消息 token 数。"""
    return count_messages_tokens(messages)
