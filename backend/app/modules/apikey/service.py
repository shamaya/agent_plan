"""ApiKey 业务层：CRUD + 生成/校验。"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import ApiKey
from app.modules.apikey.schemas import ApiKeyCreate, ApiKeyUpdate, ApiKeyRead, ApiKeyCreated


def _to_read(k: ApiKey) -> ApiKeyRead:
    return ApiKeyRead(
        id=k.id, name=k.name, key_prefix=k.key_prefix,
        allowed_agent_ids=k.allowed_agent_ids or [], enabled=k.enabled,
        expires_at=k.expires_at, last_used_at=k.last_used_at,
        call_count=k.call_count or 0, created_at=k.created_at,
    )


def _hash_key(raw: str) -> str:
    """SHA-256 哈希。"""
    return hashlib.sha256(raw.encode()).hexdigest()


def list_keys(session: Session) -> list[ApiKeyRead]:
    rows = session.exec(select(ApiKey).order_by(ApiKey.id.desc())).all()
    return [_to_read(k) for k in rows]


def get_key(session: Session, key_id: int) -> Optional[ApiKeyRead]:
    k = session.get(ApiKey, key_id)
    return _to_read(k) if k else None


def create_key(session: Session, data: ApiKeyCreate) -> ApiKeyCreated:
    """生成明文 key（仅此一次返回）+ 存哈希。"""
    raw = secrets.token_urlsafe(32)
    k = ApiKey(
        name=data.name,
        key_prefix=raw[:8],
        key_hash=_hash_key(raw),
        allowed_agent_ids=data.allowed_agent_ids,
        enabled=True,
        expires_at=data.expires_at,
    )
    session.add(k)
    session.commit()
    session.refresh(k)
    logger.info(f"创建 apikey id={k.id} name={k.name} prefix={k.key_prefix}")
    read = _to_read(k)
    return ApiKeyCreated(**read.model_dump(), key=raw)


def update_key(session: Session, key_id: int, data: ApiKeyUpdate) -> Optional[ApiKeyRead]:
    k = session.get(ApiKey, key_id)
    if not k:
        return None
    if data.name is not None:
        k.name = data.name
    if data.allowed_agent_ids is not None:
        k.allowed_agent_ids = data.allowed_agent_ids
    if data.enabled is not None:
        k.enabled = data.enabled
    if data.expires_at is not None:
        k.expires_at = data.expires_at
    session.add(k)
    session.commit()
    session.refresh(k)
    return _to_read(k)


def delete_key(session: Session, key_id: int) -> bool:
    k = session.get(ApiKey, key_id)
    if not k:
        return False
    session.delete(k)
    session.commit()
    logger.info(f"删除 apikey id={key_id}")
    return True


def verify_key(session: Session, raw_key: str) -> Optional[ApiKey]:
    """按哈希查 key，校验 enabled/expires，更新 last_used_at + call_count。
    返回 ApiKey 实例（None 表示无效）。"""
    h = _hash_key(raw_key)
    k = session.exec(select(ApiKey).where(ApiKey.key_hash == h)).first()
    if not k:
        return None
    if not k.enabled:
        return None
    if k.expires_at and k.expires_at < datetime.utcnow():
        return None
    k.last_used_at = datetime.utcnow()
    k.call_count = (k.call_count or 0) + 1
    session.add(k)
    session.commit()
    session.refresh(k)
    return k


def can_access_agent(key: ApiKey, agent_id: int) -> bool:
    """白名单校验：空列表=全部 agent 可用。"""
    if not key.allowed_agent_ids:
        return True
    return agent_id in key.allowed_agent_ids
