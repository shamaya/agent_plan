"""知识库路由：建库 / 上传文档 / 列文档 / 检索 / 删库。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session

from app.db.engine import get_session
from app.modules.knowledge import service
from app.modules.knowledge.schemas import (
    KnowledgeBaseCreate, KnowledgeBaseRead, DocumentRead,
    SearchRequest, SearchResult, ChunkRead,
)

router = APIRouter(tags=["knowledge"])


@router.get("/knowledge", response_model=list[KnowledgeBaseRead])
def list_knowledge_bases(session: Session = Depends(get_session)):
    return service.list_knowledge_bases(session)


@router.post("/knowledge", response_model=KnowledgeBaseRead)
def create_knowledge_base(data: KnowledgeBaseCreate, session: Session = Depends(get_session)):
    return service.create_knowledge_base(session, data)


@router.delete("/knowledge/{kb_id}")
def delete_knowledge_base(kb_id: int, session: Session = Depends(get_session)):
    if not service.delete_knowledge_base(session, kb_id):
        raise HTTPException(404, "知识库不存在")
    return {"ok": True}


@router.post("/knowledge/{kb_id}/documents", response_model=DocumentRead)
async def upload_document(
    kb_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    content = await file.read()
    r = service.upload_document(
        session, kb_id, file.filename or "unnamed", content,
        mime=file.content_type or "",
    )
    if r is None:
        raise HTTPException(404, "知识库不存在")
    return r


@router.get("/knowledge/{kb_id}/documents", response_model=list[DocumentRead])
def list_documents(kb_id: int, session: Session = Depends(get_session)):
    return service.list_documents(session, kb_id)


@router.get("/knowledge/{kb_id}/documents/{doc_id}/chunks", response_model=list[ChunkRead])
def list_chunks(kb_id: int, doc_id: int, session: Session = Depends(get_session)):
    """文档分块预览：按 ordinal 列出所有 chunk。"""
    return service.list_chunks(session, doc_id)


@router.delete("/knowledge/{kb_id}/documents/{doc_id}")
def delete_document(kb_id: int, doc_id: int, session: Session = Depends(get_session)):
    if not service.delete_document(session, doc_id):
        raise HTTPException(404, "文档不存在")
    return {"ok": True}


@router.post("/knowledge/{kb_id}/search", response_model=SearchResult)
def search(kb_id: int, req: SearchRequest, session: Session = Depends(get_session)):
    r = service.search(session, kb_id, req)
    if r is None:
        raise HTTPException(404, "知识库不存在")
    return r
