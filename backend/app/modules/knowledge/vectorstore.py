"""ChromaDB 嵌入式向量库封装。

每个知识库一个 collection，名 `kb_{kb_id}`，持久化到 settings.chroma_path。
embedding 用 llm.embedding：默认本地，kb 配了 embedding_provider_id 时走 API。

设计：本模块只管向量增删查，元数据落 chunks 表由 service 负责。
"""
from __future__ import annotations

import threading
from typing import Optional

from app.config import settings
from app.core.logging import logger

_collection_store: dict = {}
_lock = threading.Lock()


def _client():
    """懒加载 ChromaDB 客户端（PersistentClient，同进程）。"""
    import chromadb

    settings.chroma_path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(settings.chroma_path))


def collection_name(kb_id: int) -> str:
    return f"kb_{kb_id}"


def _get_collection(kb_id: int):
    """获取或创建某知识库的 collection。

    ChromaDB 默认用自带的 embedding 函数；我们改为外部传入向量，
    所以 collection 创建时使用空 embedding_function（add/query 时显式传 embeddings）。
    """
    name = collection_name(kb_id)
    client = _client()
    return client.get_or_create_collection(name=name)


def add(kb_id: int, ids: list[str], texts: list[str], embeddings: list[list[float]],
        metas: list[dict]) -> None:
    """批量写入向量。ChromaDB 不支持空 batch，先过滤。"""
    if not ids:
        return
    col = _get_collection(kb_id)
    col.add(ids=ids, embeddings=embeddings, documents=texts, metadatas=metas)
    logger.info(f"kb_{kb_id} 写入 {len(ids)} 条向量")


def query(kb_id: int, query_embedding: list[float], top_k: int = 4) -> list[dict]:
    """向量检索。返回 [{id, document, metadata, distance}]。"""
    col = _get_collection(kb_id)
    res = col.query(query_embeddings=[query_embedding], n_results=top_k)
    ids = (res.get("ids") or [[]])[0]
    docs = (res.get("documents") or [[]])[0]
    metas = (res.get("metadatas") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    hits = []
    for i in range(len(ids)):
        # ChromaDB distance 越小越相似；转成 score（1 - distance 归一化到 0~1）
        dist = dists[i] if i < len(dists) else 0.0
        score = max(0.0, 1.0 - dist)
        hits.append({
            "chroma_id": ids[i],
            "text": docs[i] if i < len(docs) else "",
            "metadata": metas[i] if i < len(metas) else {},
            "score": score,
        })
    return hits


def delete(kb_id: int, ids: list[str]) -> None:
    """按 chroma id 删除向量。"""
    if not ids:
        return
    col = _get_collection(kb_id)
    col.delete(ids=ids)


def delete_collection(kb_id: int) -> None:
    """删除整个知识库 collection。"""
    client = _client()
    try:
        client.delete_collection(name=collection_name(kb_id))
        logger.info(f"删除 collection {collection_name(kb_id)}")
    except Exception as e:
        logger.warning(f"删除 collection 失败 kb_{kb_id}: {e}")


def count(kb_id: int) -> int:
    """返回某知识库向量数。"""
    try:
        col = _get_collection(kb_id)
        return col.count()
    except Exception:
        return 0
