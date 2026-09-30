"""Agent 长期记忆：提取、检索、管理。

流程：
  1. 对话结束（done_event 前或后）→ LLM 提取值得记住的事实
  2. 下次对话开始 → 按当前 user_msg 检索相关记忆 → 注入 system prompt
  3. 前端记忆管理页 → 查看/编辑/删除记忆
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import AgentMemory, Agent
from app.modules.provider.service import get_active_model


def list_memories(session: Session, agent_id: int) -> list[AgentMemory]:
    return session.exec(
        select(AgentMemory).where(AgentMemory.agent_id == agent_id)
        .order_by(AgentMemory.importance.desc(), AgentMemory.created_at.desc())
    ).all()


def get_memory(session: Session, memory_id: int) -> AgentMemory | None:
    return session.get(AgentMemory, memory_id)


def create_memory(session: Session, agent_id: int, content: str,
                  memory_type: str = "fact", importance: float = 0.5,
                  metadata_: dict | None = None) -> AgentMemory:
    m = AgentMemory(
        agent_id=agent_id, content=content,
        memory_type=memory_type, importance=importance,
        metadata_=metadata_ or {},
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    logger.info(f"Agent {agent_id} 新增记忆: {content[:80]}")
    return m


def update_memory(session: Session, memory_id: int, content: str | None = None,
                   importance: float | None = None,
                   memory_type: str | None = None) -> AgentMemory | None:
    m = session.get(AgentMemory, memory_id)
    if not m:
        return None
    if content is not None:
        m.content = content
    if importance is not None:
        m.importance = importance
    if memory_type is not None:
        m.memory_type = memory_type
    m.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(m)
    return m


def delete_memory(session: Session, memory_id: int) -> bool:
    m = session.get(AgentMemory, memory_id)
    if not m:
        return False
    session.delete(m)
    session.commit()
    return True


def search_memories(session: Session, agent_id: int, query: str,
                    top_k: int = 5) -> list[AgentMemory]:
    """简单关键词检索（后续可接 ChromaDB 做语义检索）。

    目前：按 content 包含 query 关键词 + importance 排序。
    """
    if not query.strip():
        return []
    keywords = query.strip().lower().split()
    all_mems = session.exec(
        select(AgentMemory).where(AgentMemory.agent_id == agent_id)
    ).all()
    scored = []
    for m in all_mems:
        content_lower = m.content.lower()
        score = sum(1 for kw in keywords if kw in content_lower) * m.importance
        if score > 0:
            scored.append((score, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored[:top_k]]


def build_memory_context(session: Session, agent_id: int, user_msg: str) -> str:
    """检索相关记忆并格式化为注入 system prompt 的文本。"""
    mems = search_memories(session, agent_id, user_msg, top_k=5)
    if not mems:
        return ""
    lines = ["\n\n## 长期记忆（跨会话保留）"]
    for i, m in enumerate(mems, 1):
        lines.append(f"[{i}] ({m.memory_type}, 重要度:{m.importance:.1f}) {m.content}")
    return "\n".join(lines)


async def extract_memories(session: Session, agent_id: int,
                           conversation_messages: list[dict]) -> list[dict]:
    """对话结束后用 LLM 提取值得记住的事实。

    返回 [{"content": "...", "type": "fact", "importance": 0.8}, ...]
    """
    agent = session.get(Agent, agent_id)
    if not agent or not agent.model_id:
        return []
    active = get_active_model(session, agent.model_id)
    if not active:
        return []
    config, model_name, _, _ = active

    # 构建提取 prompt
    conv_text = "\n".join(
        f"{m['role']}: {m['content'][:500]}"
        for m in conversation_messages[-10:]  # 最近 10 条
        if m.get("content")
    )
    if not conv_text.strip():
        return []

    system_prompt = """你是记忆提取器。从以下对话中提取值得长期记住的事实、用户偏好、重要决策。
输出 JSON 数组，每项格式：{"content": "记忆内容", "type": "fact|preference|episodic", "importance": 0.0-1.0}
- fact: 客观事实（用户名、项目名、技术栈等）
- preference: 用户偏好（喜欢简洁回复、偏好 Python 等）
- episodic: 重要事件（做了什么决策、解决了什么问题）
- importance: 0-1，越重要越高
- 如果没有值得记住的内容，返回空数组 []
只输出 JSON，不要其他文字。"""

    from app.llm.client import build_client
    client = build_client(config)
    try:
        resp = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": conv_text},
            ],
            temperature=0.3,
            max_tokens=500,
        )
        text = resp.choices[0].message.content.strip()
        # 提取 JSON
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        memories = json.loads(text)
        if not isinstance(memories, list):
            return []
        # 写入 DB
        saved = []
        for m in memories:
            if not m.get("content"):
                continue
            mem = create_memory(
                session, agent_id,
                content=m["content"],
                memory_type=m.get("type", "fact"),
                importance=float(m.get("importance", 0.5)),
            )
            saved.append({"id": mem.id, "content": mem.content, "type": mem.memory_type})
        logger.info(f"Agent {agent_id} 提取了 {len(saved)} 条记忆")
        return saved
    except Exception as e:
        logger.warning(f"记忆提取失败: {e}")
        return []
