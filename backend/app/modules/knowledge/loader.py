"""文档解析器：按 mime 类型提取纯文本。

支持：txt（直接读）/ md（markdown 转纯文本）/ pdf（pypdf 提取）。
其它类型按纯文本兜底。
"""
from __future__ import annotations

import re
from pathlib import Path

from app.core.logging import logger


def _strip_markdown(text: str) -> str:
    """把 markdown 转纯文本：去标记符号但保留可读结构。"""
    # 去代码块（保留内容）
    text = re.sub(r"```[^\n]*\n(.*?)```", r"\1", text, flags=re.DOTALL)
    # 去行内代码
    text = re.sub(r"`([^`]+)`", r"\1", text)
    # 去图片
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    # 去链接，保留文本
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # 去标题井号
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # 去粗体/斜体
    text = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"\1", text)
    text = re.sub(r"_{1,3}([^_]+)_{1,3}", r"\1", text)
    # 去引用
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)
    # 去列表符号
    text = re.sub(r"^[\-\*\+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\d+\.\s+", "", text, flags=re.MULTILINE)
    # 去水平分割线
    text = re.sub(r"^[-*_]{3,}$", "", text, flags=re.MULTILINE)
    return text


def load_pdf(path: Path) -> str:
    """用 pypdf 提取 PDF 文本。"""
    try:
        from pypdf import PdfReader
    except ImportError:
        logger.warning("pypdf 未安装，无法解析 PDF")
        return ""
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        t = page.extract_text() or ""
        pages.append(t)
    return "\n".join(pages)


def load_document(path: Path, mime: str = "") -> str:
    """按 mime 解析文档，返回纯文本。

    mime 为空时按扩展名推断。
    """
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {path}")

    m = (mime or "").lower()
    if not m:
        ext = path.suffix.lower()
        if ext == ".pdf":
            m = "application/pdf"
        elif ext == ".md":
            m = "text/markdown"
        else:
            m = "text/plain"

    if m == "application/pdf":
        return load_pdf(path)
    if m in ("text/markdown", "text/x-markdown"):
        return _strip_markdown(path.read_text(encoding="utf-8", errors="ignore"))
    # 默认按纯文本
    return path.read_text(encoding="utf-8", errors="ignore")


def guess_mime(filename: str) -> str:
    """按文件名扩展名推断 mime。"""
    ext = Path(filename).suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".md": "text/markdown",
        ".txt": "text/plain",
    }.get(ext, "text/plain")
