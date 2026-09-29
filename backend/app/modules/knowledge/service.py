"""知识库业务层：建库 / 上传解析分块向量化 / 检索。

文档状态机：uploaded → parsed → chunked → embedded（任一步失败 → failed）。
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from sqlmodel import Session, select

from app.config import settings
from app.core.logging import logger
from app.db.models import KnowledgeBase, Document, Chunk
from app.llm.embedding import embed_texts_local, embed_texts_api
from app.modules.knowledge.chunker import chunk_text
from app.modules.knowledge.loader import load_document, guess_mime
from app.modules.knowledge import vectorstore
from app.modules.knowledge.schemas import (
    KnowledgeBaseCreate, KnowledgeBaseRead, DocumentRead,
    SearchRequest, SearchResult, ChunkHit, ChunkRead,
)
from app.modules.provider.service import get_provider_config


def _kb_to_read(kb: KnowledgeBase, session: Session) -> KnowledgeBaseRead:
    docs_count = session.exec(
        select(Document).where(Document.kb_id == kb.id)
    ).all().__len__()
    return KnowledgeBaseRead(
        id=kb.id, name=kb.name, description=kb.description,
        embedding_provider_id=kb.embedding_provider_id,
        chunk_config=kb.chunk_config or {}, created_at=kb.created_at,
        docs_count=docs_count,
    )


def list_knowledge_bases(session: Session) -> list[KnowledgeBaseRead]:
    rows = session.exec(select(KnowledgeBase).order_by(KnowledgeBase.id)).all()
    return [_kb_to_read(k, session) for k in rows]


def create_knowledge_base(session: Session, data: KnowledgeBaseCreate) -> KnowledgeBaseRead:
    kb = KnowledgeBase(
        name=data.name, description=data.description,
        embedding_provider_id=data.embedding_provider_id,
        chunk_config=data.chunk_config,
    )
    session.add(kb)
    session.commit()
    session.refresh(kb)
    logger.info(f"创建知识库 id={kb.id} name={kb.name}")
    return _kb_to_read(kb, session)


def _embed_texts(kb: KnowledgeBase, texts: list[str]) -> list[list[float]]:
    """同步 embedding：本地或 API。

    本地路径同步直调；API 路径在同步函数里用 asyncio 跑事件循环（仅入库用，
    频次低可接受；检索热路径走异步）。
    """
    if not texts:
        return []
    if not kb.embedding_provider_id:
        return embed_texts_local(texts)
    # API 路径
    import asyncio
    from app.db.engine import engine
    with Session(engine) as s:
        config = get_provider_config(s, kb.embedding_provider_id)
    if not config:
        logger.warning(f"kb {kb.id} 的 embedding provider 不可用，回退本地")
        return embed_texts_local(texts)
    # 取该 provider 的默认 embedding 模型名
    from app.db.models import Model
    with Session(engine) as s:
        m = s.exec(
            select(Model).where(Model.provider_id == kb.embedding_provider_id)
            .where(Model.enabled == True)  # noqa: E712
        ).first()
    model_name = m.model_name if m else "text-embedding-3-small"
    try:
        return asyncio.get_event_loop().run_until_complete(
            embed_texts_api(config, model_name, texts)
        )
    except RuntimeError:
        # 无事件循环时新建
        return asyncio.run(embed_texts_api(config, model_name, texts))


def upload_document(session: Session, kb_id: int, filename: str,
                    content: bytes, mime: str = "") -> Optional[DocumentRead]:
    """上传 → 解析 → 分块 → 向量化，状态机推进。"""
    kb = session.get(KnowledgeBase, kb_id)
    if not kb:
        return None
    mime = mime or guess_mime(filename)
    # 落盘到 upload_path
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    safe_name = f"kb{kb_id}_{filename}"
    fp = settings.upload_path / safe_name
    fp.write_bytes(content)
    # 建 document 记录
    doc = Document(
        kb_id=kb_id, filename=filename, mime=mime, status="uploaded",
        source_uri=str(fp),
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    try:
        # 1. 解析
        doc.status = "parsed"
        session.add(doc)
        session.commit()
        text = load_document(fp, mime)
        if not text.strip():
            doc.status = "failed"
            doc.error = "解析后无文本"
            session.add(doc)
            session.commit()
            return _doc_to_read(doc)

        # 2. 分块
        cfg = kb.chunk_config or {}
        chunks = chunk_text(text, cfg.get("chunk_size", 500), cfg.get("overlap", 50))
        if not chunks:
            doc.status = "failed"
            doc.error = "分块结果为空"
            session.add(doc)
            session.commit()
            return _doc_to_read(doc)
        doc.status = "chunked"
        doc.chunks_count = len(chunks)
        session.add(doc)
        session.commit()

        # 3. 入 chunk 表（无向量引用，待 embedding 后回填 chroma_id）
        chunk_rows = []
        for i, t in enumerate(chunks):
            c = Chunk(doc_id=doc.id, kb_id=kb_id, ordinal=i, text=t)
            chunk_rows.append(c)
            session.add(c)
        session.commit()
        for c in chunk_rows:
            session.refresh(c)

        # 4. 向量化（批量）
        chunk_texts = [c.text for c in chunk_rows]
        try:
            embeddings = _embed_texts(kb, chunk_texts)
        except Exception as e:
            doc.status = "failed"
            doc.error = f"embedding 失败: {e}"
            session.add(doc)
            session.commit()
            logger.error(f"kb {kb_id} doc {doc.id} embedding 失败: {e}")
            return _doc_to_read(doc)

        # 5. 写 ChromaDB
        chroma_ids = [f"kb{kb_id}_doc{doc.id}_c{c.ordinal}" for c in chunk_rows]
        metas = [{"kb_id": kb_id, "doc_id": doc.id, "chunk_id": c.id,
                  "ordinal": c.ordinal} for c in chunk_rows]
        vectorstore.add(kb_id, chroma_ids, chunk_texts, embeddings, metas)
        # 回填 chroma_id
        for c, cid in zip(chunk_rows, chroma_ids):
            c.chroma_id = cid
            session.add(c)
        doc.status = "embedded"
        session.add(doc)
        session.commit()
        logger.info(f"kb {kb_id} doc {doc.id} 完成：{len(chunks)} 块已向量化")
        return _doc_to_read(doc)
    except Exception as e:
        doc.status = "failed"
        doc.error = str(e)
        session.add(doc)
        session.commit()
        logger.error(f"文档处理失败 kb={kb_id} doc={doc.id}: {e}")
        return _doc_to_read(doc)


def list_documents(session: Session, kb_id: int) -> list[DocumentRead]:
    rows = session.exec(
        select(Document).where(Document.kb_id == kb_id).order_by(Document.id)
    ).all()
    return [_doc_to_read(d) for d in rows]


def list_chunks(session: Session, doc_id: int) -> list[ChunkRead]:
    """列出某文档的所有分块（按 ordinal 排序），用于分块预览。"""
    rows = session.exec(
        select(Chunk).where(Chunk.doc_id == doc_id).order_by(Chunk.ordinal)
    ).all()
    return [ChunkRead(
        id=c.id, doc_id=c.doc_id, kb_id=c.kb_id, ordinal=c.ordinal,
        text=c.text, chroma_id=c.chroma_id, meta=c.meta or {},
    ) for c in rows]


def delete_document(session: Session, doc_id: int) -> bool:
    """删除文档及其分块 + 向量。"""
    d = session.get(Document, doc_id)
    if not d:
        return False
    chunks = session.exec(select(Chunk).where(Chunk.doc_id == doc_id)).all()
    for c in chunks:
        session.delete(c)
    # 删向量
    try:
        from app.modules.knowledge import vectorstore
        vectorstore.delete(d.kb_id, [f"kb{d.kb_id}_doc{doc_id}_c{c.ordinal}" for c in chunks])
    except Exception:
        pass
    session.delete(d)
    session.commit()
    logger.info(f"删除文档 id={doc_id}（含 {len(chunks)} 分块）")
    return True


def _doc_to_read(d: Document) -> DocumentRead:
    return DocumentRead(
        id=d.id, kb_id=d.kb_id, filename=d.filename, mime=d.mime,
        status=d.status, chunks_count=d.chunks_count, source_uri=d.source_uri,
        error=d.error, created_at=d.created_at,
    )


def search(session: Session, kb_id: int, req: SearchRequest) -> Optional[SearchResult]:
    """检索：query → embedding → ChromaDB 查 → 回填 chunk 元数据。"""
    kb = session.get(KnowledgeBase, kb_id)
    if not kb:
        return None
    # query embedding
    try:
        q_emb = _embed_texts(kb, [req.query])[0]
    except Exception as e:
        logger.error(f"检索 embedding 失败 kb={kb_id}: {e}")
        return SearchResult(query=req.query, hits=[])

    hits_raw = vectorstore.query(kb_id, q_emb, top_k=req.top_k)
    hits: list[ChunkHit] = []
    for h in hits_raw:
        meta = h.get("metadata", {})
        chunk_id = meta.get("chunk_id", 0)
        # 取 chunk 文本（ChromaDB 里已存 document，但统一从 DB 取保证一致）
        chunk = session.get(Chunk, chunk_id) if chunk_id else None
        text = chunk.text if chunk else h.get("text", "")
        hits.append(ChunkHit(
            chunk_id=chunk_id, doc_id=meta.get("doc_id", 0),
            text=text, score=h.get("score", 0.0), metadata=meta,
        ))
    return SearchResult(query=req.query, hits=hits)


def delete_knowledge_base(session: Session, kb_id: int) -> bool:
    """删知识库 + 文档 + 分块 + 向量。"""
    kb = session.get(KnowledgeBase, kb_id)
    if not kb:
        return False
    # 删向量 collection
    vectorstore.delete_collection(kb_id)
    # 删 chunks + documents
    docs = session.exec(select(Document).where(Document.kb_id == kb_id)).all()
    for d in docs:
        chunks = session.exec(select(Chunk).where(Chunk.doc_id == d.id)).all()
        for c in chunks:
            session.delete(c)
        session.delete(d)
    session.delete(kb)
    session.commit()
    logger.info(f"删除知识库 id={kb_id}（含 {len(docs)} 文档）")
    return True
