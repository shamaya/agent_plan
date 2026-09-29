"""安全工具：Prompt 注入检测 + 敏感数据脱敏。

设计原则：
- Prompt 注入检测：基于规则的启发式（关键词 + 模式匹配），标记风险等级，不拦截（让用户决定）
- 敏感数据脱敏：在写 trace / 日志前遮蔽 API key、token、邮箱、手机号等
"""
from __future__ import annotations

import re
from typing import Any

# ===== Prompt 注入检测 =====
# 常见注入触发关键词（英文 + 中文）
INJECTION_PATTERNS = [
    r"(?i)\bignore\s+(previous|above|prior)\b",
    r"(?i)\bdisregard\s+(previous|above|prior|all)\b",
    r"(?i)\bforget\s+(everything|all|previous)\b",
    r"(?i)\byou\s+are\s+now\b",
    r"(?i)\bpretend\s+(to|you)\b",
    r"(?i)\breveal\s+(your|the)\s+(system|prompt|instructions)\b",
    r"(?i)\b(system\s+prompt|initial\s+prompt|hidden\s+prompt)\b",
    r"(?i)\bprint\s+(your|the)\s+(prompt|instructions)\b",
    r"忽略(之前|上面|前面|所有)",
    r"忘记(一切|所有|之前)",
    r"你现在是",
    r"假装(你|自己)是",
    r"透露(你的|系统)(提示|指令|prompt)",
    r"输出(你的|系统)(提示词|prompt)",
    r"(系统提示词|初始提示词|隐藏提示词)",
]

# 注入尝试的常见指令动词
INJECTION_VERBS = [
    "ignore", "disregard", "forget", "override", "bypass",
    "忽略", "无视", "忘记", "跳过", "绕过", "覆盖",
]


def detect_prompt_injection(text: str) -> dict:
    """检测 prompt 注入风险。返回 {risk: 'low'|'medium'|'high', matches: [...], score: 0-1}。"""
    if not text:
        return {"risk": "low", "matches": [], "score": 0.0}
    matches = []
    for pat in INJECTION_PATTERNS:
        found = re.findall(pat, text)
        if found:
            matches.extend(found)
    # 额外检查：是否包含 "ignore" + "system" 组合
    lower = text.lower()
    combo_hits = 0
    for verb in INJECTION_VERBS:
        if verb.lower() in lower:
            combo_hits += 1
    score = min(1.0, len(matches) * 0.3 + combo_hits * 0.1)
    if score >= 0.6:
        risk = "high"
    elif score >= 0.3:
        risk = "medium"
    else:
        risk = "low"
    return {"risk": risk, "matches": matches[:10], "score": round(score, 2)}


# ===== 敏感数据脱敏 =====
SENSITIVE_PATTERNS = [
    # API key 类（sk-xxx, Bearer xxx 等）
    (re.compile(r"(?i)(sk-[a-zA-Z0-9]{12,})"), "sk-***"),
    (re.compile(r"(?i)(bearer\s+[a-zA-Z0-9._\-]{12,})"), "Bearer ***"),
    (re.compile(r"(?i)(api[_-]?key\s*[:=]\s*['\"]?)([a-zA-Z0-9_\-]{8,})"), r"\1***"),
    (re.compile(r"(?i)(x-[a-z-]*key\s*[:=]\s*['\"]?)([a-zA-Z0-9_\-]{8,})"), r"\1***"),
    (re.compile(r"(?i)(token\s*[:=]\s*['\"]?)([a-zA-Z0-9_\-]{12,})"), r"\1***"),
    # 邮箱
    (re.compile(r"([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"), r"\1***@\2"),
    # 手机号（中国大陆）
    (re.compile(r"(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)"), r"\1****\2"),
    # 身份证号
    (re.compile(r"(?<!\d)(\d{6})\d{8}(\d{4})(?!\d)"), r"\1********\2"),
    # 银行卡号
    (re.compile(r"(?<!\d)(\d{4})\d{8,12}(\d{4})(?!\d)"), r"\1****\2"),
]


def mask_sensitive(text: str) -> str:
    """对文本中的敏感数据做脱敏。"""
    if not text:
        return text
    out = text
    for pat, repl in SENSITIVE_PATTERNS:
        out = pat.sub(repl, out)
    return out


def mask_sensitive_obj(obj: Any) -> Any:
    """递归对对象（dict/list/str）做敏感数据脱敏。"""
    if isinstance(obj, str):
        return mask_sensitive(obj)
    if isinstance(obj, dict):
        return {k: mask_sensitive_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mask_sensitive_obj(v) for v in obj]
    return obj
