"""Guardrail 校验引擎：按规则类型检查输出内容。"""
from __future__ import annotations

import json
import re
from typing import Any

from app.db.models import GuardrailRule
from app.modules.guardrail.schemas import GuardrailCheckResult, GuardrailBatchResult


def check_rule(rule: GuardrailRule, content: str) -> GuardrailCheckResult:
    """检查单条规则。返回 GuardrailCheckResult。"""
    cfg = rule.config or {}
    rtype = rule.type

    try:
        if rtype == "regex":
            pattern = cfg.get("pattern", "")
            negate = bool(cfg.get("negate", False))
            if not pattern:
                return GuardrailCheckResult(
                    rule_id=rule.id, rule_name=rule.name, passed=True,
                    message="", action=rule.action,
                )
            matched = bool(re.search(pattern, content))
            # negate=True 表示"不能匹配"（如不允许出现某关键词）
            passed = (not matched) if negate else matched
            msg = "" if passed else (
                f"正则 {'不允许匹配' if negate else '要求匹配'} {pattern}"
            )
            return GuardrailCheckResult(
                rule_id=rule.id, rule_name=rule.name, passed=passed,
                message=msg, action=rule.action,
            )

        elif rtype == "length":
            min_len = cfg.get("min", 0) or 0
            max_len = cfg.get("max")
            length = len(content)
            passed = length >= min_len and (max_len is None or length <= max_len)
            msg = "" if passed else (
                f"长度 {length} 不在 [{min_len}, {max_len}] 范围内"
            )
            return GuardrailCheckResult(
                rule_id=rule.id, rule_name=rule.name, passed=passed,
                message=msg, action=rule.action,
            )

        elif rtype == "keyword":
            keywords = cfg.get("keywords", []) or []
            found = [kw for kw in keywords if kw in content]
            passed = len(found) == 0
            msg = "" if passed else f"包含禁用关键词：{found}"
            return GuardrailCheckResult(
                rule_id=rule.id, rule_name=rule.name, passed=passed,
                message=msg, action=rule.action,
            )

        elif rtype == "json_format":
            # 要求内容是合法 JSON
            try:
                parsed = json.loads(content)
                required = cfg.get("required_fields", []) or []
                missing = [f for f in required if f not in parsed]
                passed = len(missing) == 0
                msg = "" if passed else f"JSON 缺少字段：{missing}"
                return GuardrailCheckResult(
                    rule_id=rule.id, rule_name=rule.name, passed=passed,
                    message=msg, action=rule.action,
                )
            except json.JSONDecodeError as e:
                return GuardrailCheckResult(
                    rule_id=rule.id, rule_name=rule.name, passed=False,
                    message=f"非合法 JSON：{e}", action=rule.action,
                )

        elif rtype == "json_schema":
            # 简易 JSON Schema 校验（仅支持 type / properties / required）
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as e:
                return GuardrailCheckResult(
                    rule_id=rule.id, rule_name=rule.name, passed=False,
                    message=f"非合法 JSON：{e}", action=rule.action,
                )
            schema = cfg.get("schema", {}) or {}
            if not schema:
                return GuardrailCheckResult(
                    rule_id=rule.id, rule_name=rule.name, passed=True,
                    message="", action=rule.action,
                )
            # 校验 type
            if schema.get("type") == "object" and not isinstance(parsed, dict):
                return GuardrailCheckResult(
                    rule_id=rule.id, rule_name=rule.name, passed=False,
                    message="不是 object 类型", action=rule.action,
                )
            # 校验 required
            required = schema.get("required", []) or []
            missing = [f for f in required if f not in parsed]
            if missing:
                return GuardrailCheckResult(
                    rule_id=rule.id, rule_name=rule.name, passed=False,
                    message=f"缺少必需字段：{missing}", action=rule.action,
                )
            return GuardrailCheckResult(
                rule_id=rule.id, rule_name=rule.name, passed=True,
                message="", action=rule.action,
            )

        elif rtype == "starts_with":
            prefix = cfg.get("prefix", "")
            passed = content.startswith(prefix) if prefix else True
            msg = "" if passed else f"未以 {prefix} 开头"
            return GuardrailCheckResult(
                rule_id=rule.id, rule_name=rule.name, passed=passed,
                message=msg, action=rule.action,
            )

        else:
            # 未知类型，视为通过（不拦截）
            return GuardrailCheckResult(
                rule_id=rule.id, rule_name=rule.name, passed=True,
                message="", action=rule.action,
            )

    except Exception as e:
        # 校验本身出错，不拦截（避免误杀）
        return GuardrailCheckResult(
            rule_id=rule.id, rule_name=rule.name, passed=True,
            message=f"校验异常（跳过）: {e}", action=rule.action,
        )


def check_all(rules: list[GuardrailRule], content: str) -> GuardrailBatchResult:
    """批量校验所有规则。"""
    results = [check_rule(r, content) for r in rules]
    violated = [r.rule_id for r in results if not r.passed]
    return GuardrailBatchResult(
        passed=len(violated) == 0,
        results=results,
        violated_rule_ids=violated,
    )


def build_retry_feedback(violations: list[GuardrailCheckResult]) -> str:
    """构造重试时追加给 LLM 的反馈提示。"""
    lines = ["【输出未通过校验，请修正后重新回答】"]
    for v in violations:
        lines.append(f"- 规则「{v.rule_name}」：{v.message}")
    lines.append("请在保持回答质量的前提下修正上述问题，直接输出修正后的回答，不要输出其他说明。")
    return "\n".join(lines)
