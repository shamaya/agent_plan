"""Skill 业务层：CRUD + 版本快照 + 启用禁用。"""
from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Skill, SkillVersion
from app.modules.skill.schemas import SkillCreate, SkillUpdate, SkillRead, SkillVersionRead


def _to_read(s: Skill) -> SkillRead:
    return SkillRead(
        id=s.id, name=s.name, category=s.category, description=s.description,
        prompt_template=s.prompt_template, parameters_schema=s.parameters_schema or {},
        tool_chain=s.tool_chain or [], version=s.version, enabled=s.enabled,
        parent_version_id=s.parent_version_id, created_at=s.created_at,
    )


def list_skills(session: Session, category: str | None = None) -> list[SkillRead]:
    stmt = select(Skill).order_by(Skill.id)
    if category:
        stmt = stmt.where(Skill.category == category)
    rows = session.exec(stmt).all()
    return [_to_read(s) for s in rows]


def get_skill(session: Session, skill_id: int) -> Optional[SkillRead]:
    s = session.get(Skill, skill_id)
    return _to_read(s) if s else None


def create_skill(session: Session, data: SkillCreate) -> SkillRead:
    s = Skill(
        name=data.name, category=data.category, description=data.description,
        prompt_template=data.prompt_template, parameters_schema=data.parameters_schema,
        tool_chain=data.tool_chain, enabled=data.enabled, version=1,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    # 首版快照
    _save_snapshot(session, s)
    logger.info(f"创建 skill id={s.id} name={s.name} version=1")
    return _to_read(s)


def update_skill(session: Session, skill_id: int, data: SkillUpdate) -> Optional[SkillRead]:
    s = session.get(Skill, skill_id)
    if not s:
        return None
    if data.name is not None:
        s.name = data.name
    if data.category is not None:
        s.category = data.category
    if data.description is not None:
        s.description = data.description
    if data.prompt_template is not None:
        s.prompt_template = data.prompt_template
    if data.parameters_schema is not None:
        s.parameters_schema = data.parameters_schema
    if data.tool_chain is not None:
        s.tool_chain = data.tool_chain
    if data.enabled is not None:
        s.enabled = data.enabled
    session.add(s)
    session.commit()
    session.refresh(s)
    return _to_read(s)


def new_version(session: Session, skill_id: int, data: SkillCreate | None = None) -> Optional[SkillRead]:
    """基于现有 skill 创建新版本：递增 version + 存快照。
    data 为 None 时仅存当前快照（不修改字段）。"""
    s = session.get(Skill, skill_id)
    if not s:
        return None
    old_version = s.version
    if data is not None:
        s.name = data.name
        s.category = data.category
        s.description = data.description
        s.prompt_template = data.prompt_template
        s.parameters_schema = data.parameters_schema
        s.tool_chain = data.tool_chain
        s.enabled = data.enabled
    s.version = old_version + 1
    s.parent_version_id = skill_id
    session.add(s)
    session.commit()
    session.refresh(s)
    _save_snapshot(session, s)
    logger.info(f"skill id={s.id} 新版本 {s.version}")
    return _to_read(s)


def toggle_enable(session: Session, skill_id: int, enabled: bool) -> Optional[SkillRead]:
    s = session.get(Skill, skill_id)
    if not s:
        return None
    s.enabled = enabled
    session.add(s)
    session.commit()
    session.refresh(s)
    return _to_read(s)


def delete_skill(session: Session, skill_id: int) -> bool:
    s = session.get(Skill, skill_id)
    if not s:
        return False
    # 删版本快照
    versions = session.exec(
        select(SkillVersion).where(SkillVersion.skill_id == skill_id)
    ).all()
    for v in versions:
        session.delete(v)
    session.delete(s)
    session.commit()
    logger.info(f"删除 skill id={skill_id}")
    return True


def list_versions(session: Session, skill_id: int) -> list[SkillVersionRead]:
    rows = session.exec(
        select(SkillVersion).where(SkillVersion.skill_id == skill_id)
        .order_by(SkillVersion.version.desc())
    ).all()
    return [SkillVersionRead(
        id=v.id, skill_id=v.skill_id, version=v.version,
        snapshot=v.snapshot or {}, created_at=v.created_at,
    ) for v in rows]


def _save_snapshot(session: Session, s: Skill) -> None:
    """存当前 skill 快照到 skill_versions。"""
    snap = {
        "name": s.name, "category": s.category, "description": s.description,
        "prompt_template": s.prompt_template, "parameters_schema": s.parameters_schema,
        "tool_chain": s.tool_chain, "enabled": s.enabled,
    }
    v = SkillVersion(skill_id=s.id, version=s.version, snapshot=snap)
    session.add(v)
    session.commit()


def _parse_simple_fm(text: str) -> dict:
    """无 pyyaml 时的简易 flat YAML 解析（key: value，仅字符串值）。"""
    out = {}
    for line in text.splitlines():
        if ':' in line:
            k, _, v = line.partition(':')
            out[k.strip()] = v.strip()
    return out


def import_from_md(session: Session, content: str) -> SkillRead:
    """从标准 skill Markdown 导入：
    YAML frontmatter（name/description/category/parameters_schema/tool_chain）+ body（prompt_template）。
    无 frontmatter 时整文做 prompt_template，name 取首行。
    """
    import re, json
    try:
        import yaml
    except ImportError:
        yaml = None

    m = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)$', content, re.DOTALL)
    if not m:
        name = (content.strip().split('\n')[0] or 'imported-skill')[:50]
        return create_skill(session, SkillCreate(
            name=name, description='', prompt_template=content,
            parameters_schema={}, tool_chain=[], enabled=True,
        ))
    fm_text, body = m.group(1), m.group(2)
    fm = yaml.safe_load(fm_text) or {} if yaml else _parse_simple_fm(fm_text)
    name = str(fm.get('name') or 'imported-skill')
    desc = str(fm.get('description') or '')
    category = str(fm.get('category') or '')
    params = fm.get('parameters_schema') or {}
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except Exception:
            params = {}
    chain = fm.get('tool_chain') or []
    if isinstance(chain, str):
        try:
            chain = json.loads(chain)
        except Exception:
            chain = []
    return create_skill(session, SkillCreate(
        name=name, category=category, description=desc,
        prompt_template=body, parameters_schema=params,
        tool_chain=chain, enabled=True,
    ))


def render_template(template: str, parameters: dict) -> str:
    """用 {{key}} 占位符替换渲染 prompt_template。"""
    import re
    out = template
    for k, v in (parameters or {}).items():
        out = out.replace("{{" + str(k) + "}}", str(v))
    return out


async def test_skill(session: Session, skill_id: int, parameters: dict,
                     model_id: int | None = None) -> dict:
    """Skill 在线测试：渲染模板 + 可选 LLM 调用。"""
    s = session.get(Skill, skill_id)
    if not s:
        return {"ok": False, "error": "skill 不存在"}
    rendered = render_template(s.prompt_template, parameters)
    result = {"ok": True, "rendered_prompt": rendered}
    if model_id:
        from app.modules.provider.service import get_active_model
        from app.llm.client import build_client
        active = get_active_model(session, model_id)
        if not active:
            result["error"] = "model 不可用"
            return result
        config, model_name, _, max_tokens = active
        try:
            messages = [
                {"role": "system", "content": s.description or "你是一个助手"},
                {"role": "user", "content": rendered},
            ]
            client = build_client(config)
            resp = await client.chat.completions.create(
                model=model_name, messages=messages, max_tokens=max_tokens or 4096,
            )
            result["llm_response"] = resp.choices[0].message.content or ""
        except Exception as e:
            result["error"] = f"LLM 调用失败: {e}"
    return result
