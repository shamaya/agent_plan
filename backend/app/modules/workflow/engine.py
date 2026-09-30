"""DAG 引擎：拓扑排序 + 节点执行 + 上下文传递。

节点执行复用 agent_loop.run_agent（SSE 流式），收集最终 token 文本作为节点输出。
上游节点的输出按 {{upstream.<node_id>}} 注入到下游节点的 prompt_template。
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, AsyncIterator

from sqlmodel import Session

from app.core.logging import logger
from app.db.models import Agent, Conversation, Workflow, WorkflowRun
from app.modules.agent import service as agent_service, loop as agent_loop
from app.modules.workflow import service as wf_service

# 占位符正则：{{input.x}} 或 {{upstream.n1}} 或 {{input.a.b}}
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_][\w\.]*)\s*\}\}")


def validate_dag(nodes: list[dict]) -> tuple[bool, list[str]]:
    """校验 DAG：
    - 节点 id 唯一
    - depends_on 引用的节点存在
    - 无环（拓扑排序可完成所有节点）
    - agent_id 必填
    """
    errors: list[str] = []
    ids = [n.get("id") for n in nodes]
    # 1. id 唯一
    seen = set()
    for nid in ids:
        if not nid:
            errors.append("存在空节点 id")
            continue
        if nid in seen:
            errors.append(f"节点 id 重复：{nid}")
        seen.add(nid)
    # 2. depends_on 引用合法
    for n in nodes:
        for dep in n.get("depends_on", []) or []:
            if dep not in ids:
                errors.append(f"节点 {n.get('id')} 依赖不存在的节点：{dep}")
    # 3. agent_id 必填
    for n in nodes:
        if not n.get("agent_id"):
            errors.append(f"节点 {n.get('id')} 缺少 agent_id")
    # 4. 环检测（Kahn）
    if not errors:
        try:
            topo = topological_sort(nodes)
            logger.debug(f"DAG 拓扑序：{[n['id'] for n in topo]}")
        except ValueError as e:
            errors.append(f"拓扑排序失败：{e}")
    return (len(errors) == 0, errors)


def topological_sort(nodes: list[dict]) -> list[dict]:
    """Kahn 算法拓扑排序。返回排好序的节点列表。
    若有环，抛出 ValueError。
    """
    node_map = {n["id"]: n for n in nodes}
    in_degree = {n["id"]: 0 for n in nodes}
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for n in nodes:
        for dep in n.get("depends_on", []) or []:
            adj[dep].append(n["id"])
            in_degree[n["id"]] += 1
    queue = [nid for nid, d in in_degree.items() if d == 0]
    result: list[dict] = []
    while queue:
        nid = queue.pop(0)
        result.append(node_map[nid])
        for child in adj[nid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)
    if len(result) != len(nodes):
        cycle = [nid for nid, d in in_degree.items() if d > 0]
        raise ValueError(f"检测到环，节点：{cycle}")
    return result


def render_prompt(template: str, input_data: dict[str, Any],
                  upstream: dict[str, str]) -> str:
    """渲染 prompt 模板：
      {{input.x}}      → input_data["x"]
      {{upstream.n1}}  → upstream["n1"]
    未找到的占位符保留原文并标注 [missing]。
    """
    def repl(m: re.Match) -> str:
        path = m.group(1)
        parts = path.split(".")
        root = parts[0]
        try:
            if root == "input":
                val: Any = input_data
                for p in parts[1:]:
                    val = val[p] if isinstance(val, dict) else getattr(val, p, None)
            elif root == "upstream":
                val = upstream.get(parts[1]) if len(parts) > 1 else None
            else:
                return f"[unknown:{path}]"
            if val is None:
                return f"[missing:{path}]"
            return str(val)
        except Exception:
            return f"[missing:{path}]"

    return _PLACEHOLDER_RE.sub(repl, template)


async def _invoke_node(agent: Agent, prompt: str, conv: Conversation,
                       session: Session) -> dict:
    """执行单个节点：调用 agent_loop.run_agent，收集 token 文本 + tool_calls。"""
    content_parts: list[str] = []
    tool_calls: list[dict] = []
    error_msg: str = ""
    async for sse_str in agent_loop.run_agent(agent, prompt, conv, session):
        if not sse_str.startswith("data: "):
            continue
        try:
            evt = json.loads(sse_str[6:])
        except Exception:
            continue
        etype = evt.get("type")
        if etype == "token":
            content_parts.append(evt.get("text", ""))
        elif etype == "tool_call":
            tool_calls.append({
                "name": evt.get("tool"), "args": evt.get("args", {}),
            })
        elif etype == "done":
            final = evt.get("final", "")
            if final and not content_parts:
                content_parts.append(final)
        elif etype == "error":
            error_msg = evt.get("message", "未知错误")
            break
    return {
        "content": "".join(content_parts),
        "tool_calls": tool_calls,
        "error": error_msg,
    }


async def run_workflow(workflow: Workflow, run: WorkflowRun,
                       session: Session) -> AsyncIterator[str]:
    """执行工作流。yield SSE 事件：
      node_start / node_token / node_done / node_error / workflow_done / workflow_error
    """
    from app.llm.stream import sse_event

    nodes = workflow.nodes or []
    ok, errors = validate_dag(nodes)
    if not ok:
        wf_service.update_run(session, run,
            status="failed", error="; ".join(errors),
            finished_at=datetime.utcnow())
        yield sse_event("workflow_error", {"errors": errors})
        return

    wf_service.update_run(session, run, status="running",
                          started_at=datetime.utcnow())
    yield sse_event("workflow_start", {
        "run_id": run.id, "workflow_id": workflow.id,
        "node_count": len(nodes),
    })

    ordered = topological_sort(nodes)
    upstream_outputs: dict[str, str] = {}

    for i, node in enumerate(ordered):
        node_id = node["id"]
        node_name = node.get("name") or node_id
        agent_id = node["agent_id"]
        template = node.get("prompt_template", "") or ""

        # 渲染 prompt
        prompt = render_prompt(template, run.input or {}, upstream_outputs)
        # 若模板为空，退化为把 input 整体作为 prompt
        if not prompt:
            prompt = json.dumps(run.input or {}, ensure_ascii=False)

        yield sse_event("node_start", {
            "node_id": node_id, "node_name": node_name,
            "agent_id": agent_id, "index": i, "total": len(ordered),
            "rendered_prompt": prompt[:500],
        })

        # 取 agent
        agent = session.get(Agent, agent_id)
        if not agent:
            err = f"节点 {node_id}：agent_id={agent_id} 不存在"
            wf_service.update_node_result(session, run, node_id, {
                "status": "failed", "error": err,
                "started_at": datetime.utcnow().isoformat(),
                "finished_at": datetime.utcnow().isoformat(),
            })
            yield sse_event("node_error", {"node_id": node_id, "error": err})
            wf_service.update_run(session, run,
                status="failed", error=err,
                finished_at=datetime.utcnow())
            yield sse_event("workflow_error", {"error": err, "node_id": node_id})
            return

        # 新建会话（每节点独立会话，避免上下文污染）
        conv = agent_service.get_or_create_conversation(
            session, agent_id, None,
            title=f"[WF#{run.id}] {node_name}",
        )

        try:
            result = await _invoke_node(agent, prompt, conv, session)
        except Exception as e:
            logger.exception(f"工作流节点 {node_id} 执行失败: {e}")
            result = {"content": "", "tool_calls": [], "error": str(e)}

        if result["error"]:
            wf_service.update_node_result(session, run, node_id, {
                "status": "failed",
                "error": result["error"],
                "started_at": datetime.utcnow().isoformat(),
                "finished_at": datetime.utcnow().isoformat(),
            })
            yield sse_event("node_error", {
                "node_id": node_id, "error": result["error"],
            })
            wf_service.update_run(session, run,
                status="failed", error=result["error"],
                finished_at=datetime.utcnow())
            yield sse_event("workflow_error", {
                "error": result["error"], "node_id": node_id,
            })
            return

        # 记录节点成功结果
        upstream_outputs[node_id] = result["content"]
        wf_service.update_node_result(session, run, node_id, {
            "status": "completed",
            "content": result["content"],
            "tool_calls": result["tool_calls"],
            "agent_id": agent_id,
            "started_at": datetime.utcnow().isoformat(),
            "finished_at": datetime.utcnow().isoformat(),
        })
        yield sse_event("node_done", {
            "node_id": node_id, "node_name": node_name,
            "content": result["content"],
            "tool_calls": result["tool_calls"],
            "content_preview": result["content"][:300],
        })

    # 工作流完成
    wf_service.update_run(session, run,
        status="completed", finished_at=datetime.utcnow())
    yield sse_event("workflow_done", {
        "run_id": run.id, "status": "completed",
        "final_output": upstream_outputs.get(ordered[-1]["id"], "")
            if ordered else "",
    })
