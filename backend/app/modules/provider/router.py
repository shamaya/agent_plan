"""Provider 路由：CRUD + 测试连接 + 模型管理。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db.engine import get_session
from app.modules.provider import service
from app.modules.provider.schemas import (
    ProviderCreate, ProviderUpdate, ProviderRead,
    ModelRead, ModelBatchUpsert, ProviderTestResult,
)

router = APIRouter(tags=["provider"])


@router.get("/providers", response_model=list[ProviderRead])
def list_providers(session: Session = Depends(get_session)):
    return service.list_providers(session)


@router.post("/providers", response_model=ProviderRead)
def create_provider(data: ProviderCreate, session: Session = Depends(get_session)):
    return service.create_provider(session, data)


@router.put("/providers/{provider_id}", response_model=ProviderRead)
def update_provider(provider_id: int, data: ProviderUpdate, session: Session = Depends(get_session)):
    r = service.update_provider(session, provider_id, data)
    if not r:
        raise HTTPException(404, "provider 不存在")
    return r


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: int, session: Session = Depends(get_session)):
    if not service.delete_provider(session, provider_id):
        raise HTTPException(404, "provider 不存在")
    return {"ok": True}


@router.post("/providers/{provider_id}/test", response_model=ProviderTestResult)
async def test_connection(provider_id: int, session: Session = Depends(get_session)):
    return await service.test_connection(session, provider_id)


@router.get("/providers/{provider_id}/models", response_model=list[ModelRead])
def list_models(provider_id: int, session: Session = Depends(get_session)):
    return service.list_models(session, provider_id)


@router.post("/providers/{provider_id}/models", response_model=list[ModelRead])
def batch_upsert_models(provider_id: int, data: ModelBatchUpsert, session: Session = Depends(get_session)):
    r = service.batch_upsert_models(session, provider_id, data)
    if not r:
        raise HTTPException(404, "provider 不存在")
    return r
