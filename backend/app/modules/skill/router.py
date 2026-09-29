"""Skill 路由：CRUD + 版本 + 启用禁用 + 分类。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db.engine import get_session
from app.modules.skill import service
from app.modules.skill.schemas import (
    SkillCreate, SkillUpdate, SkillRead, SkillVersionRead, SkillImportRequest,
    SkillTestRequest,
)

router = APIRouter(tags=["skill"])


@router.get("/skills", response_model=list[SkillRead])
def list_skills(category: str | None = None, session: Session = Depends(get_session)):
    return service.list_skills(session, category)


@router.post("/skills", response_model=SkillRead)
def create_skill(data: SkillCreate, session: Session = Depends(get_session)):
    return service.create_skill(session, data)


@router.post("/skills/import-md", response_model=SkillRead)
def import_skill_md(data: SkillImportRequest, session: Session = Depends(get_session)):
    """从标准 skill Markdown 导入（YAML frontmatter + body）。"""
    return service.import_from_md(session, data.content)


@router.post("/skills/{skill_id}/test")
async def test_skill(skill_id: int, data: SkillTestRequest, session: Session = Depends(get_session)):
    """Skill 在线测试：参数渲染模板，可选 model_id 实际跑 LLM。"""
    return await service.test_skill(session, skill_id, data.parameters, data.model_id)


@router.get("/skills/{skill_id}", response_model=SkillRead)
def get_skill(skill_id: int, session: Session = Depends(get_session)):
    s = service.get_skill(session, skill_id)
    if not s:
        raise HTTPException(404, "skill 不存在")
    return s


@router.put("/skills/{skill_id}", response_model=SkillRead)
def update_skill(skill_id: int, data: SkillUpdate, session: Session = Depends(get_session)):
    s = service.update_skill(session, skill_id, data)
    if not s:
        raise HTTPException(404, "skill 不存在")
    return s


@router.post("/skills/{skill_id}/version", response_model=SkillRead)
def new_version(skill_id: int, data: SkillCreate | None = None, session: Session = Depends(get_session)):
    s = service.new_version(session, skill_id, data)
    if not s:
        raise HTTPException(404, "skill 不存在")
    return s


@router.post("/skills/{skill_id}/enable", response_model=SkillRead)
def toggle_enable(skill_id: int, enabled: bool = True, session: Session = Depends(get_session)):
    s = service.toggle_enable(session, skill_id, enabled)
    if not s:
        raise HTTPException(404, "skill 不存在")
    return s


@router.get("/skills/{skill_id}/versions", response_model=list[SkillVersionRead])
def list_versions(skill_id: int, session: Session = Depends(get_session)):
    return service.list_versions(session, skill_id)


@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: int, session: Session = Depends(get_session)):
    if not service.delete_skill(session, skill_id):
        raise HTTPException(404, "skill 不存在")
    return {"ok": True}
