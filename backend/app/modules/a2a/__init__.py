"""A2A (Agent2Agent) Protocol 模块：跨 Agent 实例互操作。

实现 Google A2A 协议简化版：
  - Agent Card：/.well-known/agent.json 或 /a2a/agents/{id}/card
  - 任务端点：send（同步）/ sendSubscribe（SSE）/ 查询 / 取消

复用 agent loop + openapi 任务表，复用 ApiKey 认证（X-API-Key）。
"""
