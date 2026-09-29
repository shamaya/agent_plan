"""知识库的 Pydantic 请求响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ===== 请求 =====
class KnowledgeBaseCreate(BaseModel):
    name: str
    description: str = ""
    embedding_provider_id: int | None = None  # None 表示用本地 embedding
    chunk_config: dict[str, Any] = Field(
        default_factory=lambda: {"chunk_size": 500, "overlap": 50}
    )


class SearchRequest(BaseModel):
    query: str
    top_k: int = 4


# ===== 响应 =====
class KnowledgeBaseRead(BaseModel):
    id: int
    name: str
    description: str
    embedding_provider_id: int | None
    chunk_config: dict[str, Any]
    created_at: datetime | None = None
    docs_count: int = 0


class DocumentRead(BaseModel):
    id: int
    kb_id: int
    filename: str
    mime: str
    status: str
    chunks_count: int
    source_uri: str
    error: str = ""
    created_at: datetime | None = None


class ChunkHit(BaseModel):
    chunk_id: int
    doc_id: int
    text: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class SearchResult(BaseModel):
    query: str
    hits: list[ChunkHit]


class ChunkRead(BaseModel):
    id: int
    doc_id: int
    kb_id: int
    ordinal: int
    text: str
    chroma_id: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)
