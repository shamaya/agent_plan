"""ApiKey 管理端点（管理后台用，prefix=/api/apikeys）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db.engine import get_session
from app.modules.apikey import service
from app.modules.apikey.schemas import (
    ApiKeyCreate, ApiKeyUpdate, ApiKeyRead, ApiKeyCreated,
)

router = APIRouter()


@router.get("/apikeys", response_model=list[ApiKeyRead])
def list_keys(session: Session = Depends(get_session)):
    return service.list_keys(session)


@router.post("/apikeys", response_model=ApiKeyCreated)
def create_key(data: ApiKeyCreate, session: Session = Depends(get_session)):
    """创建 Key，明文 key 仅此一次返回。"""
    return service.create_key(session, data)


@router.get("/apikeys/{key_id}", response_model=ApiKeyRead)
def get_key(key_id: int, session: Session = Depends(get_session)):
    k = service.get_key(session, key_id)
    if not k:
        raise HTTPException(404, "API Key 不存在")
    return k


@router.put("/apikeys/{key_id}", response_model=ApiKeyRead)
def update_key(key_id: int, data: ApiKeyUpdate, session: Session = Depends(get_session)):
    k = service.update_key(session, key_id, data)
    if not k:
        raise HTTPException(404, "API Key 不存在")
    return k


@router.delete("/apikeys/{key_id}")
def delete_key(key_id: int, session: Session = Depends(get_session)):
    if not service.delete_key(session, key_id):
        raise HTTPException(404, "API Key 不存在")
    return {"ok": True}
