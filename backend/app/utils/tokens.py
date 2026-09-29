"""Token 估算工具：用 tiktoken 估算文本 token 数。

用于压缩触发判断、trace 记录、预算检查。
不同模型 tokenizer 不同，这里用 cl100k_base（GPT 系列常用）做近似估算，足够触发判断用。
"""
from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=1)
def _encoder():
    import tiktoken
    try:
        return tiktoken.get_encoding("cl100k_base")
    except Exception:
        return tiktoken.get_encoding("r50k_base")


def count_tokens(text: str) -> int:
    """估算文本 token 数。空串返回 0。"""
    if not text:
        return 0
    return len(_encoder().encode(text))


def count_messages_tokens(messages: list[dict]) -> int:
    """估算消息列表 token 数（含每条消息的开销近似）。"""
    enc = _encoder()
    total = 0
    for m in messages:
        # 每条消息约 4 token 固定开销（role + 边界）
        total += 4
        role = m.get("role", "")
        content = m.get("content", "") or ""
        if isinstance(content, str):
            total += len(enc.encode(content))
        elif isinstance(content, list):
            # 多模态/工具调用内容片段
            for part in content:
                if isinstance(part, dict):
                    total += len(enc.encode(str(part.get("text", part.get("type", "")))))
        if role == "tool":
            # tool 消息额外开销
            total += 3
    return total
