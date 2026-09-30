"""Prompt 模板 + 缓存路由。

端点（prefix=/api）：
  GET    /prompt-templates                  市场列表
  POST   /prompt-templates                  创建
  GET    /prompt-templates/{tid}            详情
  PUT    /prompt-templates/{tid}            更新
  DELETE /prompt-templates/{tid}            删除
  POST   /prompt-templates/{tid}/render     渲染（不应用）
  POST   /prompt-templates/{tid}/apply/{agent_id}  应用到 Agent system_prompt

  GET    /prompt-cache/stats                缓存统计
  GET    /prompt-cache                      缓存列表
  DELETE /prompt-cache                      清空缓存
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db.engine import get_session
from app.modules.prompt_template import service
from app.modules.prompt_template.schemas import (
    PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateRead,
    PromptTemplateApply, PromptTemplateRenderRequest, PromptTemplateRenderResponse,
    PromptCacheStats,
)

router = APIRouter(tags=["prompt_template"])


# ===== 模板市场 =====
@router.get("/prompt-templates", response_model=list[PromptTemplateRead])
def list_templates(category: str | None = None,
                   all: bool = False,
                   session: Session = Depends(get_session)):
    return service.list_templates(session, category, only_public=not all)


@router.post("/prompt-templates", response_model=PromptTemplateRead)
def create_template(data: PromptTemplateCreate,
                    session: Session = Depends(get_session)):
    return service.create_template(session, data)


@router.get("/prompt-templates/{tid}", response_model=PromptTemplateRead)
def get_template(tid: int, session: Session = Depends(get_session)):
    t = service.get_template(session, tid)
    if not t:
        raise HTTPException(404, "模板不存在")
    return t


@router.put("/prompt-templates/{tid}", response_model=PromptTemplateRead)
def update_template(tid: int, data: PromptTemplateUpdate,
                    session: Session = Depends(get_session)):
    t = service.update_template(session, tid, data)
    if not t:
        raise HTTPException(404, "模板不存在")
    return t


@router.delete("/prompt-templates/{tid}")
def delete_template(tid: int, session: Session = Depends(get_session)):
    if not service.delete_template(session, tid):
        raise HTTPException(404, "模板不存在")
    return {"ok": True}


@router.post("/prompt-templates/{tid}/render", response_model=PromptTemplateRenderResponse)
def render_template(tid: int, data: PromptTemplateRenderRequest,
                    session: Session = Depends(get_session)):
    rendered = service.render_template(session, tid, data.variables)
    if rendered is None:
        raise HTTPException(404, "模板不存在")
    return PromptTemplateRenderResponse(rendered=rendered)


@router.post("/prompt-templates/{tid}/apply/{agent_id}")
def apply_template(tid: int, agent_id: int, data: PromptTemplateApply,
                   session: Session = Depends(get_session)):
    result = service.apply_to_agent(session, tid, agent_id, data.variables)
    if result is None:
        raise HTTPException(404, "模板或 Agent 不存在")
    return result


# ===== Prompt 缓存 =====
@router.get("/prompt-cache/stats", response_model=PromptCacheStats)
def cache_stats(session: Session = Depends(get_session)):
    return service.cache_stats(session)


@router.get("/prompt-cache")
def list_cache(session: Session = Depends(get_session)):
    rows = service.list_cache(session)
    return [
        {
            "id": r.id, "model_name": r.model_name,
            "prompt": r.prompt[:200], "response": r.response[:200],
            "hit_count": r.hit_count, "token_in": r.token_in, "token_out": r.token_out,
            "last_used_at": r.last_used_at, "created_at": r.created_at,
        }
        for r in rows
    ]


@router.delete("/prompt-cache")
def clear_cache(session: Session = Depends(get_session)):
    n = service.clear_cache(session)
    return {"ok": True, "cleared": n}
