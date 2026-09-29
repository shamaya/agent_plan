"""知识库表：库 + 文档 + 分块元数据。向量存 ChromaDB，本表存元数据 + chroma 引用。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class KnowledgeBase(SQLModel, table=True):
    __tablename__ = "knowledge_bases"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str = ""
    embedding_provider_id: Optional[int] = Field(default=None, foreign_key="providers.id")
    chunk_config: dict[str, Any] = Field(
        default_factory=lambda: {"chunk_size": 500, "overlap": 50},
        sa_column=Column(JSON),
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Document(SQLModel, table=True):
    __tablename__ = "documents"
    id: Optional[int] = Field(default=None, primary_key=True)
    kb_id: int = Field(foreign_key="knowledge_bases.id", index=True)
    filename: str
    mime: str = ""
    status: str = "uploaded"  # uploaded|parsed|chunked|embedded|failed
    chunks_count: int = 0
    source_uri: str = ""
    error: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Chunk(SQLModel, table=True):
    __tablename__ = "chunks"
    id: Optional[int] = Field(default=None, primary_key=True)
    doc_id: int = Field(foreign_key="documents.id", index=True)
    kb_id: int = Field(foreign_key="knowledge_bases.id", index=True)
    ordinal: int
    text: str
    chroma_id: str = ""  # ChromaDB 中对应向量 id
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column("metadata", JSON))
