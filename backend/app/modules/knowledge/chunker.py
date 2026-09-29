"""文本分块器：按 chunk_size + overlap + 句子边界切分。

策略：
1. 按段落 + 句子边界预切分（保留语义完整）
2. 在 chunk_size 上限内贪心合并句子
3. 块间 overlap 个句子重叠，避免跨块语义断裂
"""
from __future__ import annotations

import re

# 中英文句末标点
_SENT_END = re.compile(r"[。！？!?\.；;\n]+")


def _split_sentences(text: str) -> list[str]:
    """按句末标点切句子，过滤空串。保留标点。"""
    parts = _SENT_END.split(text)
    seps = _SENT_END.findall(text)
    sentences = []
    for i, p in enumerate(parts):
        s = p.strip()
        if not s:
            continue
        if i < len(seps):
            s = s + seps[i]
        sentences.append(s.strip())
    if not sentences and text.strip():
        sentences = [text.strip()]
    return sentences


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """把长文本切成块。

    chunk_size: 单块字符数上限
    overlap: 块间重叠字符数（用最近句子补齐）
    """
    text = (text or "").strip()
    if not text:
        return []

    sentences = _split_sentences(text)
    chunks: list[str] = []
    cur = ""
    for s in sentences:
        # 当前块加这句仍不超限 → 累积
        if len(cur) + len(s) <= chunk_size:
            cur = (cur + " " + s).strip() if cur else s
            continue
        # 这句本身超 chunk_size：硬切
        if len(s) > chunk_size:
            if cur:
                chunks.append(cur)
                cur = ""
            for i in range(0, len(s), chunk_size):
                chunks.append(s[i : i + chunk_size])
            continue
        # 当前块已满：保存，开新块时带 overlap
        chunks.append(cur)
        # overlap：取当前块尾部 overlap 个字符（按句子对齐）
        tail = cur[-overlap:] if overlap > 0 else ""
        cur = (tail + " " + s).strip() if tail else s
    if cur:
        chunks.append(cur)
    return chunks
