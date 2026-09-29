"""Agent 主循环：自研轻量 agent loop。

核心流程（plan 第四节）：
  for iter in range(max_iterations):
      check_budget → maybe_compress → context_builder.build → runner.call_llm
      → 写 trace(llm_call)
      → 若有 tool_calls：constraints.allow 校验 + mcp.invoke + 写 trace(tool_call)
        + recovery.record_failure → append history → continue
      → 否则 done

LLM 自主决定工具/方法/任务规划，框架只负责约束 + 压缩 + 路由 + 回收。
"""
from __future__ import annotations

from datetime import datetime
from typing import AsyncIterator, Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Agent, Conversation, Message, Trace, ConstraintProfile, McpServer, McpTool
from app.llm.stream import (
    sse_event, token_event, tool_call_event, tool_result_event,
    compression_event, trace_step_event, done_event, error_event,
)
from app.modules.harness import constraints, budgets, recovery
from app.modules.harness.constraints import get_profile_constraints
from app.modules.agent import context_builder, runner, compressor
from app.modules.provider.service import get_active_model
from app.utils.tokens import count_tokens, count_messages_tokens
from app.utils.security import detect_prompt_injection, mask_sensitive_obj


async def run_agent(agent: Agent, user_msg: str, conv: Conversation,
                    session: Session) -> AsyncIterator[str]:
    """运行 agent，yield SSE 事件字符串。"""
    # 1. 取激活 model + provider config
    if not agent.model_id:
        yield error_event("Agent 未配置 model")
        return
    active = get_active_model(session, agent.model_id)
    if not active:
        yield error_event("Agent 的 model 不可用，请检查 provider 配置")
        return
    config, model_name, ctx_window, max_tokens = active

    # 2. 取约束 profile
    profile = None
    cons: dict
    if agent.constraint_profile_id:
        profile = session.get(ConstraintProfile, agent.constraint_profile_id)
    if profile:
        cons = get_profile_constraints(profile)
    else:
        # 默认约束（用 settings.hard_max_iterations）
        from app.config import settings
        cons = {
            "max_iterations": settings.hard_max_iterations,
            "token_budget": int(ctx_window * 0.8),
            "allowed_tools": ["*"],
            "forbidden_actions": [],
            "tool_failure_threshold": 3,
            "compression_policy": {"enabled": True, "trigger_ratio": 0.8, "keep_recent_turns": 4},
        }

    # 3. 加载历史消息（排除已被压缩剔除的，但含压缩摘要消息）
    history = _load_history(session, conv.id)

    # 4. 写 user 消息到 DB
    user_msg_row = Message(
        conversation_id=conv.id, role="user", content=user_msg,
        token_count=count_tokens(user_msg),
    )
    session.add(user_msg_row)
    session.commit()
    session.refresh(user_msg_row)
    history.append({
        "id": user_msg_row.id, "role": "user", "content": user_msg,
    })

    # 4.5 Prompt 注入检测（启发式，仅记录不拦截）
    injection = detect_prompt_injection(user_msg)
    if injection["risk"] in ("medium", "high"):
        _write_trace(session, conv.id, agent.id, -1, "constraint_check",
                     input={"user_msg": user_msg[:200]},
                     output={"injection_risk": injection["risk"],
                             "score": injection["score"],
                             "matches": injection["matches"]},
                     status="ok")

    # 预估 tools token（用于阈值计算）
    tools_preview = context_builder.discover_tools(
        agent, session, cons.get("allowed_tools", ["*"]),
        cons.get("forbidden_actions", [])
    )
    tools_tokens = budgets.estimate_tools_tokens(tools_preview)

    # 5. 主循环
    for iteration in range(cons["max_iterations"]):
        # 5a. 迭代上限检查
        ok, reason = constraints.check_iterations(iteration, cons["max_iterations"])
        if not ok:
            yield done_event(final=f"已达迭代上限，停止运行")
            return

        # 5b. token 预算检查
        hist_tokens = count_messages_tokens(history)
        ok, reason = constraints.check_budget(hist_tokens, cons["token_budget"])
        if not ok:
            logger.info(f"对话 {conv.id} iter {iteration}：{reason}")

        # 5c. 压缩（在 context_builder.build 之前）
        new_history, comp_info = await compressor.maybe_compress(
            conv, history, agent, session, config, model_name,
            ctx_window, max_tokens, tools_tokens, profile,
        )
        if comp_info:
            # new_history 已是 [摘要消息] + 保留的近 N 轮（含当前 user_msg）
            # 注意：不能 _load_history 全量重载，否则被压缩剔除的旧消息又回到活跃上下文
            history = new_history
            yield compression_event(
                comp_info["pre_tokens"], comp_info["post_tokens"],
                comp_info["compressed_range"], comp_info["summary"],
            )
            # compression trace 已由 compressor.maybe_compress 内部写入，这里不重复

        # 5d. 组装上下文
        messages, tools = context_builder.build(
            agent, history, user_msg, session, cons, conv.id
        )

        # 5e. 调 LLM（流式）
        full_content = ""
        final_tool_calls = None
        async for event in runner.call_llm(config, model_name, messages, tools):
            etype = event.get("type")
            if etype == "token":
                full_content += event["text"]
                yield token_event(event["text"])
            elif etype == "tool_calls":
                final_tool_calls = event["tool_calls"]
            elif etype == "error":
                yield error_event(event["message"])
                return

        # 5f. 写 LLM trace
        _write_trace(session, conv.id, agent.id, iteration, "llm_call",
                     input={"messages_count": len(messages)},
                     output={"content": full_content[:500]},
                     token_in=count_messages_tokens(messages),
                     token_out=count_tokens(full_content))

        # 5g. 处理 tool_calls
        if final_tool_calls:
            # 写 assistant 消息（含 tool_calls）
            assistant_msg = Message(
                conversation_id=conv.id, role="assistant",
                content=full_content,
                tool_calls=[{"id": tc["id"], "name": tc["name"],
                             "arguments": tc["arguments"]} for tc in final_tool_calls],
                token_count=count_tokens(full_content),
            )
            session.add(assistant_msg)
            session.commit()
            session.refresh(assistant_msg)
            history.append({
                "id": assistant_msg.id, "role": "assistant",
                "content": full_content, "tool_calls": assistant_msg.tool_calls,
            })

            # 逐个执行 tool
            for tc in final_tool_calls:
                tool_name = tc["name"]
                tool_args = tc["arguments"]

                # 工具白名单校验
                ok, reason = constraints.allow_tool(
                    tool_name, cons.get("allowed_tools", ["*"]),
                    cons.get("forbidden_actions", [])
                )
                if not ok:
                    yield error_event(f"工具调用被拒绝：{reason}")
                    _write_trace(session, conv.id, agent.id, iteration, "tool_call",
                                 tool_name=tool_name, input=tool_args,
                                 status="error", error=reason)
                    continue

                yield tool_call_event(tool_name, tool_args)

                # 查 tool 所属 server 配置
                server_config, transport_type = _find_tool_server(
                    session, agent.mcp_server_ids, tool_name
                )
                if not server_config:
                    err = f"工具 {tool_name} 未找到可用 server"
                    yield tool_result_event(tool_name, {"error": err})
                    _write_trace(session, conv.id, agent.id, iteration, "tool_call",
                                 tool_name=tool_name, input=tool_args,
                                 status="error", error=err)
                    recovery.record_failure(session, 0, tool_name, err)
                    continue

                # 调用工具
                try:
                    result = await runner.invoke_tool_for_call(
                        config, tool_name, tool_args, server_config, transport_type
                    )
                    yield tool_result_event(tool_name, result)
                    _write_trace(session, conv.id, agent.id, iteration, "tool_call",
                                 tool_name=tool_name, input=tool_args,
                                 output={"result": str(result)[:500]},
                                 status="ok")
                except Exception as e:
                    err = str(e)
                    yield tool_result_event(tool_name, {"error": err})
                    _write_trace(session, conv.id, agent.id, iteration, "tool_call",
                                 tool_name=tool_name, input=tool_args,
                                 status="error", error=err)
                    recovery.record_failure(session, 0, tool_name, err)
                    result = {"error": err}

                # 工具结果消息入历史
                tool_result_msg = {
                    "id": 0, "role": "tool", "content": str(result),
                    "tool_results": [{"name": tool_name, "result": result}],
                    "name": tool_name, "tool_call_id": tc.get("id", ""),
                }
                # 写 DB
                db_msg = Message(
                    conversation_id=conv.id, role="tool",
                    content=str(result),
                    tool_results=[{"name": tool_name, "result": result, "tool_call_id": tc.get("id", "")}],
                    token_count=count_tokens(str(result)),
                )
                session.add(db_msg)
                session.commit()
                session.refresh(db_msg)
                tool_result_msg["id"] = db_msg.id
                history.append(tool_result_msg)

            # 继续下一轮迭代让 LLM 处理工具结果
            continue
        else:
            # 无 tool_calls：完成
            assistant_msg = Message(
                conversation_id=conv.id, role="assistant",
                content=full_content,
                token_count=count_tokens(full_content),
            )
            session.add(assistant_msg)
            session.commit()
            conv.updated_at = datetime.utcnow()
            session.add(conv)
            session.commit()
            yield done_event(final=full_content)
            return

    # 迭代用尽
    yield done_event(final="已达最大迭代次数")


def _load_history(session: Session, conv_id: int) -> list[dict]:
    """加载对话历史消息（按创建顺序），转 dict 列表。

    含 is_compressed_summary 消息（摘要），排除已被压缩剔除的旧消息。
    简化实现：取全部消息（被压缩的旧消息保留在 DB 但不加载到活跃上下文）。
    第一版：全量加载。压缩后旧消息仍在表里，但 compressor 已用摘要替换活跃上下文。

    tool 消息的 tool_call_id/name 从 tool_results JSON 解析（兼容旧数据：旧 tool_results
    无 tool_call_id 时，按 assistant tool_calls 顺序自愈补全，避免 API 400）。
    """
    rows = session.exec(
        select(Message).where(Message.conversation_id == conv_id)
        .order_by(Message.id)
    ).all()
    history = []
    for m in rows:
        # tool 消息从 tool_results 解析 tool_call_id + name
        tool_call_id = ""
        name = ""
        if m.role == "tool" and m.tool_results:
            first = m.tool_results[0] if isinstance(m.tool_results, list) and m.tool_results else {}
            if isinstance(first, dict):
                tool_call_id = first.get("tool_call_id") or ""
                name = first.get("name") or ""
        history.append({
            "id": m.id, "role": m.role, "content": m.content or "",
            "tool_calls": m.tool_calls or [],
            "tool_results": m.tool_results or [],
            "tool_call_id": tool_call_id,
            "name": name,
            "is_compressed_summary": m.is_compressed_summary,
        })

    # 自愈：给缺 tool_call_id 的 tool 消息按 assistant tool_calls 顺序补全（兼容旧数据）
    pending_ids: list[str] = []  # 待响应的 tool_call_id 队列
    for m in history:
        if m["role"] == "assistant" and m.get("tool_calls"):
            for tc in m["tool_calls"]:
                tc_id = tc.get("id") or ""
                if tc_id:
                    pending_ids.append(tc_id)
        elif m["role"] == "tool":
            if m.get("tool_call_id"):
                # 已有 id，从 pending 移除匹配项
                if m["tool_call_id"] in pending_ids:
                    pending_ids.remove(m["tool_call_id"])
            elif pending_ids:
                # 旧数据缺 id，按顺序补全
                m["tool_call_id"] = pending_ids.pop(0)

    return history


def _write_trace(session: Session, conv_id: int, agent_id: int | None,
                  iteration: int, step_type: str,
                  input: dict | None = None, output: dict | None = None,
                  tool_name: str = "", latency_ms: int = 0,
                  token_in: int = 0, token_out: int = 0,
                  status: str = "ok", error: str = "") -> None:
    """写一条 trace（自动脱敏 input/output 中的敏感数据）。"""
    t = Trace(
        conversation_id=conv_id, agent_id=agent_id,
        iteration=iteration, step_type=step_type,
        tool_name=tool_name, input=mask_sensitive_obj(input or {}),
        output=mask_sensitive_obj(output or {}),
        latency_ms=latency_ms, token_in=token_in, token_out=token_out,
        status=status, error=error,
    )
    session.add(t)
    session.commit()


def _find_tool_server(session: Session, server_ids: list[int],
                       tool_name: str) -> tuple[dict | None, str]:
    """按工具名找到所属 server 的 config + transport_type。"""
    if not server_ids:
        return None, "stdio"
    # 在 agent 配置的 servers 下找含该工具名的 server
    servers = session.exec(
        select(McpServer).where(McpServer.id.in_(server_ids))
        .where(McpServer.enabled == True)  # noqa: E712
    ).all()
    for s in servers:
        tools = session.exec(
            select(McpTool).where(McpTool.server_id == s.id)
            .where(McpTool.name == tool_name)
        ).first()
        if tools:
            return s.config or {}, s.transport_type
    return None, "stdio"
