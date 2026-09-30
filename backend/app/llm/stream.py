"""SSE 事件封装：agent 对话流式返回的多类事件统一格式。

事件类型：token | tool_call | tool_result | compression | trace_step | done | error | approval_request
"""
from __future__ import annotations

import json
from typing import Any


def sse_event(event_type: str, data: dict[str, Any] | None = None) -> str:
    """构造一条 SSE 事件字符串。"""
    payload = {"type": event_type, **(data or {})}
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def done_event(final: str = "") -> str:
    return sse_event("done", {"final": final})


def error_event(message: str) -> str:
    return sse_event("error", {"message": message})


def token_event(text: str) -> str:
    return sse_event("token", {"text": text})


def tool_call_event(tool: str, args: dict) -> str:
    return sse_event("tool_call", {"tool": tool, "args": args})


def tool_result_event(tool: str, result: Any) -> str:
    return sse_event("tool_result", {"tool": tool, "result": result})


def compression_event(pre_tokens: int, post_tokens: int, compressed_range: list, summary: str) -> str:
    return sse_event("compression", {
        "pre_tokens": pre_tokens,
        "post_tokens": post_tokens,
        "compressed_range": compressed_range,
        "summary": summary,
    })


def trace_step_event(step: dict[str, Any]) -> str:
    return sse_event("trace_step", step)


def approval_request_event(approval_id: str, tool: str, args: dict) -> str:
    """推送审批请求到前端。"""
    return sse_event("approval_request", {
        "approval_id": approval_id,
        "tool": tool,
        "args": args,
    })


def routing_event(complexity: float, label: str, model_id: int | None,
                  reason: str, signals: dict | None = None) -> str:
    """推送智能路由决策到前端。"""
    return sse_event("routing", {
        "complexity": complexity,
        "label": label,
        "model_id": model_id,
        "reason": reason,
        "signals": signals or {},
    })
