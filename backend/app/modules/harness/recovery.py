"""错误回收回路：「每犯错就设计机制使其不再犯」。

- record_failure：记录工具调用失败到 trace（归类错误）
- match_rules：按 agent + tool + 错误模式匹配已有规则
- build_advice：把匹配规则的 advice 拼成提示给 LLM
- disable_tools：按规则从候选工具剔除被禁的
- learn_from_failure：从失败 trace 生成规则草稿
"""
from __future__ import annotations

import re
from typing import Any, Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import ErrorRecoveryRule, Trace


def record_failure(session: Session, trace_id: int, tool_name: str,
                   error: str) -> None:
    """标记某 trace 为失败状态（loop 写 trace 后调）。"""
    t = session.get(Trace, trace_id)
    if not t:
        return
    t.status = "error"
    t.error = error
    t.tool_name = tool_name
    session.add(t)
    session.commit()
    logger.warning(f"记录失败 trace={trace_id} tool={tool_name} error={error[:200]}")


def match_rules(session: Session, agent_id: int | None, tool_name: str,
                error: str) -> list[ErrorRecoveryRule]:
    """匹配错误回收规则：按 agent（含全局 agent_id=None）+ tool + error 正则。"""
    rows = session.exec(
        select(ErrorRecoveryRule).order_by(ErrorRecoveryRule.id)
    ).all()
    matched = []
    for r in rows:
        # agent 过滤：规则绑定了 agent 且不等于当前 agent 则跳过
        if r.agent_id is not None and r.agent_id != agent_id:
            continue
        trig = r.trigger or {}
        # tool 匹配
        rule_tool = trig.get("tool", "")
        if rule_tool and rule_tool != tool_name:
            continue
        # error_pattern 正则匹配
        pattern = trig.get("error_pattern", "")
        if pattern:
            try:
                if not re.search(pattern, error):
                    continue
            except re.error:
                continue
        matched.append(r)
    return matched


def build_advice(rules: list[ErrorRecoveryRule]) -> str:
    """把匹配规则的 advice 拼成一段给 LLM 的提示。"""
    advices = [r.advice for r in rules if r.advice]
    if not advices:
        return ""
    return "\n".join(f"- {a}" for a in advices)


def disable_tools(rules: list[ErrorRecoveryRule], tools: list[dict]) -> list[dict]:
    """按 disable_tool 规则从候选工具剔除被禁的。"""
    disabled_names = set()
    for r in rules:
        if r.action == "disable_tool":
            trig = r.trigger or {}
            name = trig.get("tool", "")
            if name:
                disabled_names.add(name)
    if not disabled_names:
        return tools
    return [t for t in tools if t.get("function", {}).get("name") not in disabled_names]


def learn_from_failure(session: Session, trace_id: int) -> dict[str, Any]:
    """从失败 trace 生成规则草稿，回填 source_trace_id。

    返回 {trigger, action, advice, source_trace_id}，由 router 组装 rule。
    """
    t = session.get(Trace, trace_id)
    if not t:
        return {}
    tool = t.tool_name or ""
    error = t.error or ""
    # 简单错误归类
    if "timeout" in error.lower() or "timed out" in error.lower():
        action = "retry_with_advice"
        advice = f"工具 {tool} 超时，建议减少参数范围或拆分任务后重试。"
    elif "connection" in error.lower() or "refused" in error.lower():
        action = "disable_tool"
        advice = f"工具 {tool} 连接失败，建议暂时禁用该工具并检查 MCP 服务状态。"
    elif "permission" in error.lower() or "forbidden" in error.lower():
        action = "disable_tool"
        advice = f"工具 {tool} 权限不足，建议检查权限配置或改用其它工具。"
    else:
        action = "retry_with_advice"
        advice = f"工具 {tool} 调用失败（{error[:100]}），建议换种方式或参数重试。"

    # 生成 error_pattern：取错误中关键片段
    pattern = ""
    if error:
        # 取第一个有意义的单词序列做正则
        key = error.strip().split("\n")[0][:60]
        pattern = re.escape(key) if key else ""

    return {
        "agent_id": t.agent_id,
        "trigger": {"tool": tool, "error_pattern": pattern},
        "action": action,
        "advice": advice,
        "source_trace_id": trace_id,
        "trace_summary": {
            "trace_id": trace_id,
            "tool": tool,
            "error": error[:300],
            "step_type": t.step_type,
        },
    }
