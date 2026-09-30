"""Prompt 模板 CRUD + 渲染 + 缓存。"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select, func

from app.core.logging import logger
from app.db.models import PromptTemplate, PromptCache, Agent
from app.modules.prompt_template.schemas import (
    PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateRead,
)

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z_][\w]*)\s*\}\}")


def _to_read(t: PromptTemplate) -> PromptTemplateRead:
    return PromptTemplateRead(
        id=t.id, name=t.name, description=t.description, category=t.category,
        content=t.content, variables=t.variables or [], tags=t.tags or [],
        is_public=t.is_public, usage_count=t.usage_count,
        created_at=t.created_at, updated_at=t.updated_at,
    )


def list_templates(session: Session, category: Optional[str] = None,
                   only_public: bool = True) -> list[PromptTemplateRead]:
    stmt = select(PromptTemplate).order_by(PromptTemplate.usage_count.desc(), PromptTemplate.id.desc())
    if only_public:
        stmt = stmt.where(PromptTemplate.is_public == True)  # noqa: E712
    if category:
        stmt = stmt.where(PromptTemplate.category == category)
    rows = session.exec(stmt).all()
    return [_to_read(t) for t in rows]


def get_template(session: Session, tid: int) -> Optional[PromptTemplateRead]:
    t = session.get(PromptTemplate, tid)
    return _to_read(t) if t else None


def create_template(session: Session, data: PromptTemplateCreate) -> PromptTemplateRead:
    t = PromptTemplate(
        name=data.name, description=data.description, category=data.category,
        content=data.content,
        variables=[v.model_dump() for v in data.variables],
        tags=data.tags, is_public=data.is_public,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    logger.info(f"创建 prompt 模板 id={t.id} name={t.name}")
    return _to_read(t)


def update_template(session: Session, tid: int, data: PromptTemplateUpdate) -> Optional[PromptTemplateRead]:
    t = session.get(PromptTemplate, tid)
    if not t:
        return None
    for f in ("name", "description", "category", "content", "is_public"):
        v = getattr(data, f)
        if v is not None:
            setattr(t, f, v)
    if data.variables is not None:
        t.variables = [v.model_dump() for v in data.variables]
    if data.tags is not None:
        t.tags = data.tags
    t.updated_at = datetime.utcnow()
    session.add(t)
    session.commit()
    session.refresh(t)
    return _to_read(t)


def delete_template(session: Session, tid: int) -> bool:
    t = session.get(PromptTemplate, tid)
    if not t:
        return False
    session.delete(t)
    session.commit()
    return True


def render_template(session: Session, tid: int, variables: dict) -> Optional[str]:
    """渲染模板：{{var}} 替换为变量值。"""
    t = session.get(PromptTemplate, tid)
    if not t:
        return None
    text = t.content
    for name, val in variables.items():
        text = text.replace("{{" + name + "}}", str(val))
    # usage_count +1
    t.usage_count = (t.usage_count or 0) + 1
    session.add(t)
    session.commit()
    return text


def apply_to_agent(session: Session, tid: int, agent_id: int, variables: dict) -> Optional[dict]:
    """把渲染后的模板写入 Agent 的 system_prompt。"""
    rendered = render_template(session, tid, variables)
    if rendered is None:
        return None
    agent = session.get(Agent, agent_id)
    if not agent:
        return None
    agent.system_prompt = rendered
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return {"agent_id": agent.id, "rendered": rendered}


def extract_variables_from_content(content: str) -> list[dict]:
    """从模板正文自动提取 {{var}} 变量。"""
    names = list(dict.fromkeys(_VAR_RE.findall(content)))
    return [{"name": n, "description": "", "default": ""} for n in names]


# ===== Prompt 缓存 =====
def _hash(prompt: str, model_name: str) -> str:
    return hashlib.sha256(f"{model_name}::{prompt}".encode()).hexdigest()


def cache_get(session: Session, prompt: str, model_name: str) -> Optional[PromptCache]:
    h = _hash(prompt, model_name)
    row = session.exec(select(PromptCache).where(PromptCache.prompt_hash == h)).first()
    if row:
        row.hit_count = (row.hit_count or 0) + 1
        row.last_used_at = datetime.utcnow()
        session.add(row)
        session.commit()
        return row
    return None


def cache_set(session: Session, prompt: str, model_name: str, response: str,
              token_in: int, token_out: int) -> None:
    h = _hash(prompt, model_name)
    existing = session.exec(select(PromptCache).where(PromptCache.prompt_hash == h)).first()
    if existing:
        existing.response = response
        existing.token_in = token_in
        existing.token_out = token_out
        existing.last_used_at = datetime.utcnow()
        session.add(existing)
    else:
        row = PromptCache(
            prompt_hash=h, model_name=model_name, prompt=prompt, response=response,
            token_in=token_in, token_out=token_out, hit_count=0,
        )
        session.add(row)
    session.commit()


def cache_stats(session: Session) -> dict:
    total = session.exec(select(func.count(PromptCache.id))).one()
    hits = session.exec(select(func.coalesce(func.sum(PromptCache.hit_count), 0))).one()
    # token 节省 = 命中次数 * 平均 token_out
    saved = session.exec(
        select(func.coalesce(func.sum(PromptCache.hit_count * PromptCache.token_out), 0))
    ).one()
    return {"total_entries": total, "total_hits": int(hits or 0),
            "total_token_saved": int(saved or 0)}


def list_cache(session: Session, limit: int = 50) -> list[PromptCache]:
    rows = session.exec(
        select(PromptCache).order_by(PromptCache.last_used_at.desc()).limit(limit)
    ).all()
    return list(rows)


def clear_cache(session: Session) -> int:
    rows = session.exec(select(PromptCache)).all()
    for r in rows:
        session.delete(r)
    session.commit()
    return len(rows)
