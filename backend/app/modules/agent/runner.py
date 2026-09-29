"""LLM 调用封装：流式 chat completions + tool_calls 累积。

OpenAI 流式响应里 tool_calls 是分片 delta，需逐片拼接 index+arguments JSON。
本模块封装为 async generator，yield 标准事件 dict 供 loop 消费。
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator

from app.core.logging import logger
from app.llm.client import build_client
from app.modules.provider.cache import ProviderConfig


async def call_llm(
    config: ProviderConfig,
    model_name: str,
    messages: list[dict],
    tools: list[dict] | None = None,
) -> AsyncIterator[dict]:
    """流式调用 LLM，yield 事件 dict。

    事件类型：
    - {"type": "token", "text": "..."}：文本增量
    - {"type": "tool_calls", "tool_calls": [{"id", "name", "arguments"}]}
    - {"type": "done", "content": "..."}：最终完成（无 tool_calls 时）
    - {"type": "error", "message": "..."}
    """
    client = build_client(config)
    kwargs: dict = {
        "model": model_name,
        "messages": messages,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools

    try:
        stream = await client.chat.completions.create(**kwargs)
    except Exception as e:
        logger.error(f"LLM 调用失败: {e}")
        yield {"type": "error", "message": str(e)}
        return

    content_parts: list[str] = []
    # tool_calls 分片累积：{index: {"id":..., "name":..., "arguments": ""}}
    tool_call_acc: dict[int, dict] = {}

    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            # 文本增量
            if delta and delta.content:
                content_parts.append(delta.content)
                yield {"type": "token", "text": delta.content}

            # tool_calls 分片
            if delta and delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tool_call_acc:
                        tool_call_acc[idx] = {
                            "id": tc_delta.id or "",
                            "name": "",
                            "arguments": "",
                        }
                    if tc_delta.function:
                        if tc_delta.function.name:
                            tool_call_acc[idx]["name"] = tc_delta.function.name
                        if tc_delta.function.arguments:
                            tool_call_acc[idx]["arguments"] += tc_delta.function.arguments

            # finish_reason
            if chunk.choices[0].finish_reason:
                break
    except Exception as e:
        logger.error(f"LLM 流式读取失败: {e}")
        yield {"type": "error", "message": str(e)}
        return

    # 整理 tool_calls
    if tool_call_acc:
        final_tool_calls = []
        for idx in sorted(tool_call_acc.keys()):
            tc = tool_call_acc[idx]
            # 解析 arguments JSON
            args_str = tc["arguments"] or "{}"
            try:
                args = json.loads(args_str) if args_str.strip() else {}
            except json.JSONDecodeError:
                logger.warning(f"tool_call arguments 解析失败: {args_str[:200]}")
                args = {"_raw": args_str}
            final_tool_calls.append({
                "id": tc["id"],
                "name": tc["name"],
                "arguments": args,
            })
        yield {"type": "tool_calls", "tool_calls": final_tool_calls}
    else:
        yield {"type": "done", "content": "".join(content_parts)}


async def invoke_tool_for_call(
    config: ProviderConfig,  # unused，保留接口对称
    tool_name: str,
    arguments: dict,
    mcp_server_config: dict,
    transport_type: str,
) -> Any:
    """调用单个 MCP 工具（包装 mcp.client.call_tool）。

    tool_name: MCP 工具名
    arguments: OpenAI tool_call 的 arguments（已解析的 dict）
    """
    from app.modules.mcp.client import call_tool
    return await call_tool(transport_type, mcp_server_config, tool_name, arguments)


def openai_tool_call_to_mcp(tool_call: dict) -> tuple[str, dict]:
    """OpenAI tool_call → (tool_name, arguments_dict)。"""
    return tool_call.get("name", ""), tool_call.get("arguments", {})


def mcp_result_to_message(tool_name: str, result: Any, tool_call_id: str = "") -> dict:
    """工具结果 → OpenAI tool 消息格式。"""
    content = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
    return {
        "role": "tool",
        "content": content,
        "name": tool_name,
        "tool_call_id": tool_call_id,
    }
