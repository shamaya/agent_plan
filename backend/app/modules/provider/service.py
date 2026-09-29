"""Provider 业务层：CRUD + key 加密 + 热加载缓存 + 测试连接。

key 加密用 core.crypto；热加载用 provider_cache；测试连接调 llm.client.list_remote_models。
"""
from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from app.core import crypto
from app.core.logging import logger
from app.db.models import Provider, Model
from app.llm.client import list_remote_models
from app.modules.provider.cache import ProviderConfig, provider_cache
from app.modules.provider.schemas import (
    ProviderCreate, ProviderUpdate, ProviderRead, ModelRead,
    ModelBatchUpsert, ProviderTestResult,
)


def _to_read(p: Provider, session: Session) -> ProviderRead:
    """ORM → 响应模型。解密 key 生成 preview，永不回传明文。"""
    plain = crypto.decrypt(p.api_key_enc) if p.api_key_enc else ""
    model_count = session.exec(
        select(Model).where(Model.provider_id == p.id)
    ).all().__len__()
    return ProviderRead(
        id=p.id, name=p.name, kind=p.kind, base_url=p.base_url,
        has_key=bool(plain), key_preview=crypto.preview(plain),
        headers=p.headers or {}, enabled=p.enabled, created_at=p.created_at,
        model_count=model_count,
    )


def list_providers(session: Session) -> list[ProviderRead]:
    rows = session.exec(select(Provider).order_by(Provider.id)).all()
    return [_to_read(p, session) for p in rows]


def create_provider(session: Session, data: ProviderCreate) -> ProviderRead:
    p = Provider(
        name=data.name, kind=data.kind, base_url=data.base_url,
        api_key_enc=crypto.encrypt(data.api_key) if data.api_key else "",
        headers=data.headers, enabled=data.enabled,
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    logger.info(f"创建 provider id={p.id} name={p.name} kind={p.kind}")
    return _to_read(p, session)


def update_provider(session: Session, provider_id: int, data: ProviderUpdate) -> Optional[ProviderRead]:
    p = session.get(Provider, provider_id)
    if not p:
        return None
    if data.name is not None:
        p.name = data.name
    if data.kind is not None:
        p.kind = data.kind
    if data.base_url is not None:
        p.base_url = data.base_url
    if data.api_key is not None:
        p.api_key_enc = crypto.encrypt(data.api_key)
    if data.headers is not None:
        p.headers = data.headers
    if data.enabled is not None:
        p.enabled = data.enabled
    session.add(p)
    session.commit()
    session.refresh(p)
    provider_cache.invalidate(provider_id)  # 热加载失效
    logger.info(f"更新 provider id={provider_id}")
    return _to_read(p, session)


def delete_provider(session: Session, provider_id: int) -> bool:
    p = session.get(Provider, provider_id)
    if not p:
        return False
    # 级联删除该 provider 下的 models
    models = session.exec(select(Model).where(Model.provider_id == provider_id)).all()
    for m in models:
        session.delete(m)
    session.delete(p)
    session.commit()
    provider_cache.invalidate(provider_id)
    logger.info(f"删除 provider id={provider_id} (含 {len(models)} 个模型)")
    return True


def get_provider_config(session: Session, provider_id: int) -> Optional[ProviderConfig]:
    """取解密后的 ProviderConfig，优先读缓存。"""
    cached = provider_cache.get(provider_id)
    if cached:
        return cached
    p = session.get(Provider, provider_id)
    if not p or not p.enabled:
        return None
    config = ProviderConfig(
        provider_id=p.id, kind=p.kind, base_url=p.base_url,
        api_key=crypto.decrypt(p.api_key_enc) if p.api_key_enc else "",
        headers=p.headers or {}, enabled=p.enabled,
    )
    provider_cache.set(config)
    return config


async def test_connection(session: Session, provider_id: int) -> ProviderTestResult:
    """测试连接：用当前配置实例化客户端列远端模型。"""
    p = session.get(Provider, provider_id)
    if not p:
        return ProviderTestResult(ok=False, error="provider 不存在")
    config = ProviderConfig(
        provider_id=p.id, kind=p.kind, base_url=p.base_url,
        api_key=crypto.decrypt(p.api_key_enc) if p.api_key_enc else "",
        headers=p.headers or {}, enabled=p.enabled,
    )
    try:
        models = await list_remote_models(config)
        return ProviderTestResult(ok=True, models=models)
    except Exception as e:
        return ProviderTestResult(ok=False, error=str(e))


def list_models(session: Session, provider_id: int) -> list[ModelRead]:
    rows = session.exec(select(Model).where(Model.provider_id == provider_id)).all()
    return [ModelRead(
        id=m.id, provider_id=m.provider_id, model_name=m.model_name,
        context_window=m.context_window, max_tokens=m.max_tokens,
        is_default=m.is_default, enabled=m.enabled, created_at=m.created_at,
    ) for m in rows]


def batch_upsert_models(session: Session, provider_id: int, data: ModelBatchUpsert) -> list[ModelRead]:
    """批量入库模型：同名则更新，否则新增。处理 is_default 唯一性。"""
    p = session.get(Provider, provider_id)
    if not p:
        return []
    existing = {m.model_name: m for m in session.exec(
        select(Model).where(Model.provider_id == provider_id)
    ).all()}
    for item in data.models:
        if item.model_name in existing:
            m = existing[item.model_name]
            m.context_window = item.context_window
            m.max_tokens = item.max_tokens
            m.enabled = item.enabled
            m.is_default = item.is_default
            session.add(m)
        else:
            m = Model(
                provider_id=provider_id, model_name=item.model_name,
                context_window=item.context_window, max_tokens=item.max_tokens,
                is_default=item.is_default, enabled=item.enabled,
            )
            session.add(m)
    # is_default 唯一性：本 provider 内同 kind 只保留最后一个 default
    all_models = session.exec(select(Model).where(Model.provider_id == provider_id)).all()
    defaults = [m for m in all_models if m.is_default]
    if len(defaults) > 1:
        for m in defaults[:-1]:
            m.is_default = False
            session.add(m)
    session.commit()
    provider_cache.invalidate(provider_id)
    return list_models(session, provider_id)


def get_active_model(session: Session, model_id: int):
    """取激活 model + provider config，供 agent loop 使用。返回 (config, model_name, ctx_window, max_tokens)。"""
    m = session.get(Model, model_id)
    if not m or not m.enabled:
        return None
    config = get_provider_config(session, m.provider_id)
    if not config:
        return None
    return config, m.model_name, m.context_window, m.max_tokens
