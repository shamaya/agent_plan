"""MCP 业务层：server CRUD + 连接测试 + 工具发现 + 工具调用。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import McpServer, McpTool
from app.modules.mcp import client, registry
from app.modules.mcp.schemas import (
    McpServerCreate, McpServerUpdate, McpServerRead, McpToolRead,
    ToolInvokeResult,
)


def _to_read(s: McpServer, session: Session) -> McpServerRead:
    tools_count = session.exec(
        select(McpTool).where(McpTool.server_id == s.id)
    ).all().__len__()
    return McpServerRead(
        id=s.id, name=s.name, transport_type=s.transport_type,
        config=s.config or {}, enabled=s.enabled, health_status=s.health_status,
        last_check_at=s.last_check_at, created_at=s.created_at,
        tools_count=tools_count,
    )


def list_servers(session: Session) -> list[McpServerRead]:
    rows = session.exec(select(McpServer).order_by(McpServer.id)).all()
    return [_to_read(s, session) for s in rows]


def create_server(session: Session, data: McpServerCreate) -> McpServerRead:
    s = McpServer(
        name=data.name, transport_type=data.transport_type,
        config=data.config, enabled=data.enabled,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    logger.info(f"创建 MCP server id={s.id} name={s.name} transport={s.transport_type}")
    return _to_read(s, session)


def update_server(session: Session, server_id: int, data: McpServerUpdate) -> Optional[McpServerRead]:
    s = session.get(McpServer, server_id)
    if not s:
        return None
    if data.name is not None:
        s.name = data.name
    if data.transport_type is not None:
        s.transport_type = data.transport_type
    if data.config is not None:
        s.config = data.config
    if data.enabled is not None:
        s.enabled = data.enabled
    session.add(s)
    session.commit()
    session.refresh(s)
    return _to_read(s, session)


def delete_server(session: Session, server_id: int) -> bool:
    s = session.get(McpServer, server_id)
    if not s:
        return False
    # 级联删工具
    tools = session.exec(select(McpTool).where(McpTool.server_id == server_id)).all()
    for t in tools:
        session.delete(t)
    session.delete(s)
    session.commit()
    logger.info(f"删除 MCP server id={server_id}（含 {len(tools)} 工具）")
    return True


async def discover_tools(session: Session, server_id: int) -> Optional[list[McpToolRead]]:
    """连接 server 发现工具，结果写库缓存。"""
    s = session.get(McpServer, server_id)
    if not s:
        return None
    try:
        tools = await client.list_tools(s.transport_type, s.config or {})
        count = registry.upsert_tools(session, server_id, tools)
        s.health_status = "healthy"
        s.last_check_at = datetime.utcnow()
        session.add(s)
        session.commit()
        logger.info(f"MCP server {s.name} 发现 {count} 个工具")
        return list_tools(session, server_id)
    except Exception as e:
        s.health_status = "unhealthy"
        s.last_check_at = datetime.utcnow()
        session.add(s)
        session.commit()
        logger.warning(f"MCP server {s.name} 发现工具失败: {e}")
        return []


def list_tools(session: Session, server_id: int) -> list[McpToolRead]:
    rows = registry.list_tools_by_server(session, server_id)
    return [McpToolRead(
        id=t.id, server_id=t.server_id, name=t.name,
        description=t.description, input_schema=t.input_schema,
        discovered_at=t.discovered_at,
    ) for t in rows]


async def invoke_tool(session: Session, tool_id: int, arguments: dict) -> ToolInvokeResult:
    """调用单个工具：查 tool → 查 server → 连接 → call。"""
    t = session.get(McpTool, tool_id)
    if not t:
        return ToolInvokeResult(ok=False, error="工具不存在")
    s = session.get(McpServer, t.server_id)
    if not s or not s.enabled:
        return ToolInvokeResult(ok=False, error="server 不可用")
    try:
        result = await client.call_tool(s.transport_type, s.config or {}, t.name, arguments)
        return ToolInvokeResult(ok=True, result=result)
    except Exception as e:
        logger.warning(f"调用 MCP 工具 {t.name} 失败: {e}")
        return ToolInvokeResult(ok=False, error=str(e))
