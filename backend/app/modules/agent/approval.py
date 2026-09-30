"""HITL 审批管理器：内存级 pending approval 存储。

流程：
  1. loop.py 检测到需审批的 tool_call → 生成 approval_id → 推送 SSE → asyncio.Event 等待
  2. 前端收到 approval_request 事件 → 渲染审批卡片 → 用户点击批准/拒绝
  3. 前端 POST /api/approvals/{approval_id} → 设置结果 → asyncio.Event.set()
  4. loop.py 继续：批准则执行工具，拒绝则跳过
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PendingApproval:
    approval_id: str
    conversation_id: int
    tool: str
    args: dict
    # asyncio.Event 用于阻塞 loop 等待用户决策
    decision_event: asyncio.Event = field(default_factory=asyncio.Event)
    approved: Optional[bool] = None  # None=待处理, True=批准, False=拒绝
    reason: str = ""


class ApprovalManager:
    """内存级审批管理器。进程重启后 pending 审批丢失（可接受）。"""

    def __init__(self):
        self._pending: dict[str, PendingApproval] = {}

    def create(self, approval_id: str, conversation_id: int, tool: str, args: dict) -> PendingApproval:
        pa = PendingApproval(
            approval_id=approval_id,
            conversation_id=conversation_id,
            tool=tool,
            args=args,
        )
        self._pending[approval_id] = pa
        return pa

    def get(self, approval_id: str) -> PendingApproval | None:
        return self._pending.get(approval_id)

    def resolve(self, approval_id: str, approved: bool, reason: str = "") -> bool:
        """前端提交审批结果。"""
        pa = self._pending.get(approval_id)
        if not pa or pa.approved is not None:
            return False
        pa.approved = approved
        pa.reason = reason
        pa.decision_event.set()
        return True

    def cancel(self, approval_id: str):
        """取消审批（如对话中断）。"""
        pa = self._pending.pop(approval_id, None)
        if pa:
            pa.approved = False
            pa.reason = "cancelled"
            pa.decision_event.set()

    def cleanup(self, conversation_id: int):
        """取消某个对话的所有 pending 审批。"""
        to_remove = [
            aid for aid, pa in self._pending.items()
            if pa.conversation_id == conversation_id
        ]
        for aid in to_remove:
            self.cancel(aid)


# 全局单例
approval_manager = ApprovalManager()
