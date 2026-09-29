"""上下文组装管线：按固定顺序拼装 messages + tools。

组装顺序（plan 第六节）：
1. system_prompt = agent.system_prompt + 启用 skill 的 description
2. constraint_declaration = 序列化约束声明
3. recovery_advice = 命中的错误回收规则 advice
4. rag_context = 按 agent.kb_ids + 当前 user_msg 检索 ChromaDB
5. compressed_history = 压缩摘要（如有）+ 保留近 N 轮
6. tools = 从 mcp_tools 取，按 allowed_tools 过滤，转 OpenAI tools schema
"""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Agent, Skill, McpTool, ConstraintProfile
from app.modules.harness.constraints import get_profile_constraints
from app.modules.harness import recovery as recovery_mod
from app.modules.mcp.registry import list_tools_by_ids


def discover_tools(agent: Agent, session: Session, allowed_tools: list,
                   forbidden_actions: list) -> list[dict]:
    """从 mcp_tools 表动态取工具，按 allowed_tools 过滤，转 OpenAI tools schema。

    allowed_tools 含 '*' 表示全部允许；否则按 "工具名" 精确匹配。
    """
    server_ids = agent.mcp_server_ids or []
    tools_rows = list_tools_by_ids(session, server_ids)
    # 过滤
    wildcard = "*" in allowed_tools
    forbidden_set = set(forbidden_actions or [])

    candidates: list[McpTool] = []
    for t in tools_rows:
        if t.name in forbidden_set:
            continue
        if wildcard or t.name in allowed_tools:
            candidates.append(t)

    # 转 OpenAI tools schema
    openai_tools = []
    for t in candidates:
        schema = t.input_schema or {"type": "object", "properties": {}}
        openai_tools.append({
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description or "",
                "parameters": schema,
            },
        })
    return openai_tools


def _build_system_prompt(agent: Agent, session: Session) -> str:
    """组装 system prompt：agent.system_prompt + 启用 skill 的描述。"""
    parts = [agent.system_prompt or ""]
    skill_ids = agent.skill_ids or []
    if skill_ids:
        skills = session.exec(
            select(Skill).where(Skill.id.in_(skill_ids)).where(Skill.enabled == True)  # noqa: E712
        ).all()
        if skills:
            parts.append("\n\n## 可用 Skill\n以下 skill 可供参考使用：")
            for s in skills:
                parts.append(f"- {s.name}：{s.description}")
    return "".join(parts)


def _build_constraint_declaration(constraints: dict) -> str:
    """序列化约束声明，注入 system 末尾让 LLM 知道边界。"""
    lines = [
        "\n\n## 行为约束",
        f"- 最大迭代轮次：{constraints['max_iterations']}",
        f"- Token 预算：{constraints['token_budget']}",
    ]
    allowed = constraints.get("allowed_tools", ["*"])
    if "*" in allowed:
        lines.append("- 可用工具：全部（按需选择）")
    else:
        lines.append(f"- 可用工具：{', '.join(allowed)}")
    forbidden = constraints.get("forbidden_actions", [])
    if forbidden:
        lines.append(f"- 禁止操作：{', '.join(forbidden)}")
    cp = constraints.get("compression_policy", {})
    if cp.get("enabled"):
        lines.append(f"- 上下文压缩：启用（触发比例 {cp.get('trigger_ratio', 0.8)}，保留近 {cp.get('keep_recent_turns', 4)} 轮）")
    return "\n".join(lines)


def _build_rag_context(agent: Agent, user_msg: str, session: Session) -> str:
    """按 agent.kb_ids + 当前 user_msg 检索 ChromaDB，注入 system（带引用源）。"""
    kb_ids = agent.kb_ids or []
    if not kb_ids or not user_msg.strip():
        return ""
    top_k = (agent.context_config or {}).get("top_k", 4)
    from app.modules.knowledge.service import search as kb_search
    from app.modules.knowledge.schemas import SearchRequest

    all_hits = []
    for kb_id in kb_ids:
        try:
            result = kb_search(session, kb_id, SearchRequest(query=user_msg, top_k=top_k))
            if result and result.hits:
                for h in result.hits:
                    all_hits.append((kb_id, h))
        except Exception as e:
            logger.warning(f"知识库 {kb_id} 检索失败: {e}")
    if not all_hits:
        return ""
    lines = ["\n\n## 检索到的知识（来自知识库）"]
    for i, (kb_id, h) in enumerate(all_hits, 1):
        src = f"kb{kb_id}_doc{h.doc_id}_chunk{h.chunk_id}"
        lines.append(f"[{i}] (来源:{src}, 相关度:{h.score:.2f})\n{h.text}")
    return "\n".join(lines)


def build(agent: Agent, history: list[dict], user_msg: str, session: Session,
          constraints: dict, conv_id: int | None = None) -> tuple[list[dict], list[dict]]:
    """组装完整上下文。返回 (messages, tools)。

    history: 活跃历史消息（已被压缩裁剪过），格式 [{role, content, tool_calls?, tool_results?}]
    user_msg: 当前用户输入
    """
    # 1. system prompt + skill 描述
    system_text = _build_system_prompt(agent, session)
    # 2. 约束声明
    system_text += _build_constraint_declaration(constraints)
    # 3. recovery advice
    rules = recovery_mod.match_rules(session, None, "", "")  # 宽松匹配全局规则
    # 更精确：按 agent 的 constraint_profile 关联
    if agent.constraint_profile_id:
        cp = session.get(ConstraintProfile, agent.constraint_profile_id)
        if cp:
            # 取该 agent 最近的失败 trace 来匹配更精准（这里取全局 advice 做兜底）
            advice = recovery_mod.build_advice(rules)
            if advice:
                system_text += f"\n\n## 错误回收建议\n{advice}"
    # 4. rag context
    system_text += _build_rag_context(agent, user_msg, session)

    messages: list[dict] = [{"role": "system", "content": system_text}]
    # 5. 压缩历史 + 近 N 轮（history 已由 compressor 裁剪）
    for m in history:
        role = m["role"]
        msg: dict[str, Any] = {"role": role, "content": m.get("content", "")}
        # assistant 的 tool_calls：DB 存简化格式 → OpenAI 标准 {id, type:function, function:{name, arguments(字符串)}}
        if role == "assistant" and m.get("tool_calls"):
            msg["tool_calls"] = [
                {
                    "id": tc.get("id") or "",
                    "type": "function",
                    "function": {
                        "name": tc.get("name", ""),
                        "arguments": (
                            tc.get("arguments")
                            if isinstance(tc.get("arguments"), str)
                            else json.dumps(tc.get("arguments") or {}, ensure_ascii=False)
                        ),
                    },
                }
                for tc in m["tool_calls"]
            ]
        # tool 消息：补 tool_call_id + name（OpenAI tool 消息必需）
        if role == "tool":
            msg["tool_call_id"] = m.get("tool_call_id") or ""
            msg["name"] = m.get("name", "")
        messages.append(msg)
    # 当前 user_msg
    messages.append({"role": "user", "content": user_msg})

    # 6. tools
    tools = discover_tools(agent, session, constraints.get("allowed_tools", ["*"]),
                            constraints.get("forbidden_actions", []))
    # recovery: disable_tool 规则剔除工具
    if rules:
        tools = recovery_mod.disable_tools(rules, tools)

    return messages, tools


def mcp_tool_to_openai(name: str, description: str, input_schema: dict) -> dict:
    """单条 MCP tool → OpenAI tools schema。"""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description or "",
            "parameters": input_schema or {"type": "object", "properties": {}},
        },
    }
