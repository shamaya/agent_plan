"""MCP 工具发现结果缓存：upsert 到 mcp_tools 表。

按 server_id + name 唯一：发现新工具则插入，已存在则更新 schema/description。
"""
from __future__ import annotations

from sqlmodel import Session, select

from app.db.models import McpTool


def upsert_tools(session: Session, server_id: int, tools: list[dict]) -> int:
    """批量 upsert 工具，返回最终工具数。"""
    existing = {t.name: t for t in session.exec(
        select(McpTool).where(McpTool.server_id == server_id)
    ).all()}
    for t in tools:
        name = t.get("name", "")
        if not name:
            continue
        if name in existing:
            row = existing[name]
            row.description = t.get("description", row.description)
            row.input_schema = t.get("input_schema", row.input_schema)
            session.add(row)
        else:
            row = McpTool(
                server_id=server_id, name=name,
                description=t.get("description", ""),
                input_schema=t.get("input_schema", {}),
            )
            session.add(row)
            existing[name] = row
    session.commit()
    return len(existing)


def list_tools_by_server(session: Session, server_id: int) -> list:
    """取某 server 下所有工具。"""
    return session.exec(
        select(McpTool).where(McpTool.server_id == server_id).order_by(McpTool.id)
    ).all()


def list_tools_by_ids(session: Session, server_ids: list[int]) -> list:
    """取多个 server 下的所有工具（agent loop discover_tools 用）。"""
    if not server_ids:
        return []
    rows = session.exec(
        select(McpTool).where(McpTool.server_id.in_(server_ids)).order_by(McpTool.id)
    ).all()
    return rows
