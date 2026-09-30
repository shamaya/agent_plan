"""评估引擎：调用 Agent → 收集响应 → LLM-as-Judge 打分。

judge prompt 包含：被评估 prompt、Agent 响应、评估准则列表。
要求 judge 返回 JSON：{"criteria": {"cid": {"score": <0-5>, "reason": "..."}}, "overall_score": <float>}
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, AsyncIterator

from sqlmodel import Session

from app.core.logging import logger
from app.db.models import Agent, Evaluation, EvaluationRun
from app.modules.agent import service as agent_service, loop as agent_loop
from app.llm.client import build_client
from app.modules.evaluation import service as eval_service
from app.modules.provider.service import get_active_model


def _build_judge_prompt(prompt: str, response: str, criteria: list[dict]) -> str:
    crit_text = "\n".join(
        f"  - [{c.get('id')}] {c.get('name')}（权重 {c.get('weight', 1.0)}）：{c.get('description')}"
        + (f"  评分标准：{c.get('rubric', '')}" if c.get('rubric') else "")
        for c in criteria
    )
    return f"""你是一个严格的评估官。请根据以下评估准则，对 Agent 的回答打分（每项 0-5 分，可保留 1 位小数）。

【用户提问】
{prompt}

【Agent 回答】
{response}

【评估准则】
{crit_text}

请严格按以下 JSON 格式返回（不要包含其他文字）：
```json
{{"criteria": {{"CID_1": {{"score": 4.0, "reason": "简要说明理由"}}, "CID_2": {{"score": 3.5, "reason": "..."}}}}, "overall_score": 3.8}}
```
- criteria 中每个 key 对应上面的准则 id
- overall_score 为加权平均分（自动按权重计算）
"""


def _parse_judge_json(text: str) -> dict:
    """从 judge 输出中提取 JSON 对象。"""
    # 先尝试直接 JSON parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # 提取 ```json ... ``` 块
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # 提取第一个 { 到最后一个 }
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            pass
    return {}


def _weighted_overall(criteria_scores: dict, criteria: list[dict]) -> float:
    """根据各准则得分和权重计算加权总分。"""
    total_w = 0.0
    total_s = 0.0
    for c in criteria:
        cid = c.get("id")
        w = float(c.get("weight", 1.0))
        s = criteria_scores.get(cid, {}).get("score")
        if s is None:
            continue
        try:
            total_s += float(s) * w
            total_w += w
        except Exception:
            continue
    if total_w == 0:
        return 0.0
    return round(total_s / total_w, 2)


async def _invoke_agent(agent: Agent, prompt: str, conv, session: Session) -> dict:
    """调用 Agent 收集最终响应文本 + tool_calls。"""
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


async def _invoke_judge(judge_config, judge_model_name, judge_prompt: str) -> str:
    """调用 judge LLM 评分（非流式）。"""
    client = build_client(judge_config)
    try:
        resp = await client.chat.completions.create(
            model=judge_model_name,
            messages=[{"role": "user", "content": judge_prompt}],
            stream=False,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"Judge 调用失败: {e}")
        return f"ERROR: {e}"


async def run_evaluation(evaluation: Evaluation, run: EvaluationRun,
                         session: Session) -> AsyncIterator[str]:
    """执行评估：yield SSE 事件。"""
    from app.llm.stream import sse_event

    criteria = evaluation.criteria or []
    if not criteria:
        eval_service.update_run(session, run,
            status="failed", error="评估准则为空，请先配置",
            finished_at=datetime.utcnow())
        yield sse_event("evaluation_error", {"error": "评估准则为空"})
        return

    eval_service.update_run(session, run, status="running",
                            started_at=datetime.utcnow())
    yield sse_event("evaluation_start", {
        "run_id": run.id, "evaluation_id": evaluation.id,
        "criteria_count": len(criteria),
    })

    # 1. 取被评估 Agent
    agent = session.get(Agent, evaluation.agent_id)
    if not agent:
        eval_service.update_run(session, run,
            status="failed", error=f"agent_id={evaluation.agent_id} 不存在",
            finished_at=datetime.utcnow())
        yield sse_event("evaluation_error", {"error": "Agent 不存在"})
        return

    # 2. 调用 Agent 得到响应
    yield sse_event("agent_start", {"agent_id": agent.id, "prompt": run.input_prompt[:200]})
    conv = agent_service.get_or_create_conversation(
        session, agent.id, None,
        title=f"[EVAL#{run.id}] {run.input_prompt[:30]}",
    )
    try:
        agent_result = await _invoke_agent(agent, run.input_prompt, conv, session)
    except Exception as e:
        logger.exception(f"评估 Agent 调用失败: {e}")
        agent_result = {"content": "", "tool_calls": [], "error": str(e)}

    if agent_result["error"]:
        eval_service.update_run(session, run,
            status="failed", error=agent_result["error"],
            finished_at=datetime.utcnow())
        yield sse_event("evaluation_error", {"error": agent_result["error"]})
        return

    agent_response = agent_result["content"]
    yield sse_event("agent_done", {
        "response_preview": agent_response[:300],
        "response_len": len(agent_response),
        "tool_calls": agent_result.get("tool_calls", []),
    })

    # 3. 调用 judge 评分
    # judge model：优先用 evaluation.judge_model_id，否则用 agent 自身 model
    yield sse_event("judge_start", {"criteria_count": len(criteria)})
    judge_model_id = evaluation.judge_model_id or agent.model_id
    if not judge_model_id:
        eval_service.update_run(session, run,
            status="failed", error="未配置 judge model 且 Agent 无 model",
            finished_at=datetime.utcnow())
        yield sse_event("evaluation_error", {"error": "未配置评分模型"})
        return

    judge_active = get_active_model(session, judge_model_id)
    if not judge_active:
        eval_service.update_run(session, run,
            status="failed", error=f"judge model_id={judge_model_id} 不可用",
            finished_at=datetime.utcnow())
        yield sse_event("evaluation_error", {"error": "评分模型不可用"})
        return

    judge_config, judge_model_name, _, _ = judge_active
    judge_prompt = _build_judge_prompt(run.input_prompt, agent_response, criteria)
    judge_raw = await _invoke_judge(judge_config, judge_model_name, judge_prompt)

    if judge_raw.startswith("ERROR:"):
        eval_service.update_run(session, run,
            status="failed", error=judge_raw,
            finished_at=datetime.utcnow())
        yield sse_event("evaluation_error", {"error": judge_raw})
        return

    parsed = _parse_judge_json(judge_raw)
    criteria_scores: dict[str, Any] = parsed.get("criteria", {})
    overall = parsed.get("overall_score")
    # 若 judge 没给 overall，按权重计算
    if overall is None or overall == "":
        overall = _weighted_overall(criteria_scores, criteria)

    # 4. 保存结果
    results = {
        "overall_score": overall,
        "criteria": criteria_scores,
        "response": agent_response,
        "judge_raw": judge_raw,
        "judge_model_id": judge_model_id,
    }
    eval_service.update_run(session, run,
        status="completed", results=results,
        finished_at=datetime.utcnow())

    yield sse_event("judge_done", {
        "overall_score": overall,
        "criteria": criteria_scores,
        "judge_raw_preview": judge_raw[:500],
    })
    yield sse_event("evaluation_done", {
        "run_id": run.id, "overall_score": overall,
        "criteria": criteria_scores,
    })
