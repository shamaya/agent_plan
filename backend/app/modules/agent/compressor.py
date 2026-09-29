"""对话上下文自动压缩器（用户重点功能）。

触发条件：history_tokens >= threshold * trigger_ratio
  - threshold = context_window - max_tokens - tools_tokens - system_tokens（budgets.compute_threshold）
  - trigger_ratio 来自 constraint_profile.compression_policy（默认 0.8）

压缩策略（plan 第五节）：
1. 保留：最近 N 轮原文（keep_recent_turns，默认 4 轮）
2. 压缩：更早所有 messages 送 LLM 做结构化摘要
3. 摘要 prompt（中文）：5 段结构化（关键事实/已用工具/已决策/未解决/偏好）
4. 输出：结构化 JSON → 文本 → system 消息（is_compressed_summary=1），置于保留轮次前
5. 被压缩旧消息不删除（保留可溯源），仅从活跃上下文剔除

压缩后写 trace（step_type=compression）+ 更新 conversations.compression_state。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session, select

from app.core.logging import logger
from app.db.models import Conversation, Message, Agent, Trace
from app.llm.client import build_client
from app.modules.harness import budgets
from app.modules.harness.constraints import should_compress, get_profile_constraints
from app.utils.tokens import count_messages_tokens, count_tokens
from app.modules.provider.cache import ProviderConfig

# 摘要 prompt（中文，按 plan 第五节）
SUMMARY_SYSTEM_PROMPT = """你是一个对话压缩助手。请将以下对话历史压缩为结构化摘要。

要求：
1. 保留所有具体数值、文件名、ID、时间、URL
2. 用以下 5 个维度组织（JSON 格式）：
   - key_facts: 关键事实与已确认信息
   - tools_used: 已使用工具及关键结果
   - decisions: 已达成的决策
   - open_tasks: 未解决的任务与待办
   - user_preferences: 用户偏好

只输出 JSON，不要加 markdown 代码块标记。"""


async def _summarize_with_llm(
    config: ProviderConfig, model_name: str, history_to_compress: list[dict]
) -> str:
    """调 LLM 把旧消息压缩成结构化摘要。"""
    client = build_client(config)
    # 把历史序列化为文本
    lines = []
    for m in history_to_compress:
        role = m.get("role", "")
        content = m.get("content", "")
        line = f"[{role}] {content}"
        if m.get("tool_calls"):
            line += f" | 工具调用: {m['tool_calls']}"
        lines.append(line)
    history_text = "\n".join(lines)

    resp = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": f"对话历史：\n{history_text}"},
        ],
        temperature=0.3,
        max_tokens=1024,
    )
    return resp.choices[0].message.content or ""


async def maybe_compress(
    conv: Conversation,
    history: list[dict],
    agent: Agent,
    session: Session,
    config: ProviderConfig,
    model_name: str,
    ctx_window: int,
    max_tokens: int,
    tools_tokens: int,
    profile: Any | None = None,
) -> tuple[list[dict], Optional[dict]]:
    """判断并执行压缩。返回 (new_history, compression_info)。

    compression_info 为 None 表示未触发压缩。
    compression_info = {pre_tokens, post_tokens, compressed_range, summary, summary_msg_id, count}
    """
    if not history:
        return history, None

    # 取约束参数
    if profile:
        cons = get_profile_constraints(profile)
    else:
        cons = {
            "compression_policy": {"enabled": True, "trigger_ratio": 0.8, "keep_recent_turns": 4}
        }
    cp = cons.get("compression_policy", {"enabled": True, "trigger_ratio": 0.8, "keep_recent_turns": 4})

    # 计算 system token（粗估：agent.system_prompt）
    system_tokens = count_tokens(agent.system_prompt or "")
    threshold = budgets.compute_threshold(ctx_window, max_tokens, tools_tokens, system_tokens)

    # 当前历史 token
    hist_tokens = count_messages_tokens(history)

    # 判断是否触发
    triggered, reason = should_compress(cp, hist_tokens, threshold)
    if not triggered:
        return history, None

    logger.info(f"对话 {conv.id} 触发压缩：{reason}")

    # 拆分：保留近 N 轮（keep_recent_turns * 2 条消息，因每轮含 user+assistant）
    keep_turns = cp.get("keep_recent_turns", 4)
    keep_msgs = keep_turns * 2  # 近 N 轮 ≈ 2N 条消息
    if len(history) <= keep_msgs:
        # 历史不足保留量，不压缩
        logger.info(f"对话 {conv.id} 历史仅 {len(history)} 条，不足保留 {keep_msgs} 条，跳过")
        return history, None

    to_compress = history[:-keep_msgs]
    to_keep = history[-keep_msgs:]

    # 被压缩范围（用消息 id 记录）
    compressed_range = [
        to_compress[0].get("id") or to_compress[0].get("ordinal", 0),
        to_compress[-1].get("id") or to_compress[-1].get("ordinal", 0),
    ]
    pre_tokens = count_messages_tokens(to_compress) + hist_tokens  # 压缩前总 token（含保留部分）
    pre_compressed_tokens = count_messages_tokens(to_compress)

    # 调 LLM 压缩
    try:
        summary = await _summarize_with_llm(config, model_name, to_compress)
    except Exception as e:
        logger.error(f"对话 {conv.id} 压缩 LLM 调用失败: {e}")
        # 压缩失败本身进入错误回收（写 trace）
        _write_compression_trace(session, conv.id, agent.id,
                                  pre_compressed_tokens, 0,
                                  compressed_range, "", status="error", error=str(e))
        return history, None

    # 构造压缩摘要消息
    summary_msg_dict = {
        "role": "system",
        "content": f"## 对话历史摘要（自动压缩）\n{summary}",
        "is_compressed_summary": True,
    }
    summary_tokens = count_tokens(summary_msg_dict["content"])
    post_tokens = summary_tokens + count_messages_tokens(to_keep)

    # 写摘要消息到 DB
    summary_msg = Message(
        conversation_id=conv.id, role="system",
        content=summary_msg_dict["content"],
        token_count=summary_tokens,
        is_compressed_summary=True,
    )
    session.add(summary_msg)
    session.commit()
    session.refresh(summary_msg)

    # 更新对话压缩状态
    comp_state = conv.compression_state or {}
    comp_state.update({
        "pre_tokens": pre_compressed_tokens,
        "post_tokens": summary_tokens,
        "range": compressed_range,
        "count": comp_state.get("count", 0) + 1,
        "last_at": datetime.utcnow().isoformat(),
        "summary_msg_id": summary_msg.id,
    })
    conv.compression_state = comp_state
    conv.updated_at = datetime.utcnow()
    session.add(conv)
    session.commit()

    # 写压缩 trace
    _write_compression_trace(session, conv.id, agent.id,
                             pre_compressed_tokens, summary_tokens,
                             compressed_range, summary, status="ok")

    compression_info = {
        "pre_tokens": pre_compressed_tokens,
        "post_tokens": summary_tokens,
        "compressed_range": compressed_range,
        "summary": summary,
        "summary_msg_id": summary_msg.id,
        "count": comp_state["count"],
    }
    logger.info(f"对话 {conv.id} 压缩完成：{pre_compressed_tokens}→{summary_tokens} token，"
                f"节省 {pre_compressed_tokens - summary_tokens}")

    # 新历史 = 摘要消息 + 保留轮次
    new_history = [summary_msg_dict] + to_keep
    return new_history, compression_info


def _write_compression_trace(session: Session, conv_id: int, agent_id: int | None,
                              pre_tokens: int, post_tokens: int,
                              compressed_range: list, summary: str,
                              status: str = "ok", error: str = "") -> None:
    """压缩作为独立 step 写 trace。"""
    t = Trace(
        conversation_id=conv_id, agent_id=agent_id,
        iteration=0, step_type="compression",
        input={"range": compressed_range, "pre_tokens": pre_tokens},
        output={"summary": summary[:500], "post_tokens": post_tokens},
        token_in=pre_tokens, token_out=post_tokens,
        status=status, error=error,
    )
    session.add(t)
    session.commit()
