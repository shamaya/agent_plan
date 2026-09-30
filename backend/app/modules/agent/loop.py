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

import json
from datetime import datetime
from typing import AsyncIterator, Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Agent, Conversation, Message, Trace, ConstraintProfile, McpServer, McpTool, AgentWorker
from app.llm.stream import (
    sse_event, token_event, tool_call_event, tool_result_event,
    compression_event, trace_step_event, done_event, error_event,
    approval_request_event, routing_event,
)
from app.modules.harness import constraints, budgets, recovery
from app.modules.harness.constraints import get_profile_constraints
from app.modules.agent import context_builder, runner, compressor
from app.modules.agent.approval import approval_manager
from app.modules.agent.memory import build_memory_context, extract_memories
from app.modules.agent.routing import route_for_agent
from app.modules.provider.service import get_active_model
from app.utils.tokens import count_tokens, count_messages_tokens
from app.utils.security import detect_prompt_injection, mask_sensitive_obj


async def run_agent(agent: Agent, user_msg: str, conv: Conversation,
                    session: Session, images: list[str] | None = None) -> AsyncIterator[str]:
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

    # 4. 写 user 消息到 DB（含多模态图片）
    user_msg_row = Message(
        conversation_id=conv.id, role="user", content=user_msg,
        images=images or [],
        token_count=count_tokens(user_msg),
    )
    session.add(user_msg_row)
    session.commit()
    session.refresh(user_msg_row)
    history.append({
        "id": user_msg_row.id, "role": "user", "content": user_msg,
        "images": images or [],
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
    guardrail_retries: dict[int, int] = {}  # rule_id -> 已重试次数
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

        # 5d. 组装上下文（首轮传入 images，后续轮次历史已含）
        cur_images = images if iteration == 0 else None
        messages, tools = context_builder.build(
            agent, history, user_msg, session, cons, conv.id, cur_images
        )
        # 注入长期记忆（跨会话）
        memory_ctx = build_memory_context(session, agent.id, user_msg)
        if memory_ctx and messages and messages[0]["role"] == "system":
            if "长期记忆" not in (messages[0].get("content") or ""):
                messages[0]["content"] += memory_ctx

        # 5d-bis. 智能路由：根据复杂度切换 model
        routing_decision = route_for_agent(agent, user_msg, history, iteration)
        if routing_decision["enabled"]:
            sel_model_id = routing_decision["selected_model_id"]
            if sel_model_id is not None and sel_model_id != agent.model_id:
                # 切换到路由选中的 model（重新取 provider config + 模型元数据）
                routed_active = get_active_model(session, sel_model_id)
                if routed_active:
                    config, model_name, ctx_window, max_tokens = routed_active
                    # 同步更新 ctx_window / max_tokens 给后续 compressor 使用
                    # 注意：cons["token_budget"] 不在此处调整，避免误触发压缩
                else:
                    logger.warning(
                        f"路由选中 model_id={sel_model_id} 不可用，回退到默认 model"
                    )
                    routing_decision["label"] = routing_decision["label"] + "_unavailable"
            # 推送路由决策给前端 + 写 trace
            yield routing_event(
                routing_decision["complexity"],
                routing_decision["label"],
                routing_decision["selected_model_id"],
                routing_decision["reason"],
                routing_decision["signals"],
            )
            _write_trace(session, conv.id, agent.id, iteration, "routing",
                         input={"user_msg": user_msg[:200], "iteration": iteration},
                         output={
                             "complexity": routing_decision["complexity"],
                             "label": routing_decision["label"],
                             "selected_model_id": routing_decision["selected_model_id"],
                             "reason": routing_decision["reason"],
                             "signals": routing_decision["signals"],
                         },
                         status="ok")

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

                # ===== 委托拦截：delegate / assign_task =====
                if tool_name in ("delegate", "assign_task"):
                    result = await _handle_delegation(
                        tool_name, tool_args, agent, conv, session, config, model_name
                    )
                    yield tool_result_event(tool_name, result)
                    _write_trace(session, conv.id, agent.id, iteration, "tool_call",
                                 tool_name=tool_name, input=tool_args,
                                 output={"result": str(result)[:500]},
                                 status="ok")
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
                    history.append({
                        "id": db_msg.id, "role": "tool", "content": str(result),
                        "tool_results": [{"name": tool_name, "result": result}],
                        "name": tool_name, "tool_call_id": tc.get("id", ""),
                    })
                    continue

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

                # ===== HITL 审批检查 =====
                approval_cfg = agent.approval_config or {}
                if approval_cfg.get("enabled") and tool_name in (approval_cfg.get("tools") or []):
                    import uuid
                    approval_id = str(uuid.uuid4())[:8]
                    pa = approval_manager.create(approval_id, conv.id, tool_name, tool_args)
                    logger.info(f"HITL 审批请求: approval_id={approval_id} tool={tool_name} conv={conv.id}")
                    yield approval_request_event(approval_id, tool_name, tool_args)
                    # 阻塞等待用户决策
                    await pa.decision_event.wait()
                    approval_manager._pending.pop(approval_id, None)
                    if not pa.approved:
                        result = {"skipped": True, "reason": pa.reason or "用户拒绝执行"}
                        yield tool_result_event(tool_name, result)
                        _write_trace(session, conv.id, agent.id, iteration, "tool_call",
                                     tool_name=tool_name, input=tool_args,
                                     output={"result": str(result)[:500]},
                                     status="ok")
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
                        history.append({
                            "id": db_msg.id, "role": "tool", "content": str(result),
                            "tool_results": [{"name": tool_name, "result": result}],
                            "name": tool_name, "tool_call_id": tc.get("id", ""),
                        })
                        continue

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
            # 无 tool_calls：完成前做 guardrail 校验
            guardrail_action, feedback = _apply_guardrails(
                agent, full_content, session, guardrail_retries,
            )
            if guardrail_action == "retry":
                # 把当前回答 + 反馈追加到历史，让 LLM 下一轮修正
                history.append({
                    "role": "assistant", "content": full_content,
                })
                history.append({
                    "role": "user", "content": feedback,
                })
                yield sse_event("guardrail", {
                    "action": "retry", "feedback": feedback,
                })
                continue
            elif guardrail_action == "reject":
                yield error_event("输出未通过校验，已拒绝")
                return
            elif guardrail_action == "append_warning":
                full_content = full_content + "\n\n⚠️ " + feedback
                yield sse_event("guardrail", {
                    "action": "append_warning", "feedback": feedback,
                })

            # 写最终 assistant 消息
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
            # 异步提取记忆（不阻塞返回）
            try:
                conv_messages = [
                    {"role": m.role, "content": m.content}
                    for m in history
                ]
                await extract_memories(session, agent.id, conv_messages)
            except Exception as e:
                logger.warning(f"记忆提取失败（不影响对话）: {e}")
            yield done_event(final=full_content)
            return

    # 迭代用尽
    yield done_event(final="已达最大迭代次数")


def _apply_guardrails(agent, content, session, retries: dict[int, int]) -> tuple[str, str]:
    """应用 guardrail 规则。返回 (action, feedback)。

    action: "pass" | "retry" | "reject" | "append_warning"
    决策逻辑：按 sort_order 依次检查，命中第一条 violation 后：
      - 若 action=reject 且未超过重试次数 → 降级为 retry（给 LLM 一次修正机会），超过则 reject
      - 若 action=retry 且未超过 retry_count → retry；超过则 append_warning（保留输出加警告）
      - 若 action=append_warning → append_warning
    """
    from app.modules.guardrail import service as gr_service, engine as gr_engine

    rules = gr_service.get_rules_for_agent(session, agent.id)
    if not rules:
        return "pass", ""

    result = gr_engine.check_all(rules, content)
    if result.passed:
        return "pass", ""

    # 取第一条违规规则决定动作
    violations = [r for r in result.results if not r.passed]
    if not violations:
        return "pass", ""

    v = violations[0]
    feedback = gr_engine.build_retry_feedback(violations)
    rule = next((r for r in rules if r.id == v.rule_id), None)
    if not rule:
        return "pass", ""

    tried = retries.get(rule.id, 0)
    retries[rule.id] = tried + 1

    if rule.action == "reject":
        if tried < rule.retry_count:
            return "retry", feedback
        return "reject", feedback
    elif rule.action == "retry":
        if tried < rule.retry_count:
            return "retry", feedback
        # 重试耗尽：保留输出并加警告
        return "append_warning", feedback
    elif rule.action == "append_warning":
        return "append_warning", feedback
    return "pass", ""


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
            "images": m.images or [],
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


async def _handle_delegation(tool_name: str, tool_args: dict,
                             supervisor_agent: Agent, conv: Conversation,
                             session: Session, config, model_name: str) -> dict:
    """处理委托工具调用：启动子 Agent Loop 并收集结果。

    - delegate（Auto 模式）：按 agent_name 查找目标 Agent
    - assign_task（Managed 模式）：按 worker_id 查找目标 Agent
    """
    if tool_name == "delegate":
        agent_name = tool_args.get("agent_name", "")
        task = tool_args.get("task", "")
        if not agent_name:
            return {"error": "缺少 agent_name 参数"}
        target = session.exec(
            select(Agent).where(Agent.name == agent_name)
        ).first()
        if not target:
            return {"error": f"Agent '{agent_name}' 不存在"}
    else:  # assign_task
        worker_id = tool_args.get("worker_id")
        task = tool_args.get("task", "")
        if not worker_id:
            return {"error": "缺少 worker_id 参数"}
        # 校验 worker 是否在 supervisor 的池中
        worker_row = session.exec(
            select(AgentWorker).where(
                AgentWorker.supervisor_id == supervisor_agent.id,
                AgentWorker.worker_id == worker_id,
            )
        ).first()
        if not worker_row:
            return {"error": f"worker_id={worker_id} 不在当前 Agent 的 Worker 池中"}
        target = session.get(Agent, worker_id)
        if not target:
            return {"error": f"Worker Agent id={worker_id} 不存在"}

    if not target.model_id:
        return {"error": f"目标 Agent '{target.name}' 未配置 model"}

    # 获取目标 Agent 的 model 配置
    from app.modules.provider.service import get_active_model
    target_active = get_active_model(session, target.model_id)
    if not target_active:
        return {"error": f"目标 Agent '{target.name}' 的 model 不可用"}
    target_config, target_model_name, _, target_max_tokens = target_active

    # 构建子 Agent 的上下文（复用 context_builder）
    sub_messages, sub_tools = context_builder.build(
        target, [], task, session,
        {"max_iterations": 5, "token_budget": int(target_active[2] * 0.8),
         "allowed_tools": ["*"], "forbidden_actions": [],
         "tool_failure_threshold": 3,
         "compression_policy": {"enabled": False, "trigger_ratio": 0.8, "keep_recent_turns": 4}},
        conv.id,
    )

    logger.info(f"委托执行：supervisor={supervisor_agent.name} → worker={target.name} task={task[:100]}")

    # 执行子 Agent Loop（非流式，收集最终结果）
    sub_content = ""
    try:
        async for event in runner.call_llm(target_config, target_model_name, sub_messages, sub_tools):
            etype = event.get("type")
            if etype == "token":
                sub_content += event["text"]
            elif etype == "done":
                if not sub_content:
                    sub_content = event.get("content", "")
                break
            elif etype == "error":
                return {"error": f"子 Agent 执行失败: {event['message']}"}
            # 子 Agent 如有 tool_calls，简单处理（只跑一轮无递归委托）
            elif etype == "tool_calls":
                # 子 Agent 的工具调用：执行后继续一轮 LLM
                sub_tc = event["tool_calls"]
                sub_messages.append({"role": "assistant", "content": sub_content, "tool_calls": [
                    {"id": tc["id"], "type": "function",
                     "function": {"name": tc["name"],
                                  "arguments": json.dumps(tc["arguments"], ensure_ascii=False)}}
                    for tc in sub_tc
                ]})
                for tc in sub_tc:
                    tc_name = tc["name"]
                    tc_args = tc["arguments"]
                    # 委托拦截（防递归死循环）
                    if tc_name in ("delegate", "assign_task"):
                        sub_messages.append({"role": "tool", "content": '{"error": "子 Agent 不允许递归委托"}', "name": tc_name, "tool_call_id": tc["id"]})
                        continue
                    server_config, transport_type = _find_tool_server(session, target.mcp_server_ids, tc_name)
                    if not server_config:
                        sub_messages.append({"role": "tool", "content": '{"error": "tool server not found"}', "name": tc_name, "tool_call_id": tc["id"]})
                        continue
                    try:
                        result = await runner.invoke_tool_for_call(target_config, tc_name, tc_args, server_config, transport_type)
                    except Exception as e:
                        result = {"error": str(e)}
                    content = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                    sub_messages.append({"role": "tool", "content": content, "name": tc_name, "tool_call_id": tc["id"]})
                # 继续调 LLM 获取最终结果
                sub_content = ""
                async for event2 in runner.call_llm(target_config, target_model_name, sub_messages, sub_tools):
                    if event2.get("type") == "token":
                        sub_content += event2["text"]
                    elif event2.get("type") == "done":
                        if not sub_content:
                            sub_content = event2.get("content", "")
                        break
                    elif event2.get("type") == "error":
                        return {"error": f"子 Agent 第二轮失败: {event2['message']}"}
                break
    except Exception as e:
        return {"error": f"子 Agent 执行异常: {e}"}

    # 写子 Agent 的 trace
    _write_trace(session, conv.id, target.id, -1, "delegation",
                 input={"supervisor": supervisor_agent.name, "task": task[:200]},
                 output={"result": sub_content[:500]},
                 status="ok")

    return {"result": sub_content, "worker": target.name}
