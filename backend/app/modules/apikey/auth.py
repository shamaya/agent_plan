"""ApiKey 鉴权依赖：开放端点用 X-API-Key Header。"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from app.db.engine import get_session
from app.db.models import ApiKey
from app.modules.apikey import service


async def get_api_key_principal(
    x_api_key: str = Header(..., alias="X-API-Key"),
    session: Session = Depends(get_session),
) -> ApiKey:
    """校验 X-API-Key，返回 ApiKey 实例。"""
    principal = service.verify_key(session, x_api_key)
    if not principal:
        raise HTTPException(401, "无效或已禁用的 API Key")
    return principal
