"""智能路由：基于启发式信号的复杂度分类器。

不依赖额外 LLM 调用，基于以下信号综合打分（0-1）：
  - 用户消息长度（token 数）
  - 是否含代码块（```）
  - 是否含数学符号 / 推理关键词
  - 历史工具调用次数（多轮工具调用 → 复杂）
  - 当前是否处于多轮迭代（iteration > 0 视为复杂）

打分公式：
  base = 0.2
  + 长度 > 200 token: +0.2
  + 含代码块: +0.2
  + 含推理关键词: +0.2
  + 历史工具调用次数 > 3: +0.2
  最终截断到 [0, 1]

调用方根据 threshold 选择 simple_model_id 或 complex_model_id。
"""
from __future__ import annotations

import re
from typing import Any

from app.core.logging import logger
from app.utils.tokens import count_tokens


# 推理 / 复杂任务关键词（中英）
_REASONING_KEYWORDS = [
    # 中文
    "分析", "比较", "对比", "设计", "为什么", "如何", "推导", "证明",
    "重构", "优化", "排查", "调试", "规划", "策划", "综合", "归纳",
    "总结", "评估", "评审", "拆解", "实现", "编写", "生成",
    # 英文
    "analyze", "compare", "design", "why", "how", "derive", "prove",
    "refactor", "optimize", "debug", "plan", "implement", "generate",
]

# 数学符号（出现通常意味着计算/推理）
_MATH_SYMBOLS = re.compile(r"[=≠≤≥±×÷∑∏∫√∞π]+|\\[a-zA-Z]+|\\\[|\\\(")

# 代码块标记
_CODE_FENCE = re.compile(r"```")


def classify_complexity(
    user_msg: str,
    history: list[dict] | None = None,
    iteration: int = 0,
) -> dict[str, Any]:
    """对当前用户消息 + 上下文做复杂度分类。

    返回：
      {
        "complexity": float,        # 0-1
        "reason": str,              # 人类可读的判断理由
        "signals": dict[str, Any],  # 各信号明细
      }
    """
    history = history or []
    signals: dict[str, Any] = {}

    # 信号 1：用户消息长度
    msg_tokens = count_tokens(user_msg)
    signals["msg_tokens"] = msg_tokens
    long_msg = msg_tokens > 200
    signals["long_msg"] = long_msg

    # 信号 2：代码块
    has_code = bool(_CODE_FENCE.search(user_msg))
    signals["has_code"] = has_code

    # 信号 3：推理关键词 + 数学符号
    msg_lower = user_msg.lower()
    matched_kw = [kw for kw in _REASONING_KEYWORDS if kw in msg_lower or kw in user_msg]
    has_math = bool(_MATH_SYMBOLS.search(user_msg))
    signals["matched_keywords"] = matched_kw
    signals["has_math"] = has_math
    needs_reasoning = bool(matched_kw) or has_math

    # 信号 4：历史工具调用次数
    tool_call_count = 0
    for m in history:
        if m.get("role") == "assistant" and m.get("tool_calls"):
            tool_call_count += len(m["tool_calls"])
    signals["tool_call_count"] = tool_call_count
    many_tools = tool_call_count > 3
    signals["many_tools"] = many_tools

    # 信号 5：已进入多轮迭代（第 2 轮及以后，意味着上轮 LLM 调用了工具）
    multi_turn = iteration > 0
    signals["multi_turn"] = multi_turn

    # 综合打分
    score = 0.2  # base
    if long_msg:
        score += 0.2
    if has_code:
        score += 0.2
    if needs_reasoning:
        score += 0.2
    if many_tools:
        score += 0.2
    # 多轮迭代小幅加权（避免与 many_tools 重复计算过重）
    if multi_turn:
        score += 0.1

    score = max(0.0, min(1.0, score))

    # 拼接 reason
    reason_parts = []
    if long_msg:
        reason_parts.append(f"长消息({msg_tokens} tokens)")
    if has_code:
        reason_parts.append("含代码块")
    if matched_kw:
        reason_parts.append(f"推理关键词({','.join(matched_kw[:3])})")
    if has_math:
        reason_parts.append("含数学符号")
    if many_tools:
        reason_parts.append(f"多轮工具({tool_call_count}次)")
    if multi_turn:
        reason_parts.append(f"迭代轮次({iteration})")
    reason = "；".join(reason_parts) if reason_parts else "简单查询"

    return {
        "complexity": round(score, 3),
        "reason": reason,
        "signals": signals,
    }


def select_model_by_routing(
    routing_config: dict[str, Any],
    complexity: float,
) -> tuple[int | None, str]:
    """根据 routing_config 和复杂度，返回 (选中的 model_id, 标签)。

    返回标签用于 trace 记录：simple | complex | fallback。
    若配置缺失（model_id 为 None），返回 (None, "fallback")，调用方应用默认 model。
    """
    threshold = float(routing_config.get("threshold", 0.5))
    simple_id = routing_config.get("simple_model_id")
    complex_id = routing_config.get("complex_model_id")

    if complexity >= threshold:
        if complex_id is not None:
            return int(complex_id), "complex"
        # 复杂但未配置复杂模型 → 退回 simple（若有），否则 fallback
        if simple_id is not None:
            return int(simple_id), "complex_fallback_simple"
        return None, "fallback"
    else:
        if simple_id is not None:
            return int(simple_id), "simple"
        # 简单但未配置简单模型 → 退回 complex（若有），否则 fallback
        if complex_id is not None:
            return int(complex_id), "simple_fallback_complex"
        return None, "fallback"


def route_for_agent(
    agent: Any,
    user_msg: str,
    history: list[dict] | None,
    iteration: int,
) -> dict[str, Any]:
    """对一次 LLM 调用做完整路由决策。

    返回：
      {
        "enabled": bool,
        "complexity": float,
        "reason": str,
        "signals": dict,
        "selected_model_id": int | None,  # None 表示用 agent 默认 model
        "label": str,                    # simple | complex | *_fallback_* | fallback
      }
    """
    cfg = agent.routing_config or {}
    if not cfg.get("enabled"):
        return {
            "enabled": False,
            "complexity": 0.0,
            "reason": "路由未启用",
            "signals": {},
            "selected_model_id": None,
            "label": "default",
        }

    result = classify_complexity(user_msg, history, iteration)
    selected_id, label = select_model_by_routing(cfg, result["complexity"])
    logger.info(
        f"路由决策 agent={getattr(agent, 'id', '?')} complexity={result['complexity']} "
        f"label={label} model_id={selected_id} reason={result['reason']}"
    )
    return {
        "enabled": True,
        "complexity": result["complexity"],
        "reason": result["reason"],
        "signals": result["signals"],
        "selected_model_id": selected_id,
        "label": label,
    }
