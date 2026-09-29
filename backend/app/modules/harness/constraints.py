"""约束执行：迭代上限 / token 预算 / 工具白名单 / 压缩触发判断。

所有检查返回 (ok: bool, reason: str)。agent loop 据此决定 continue / 终止 / 压缩。
"""
from __future__ import annotations

from app.db.models import ConstraintProfile
from app.modules.harness import budgets


class ConstraintViolation(Exception):
    """约束违反（用于 agent loop 提前终止）。"""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def check_iterations(iteration: int, max_iterations: int) -> tuple[bool, str]:
    """迭代上限检查。"""
    if iteration >= max_iterations:
        return False, f"已达迭代上限 {max_iterations}"
    return True, ""


def check_budget(history_tokens: int, token_budget: int) -> tuple[bool, str]:
    """token 预算检查：历史 token 超预算则需压缩。"""
    if history_tokens >= token_budget:
        return False, f"历史 token {history_tokens} 超预算 {token_budget}"
    return True, ""


def allow_tool(tool_name: str, allowed_tools: list, forbidden_actions: list) -> tuple[bool, str]:
    """工具白名单校验。allowed_tools 含 '*' 表示全部允许。"""
    if forbidden_actions:
        if tool_name in forbidden_actions:
            return False, f"工具 {tool_name} 在禁止列表"
    if "*" in allowed_tools:
        return True, ""
    if tool_name in allowed_tools:
        return True, ""
    return False, f"工具 {tool_name} 不在白名单"


def should_compress(compression_policy: dict, history_tokens: int,
                     threshold: int) -> tuple[bool, str]:
    """判断是否应触发上下文压缩。

    compression_policy: {enabled, trigger_ratio, keep_recent_turns}
    threshold: 预算阈值（compute_threshold 算出）
    当 enabled 且 history_tokens >= threshold * trigger_ratio 时触发。
    """
    if not compression_policy or not compression_policy.get("enabled", True):
        return False, "压缩未启用"
    trigger_ratio = compression_policy.get("trigger_ratio", 0.8)
    trigger_line = int(threshold * trigger_ratio)
    if history_tokens >= trigger_line:
        return True, f"历史 token {history_tokens} 达压缩触发线 {trigger_line}"
    return False, ""


def get_profile_constraints(profile: ConstraintProfile) -> dict:
    """从 ConstraintProfile 提取约束参数（agent loop 用）。"""
    return {
        "max_iterations": profile.max_iterations,
        "token_budget": profile.token_budget,
        "allowed_tools": profile.allowed_tools or ["*"],
        "forbidden_actions": profile.forbidden_actions or [],
        "tool_failure_threshold": profile.tool_failure_threshold,
        "compression_policy": profile.compression_policy or {
            "enabled": True, "trigger_ratio": 0.8, "keep_recent_turns": 4
        },
    }
