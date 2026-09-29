"""MCP 路由：server CRUD + 连接发现 + 工具列表 + 工具调用。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from datetime import datetime

from app.db.engine import get_session
from app.db.models import McpServer
from app.modules.mcp import service, client
from app.modules.mcp.schemas import (
    McpServerCreate, McpServerUpdate, McpServerRead,
    McpToolRead, ToolInvokeRequest, ToolInvokeResult,
)

router = APIRouter(tags=["mcp"])


@router.get("/mcp/servers", response_model=list[McpServerRead])
def list_servers(session: Session = Depends(get_session)):
    return service.list_servers(session)


@router.post("/mcp/servers", response_model=McpServerRead)
def create_server(data: McpServerCreate, session: Session = Depends(get_session)):
    return service.create_server(session, data)


@router.put("/mcp/servers/{server_id}", response_model=McpServerRead)
def update_server(server_id: int, data: McpServerUpdate, session: Session = Depends(get_session)):
    r = service.update_server(session, server_id, data)
    if not r:
        raise HTTPException(404, "MCP server 不存在")
    return r


@router.delete("/mcp/servers/{server_id}")
def delete_server(server_id: int, session: Session = Depends(get_session)):
    if not service.delete_server(session, server_id):
        raise HTTPException(404, "MCP server 不存在")
    return {"ok": True}


@router.post("/mcp/servers/{server_id}/discover", response_model=list[McpToolRead])
async def discover_tools(server_id: int, session: Session = Depends(get_session)):
    r = await service.discover_tools(session, server_id)
    if r is None:
        raise HTTPException(404, "MCP server 不存在")
    return r


@router.post("/mcp/servers/{server_id}/connect")
async def connect_server(server_id: int, session: Session = Depends(get_session)):
    """连接测试：尝试 list_tools，更新健康状态，返回 {ok, error}。"""
    s = session.get(McpServer, server_id)
    if not s:
        raise HTTPException(404, "MCP server 不存在")
    try:
        await client.list_tools(s.transport_type, s.config or {})
        s.health_status = "healthy"
        s.last_check_at = datetime.utcnow()
        session.add(s)
        session.commit()
        return {"ok": True}
    except Exception as e:
        s.health_status = "unhealthy"
        s.last_check_at = datetime.utcnow()
        session.add(s)
        session.commit()
        return {"ok": False, "error": str(e)}


@router.get("/mcp/servers/{server_id}/tools", response_model=list[McpToolRead])
def list_tools(server_id: int, session: Session = Depends(get_session)):
    return service.list_tools(session, server_id)


@router.post("/mcp/tools/{tool_id}/invoke", response_model=ToolInvokeResult)
async def invoke_tool(tool_id: int, req: ToolInvokeRequest, session: Session = Depends(get_session)):
    return await service.invoke_tool(session, tool_id, req.arguments)
