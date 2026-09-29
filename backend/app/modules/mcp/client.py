"""MCP 客户端：官方 mcp Python SDK 封装。

按 transport_type 连接，支持 stdio / sse / http。
对外暴露异步：connect_and_list_tools / connect_and_call_tool。

工具协议转换（MCP ↔ OpenAI tools schema）放在 agent.runner 处理，本模块只返回 MCP 原生结构。
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Optional

from app.core.logging import logger


@asynccontextmanager
async def _stdio_session(config: dict):
    """stdio transport：用 StdioServerParameters 启动子进程。"""
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(
        command=config.get("command", ""),
        args=config.get("args", []),
        env=config.get("env"),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


@asynccontextmanager
async def _sse_session(config: dict):
    """SSE transport。"""
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    url = config.get("url", "")
    async with sse_client(url=url, headers=config.get("headers")) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


@asynccontextmanager
async def _http_session(config: dict):
    """Streamable HTTP transport。"""
    from mcp import ClientSession
    from mcp.client.streamablehttp import streamablehttp_client

    url = config.get("url", "")
    async with streamablehttp_client(url=url, headers=config.get("headers")) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


def _session_ctx(transport_type: str, config: dict):
    """按 transport 类型选上下文管理器。"""
    t = (transport_type or "stdio").lower()
    if t == "stdio":
        return _stdio_session(config)
    if t == "sse":
        return _sse_session(config)
    if t == "http":
        return _http_session(config)
    raise ValueError(f"不支持的 transport_type: {transport_type}")


async def list_tools(transport_type: str, config: dict) -> list[dict]:
    """连接 MCP 服务并列出工具。返回 [{name, description, input_schema}]。"""
    tools = []
    try:
        async with _session_ctx(transport_type, config) as session:
            res = await session.list_tools()
            for t in res.tools:
                tools.append({
                    "name": t.name,
                    "description": t.description or "",
                    "input_schema": t.inputSchema or {},
                })
    except Exception as e:
        logger.warning(f"MCP list_tools 失败 ({transport_type}): {e}")
        raise
    return tools


async def call_tool(transport_type: str, config: dict, tool_name: str,
                    arguments: dict) -> Any:
    """连接并调用单个工具，返回结果内容。"""
    async with _session_ctx(transport_type, config) as session:
        res = await session.call_tool(tool_name, arguments=arguments)
        # MCP 返回 CallToolResult，含 content 列表
        contents = []
        for c in (res.content or []):
            # 每个 content 有 type（text/image/resource）
            if hasattr(c, "text"):
                contents.append(c.text)
            else:
                contents.append(str(c))
        if len(contents) == 1:
            return contents[0]
        return contents
