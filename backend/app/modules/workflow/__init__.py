"""DAG 工作流模块：多 Agent 编排（拓扑序执行 + 上下文传递）。

核心组件：
  - schemas.py：Pydantic 请求/响应模型
  - service.py：Workflow / WorkflowRun CRUD
  - engine.py：DAG 引擎（拓扑排序 + 节点执行 + 上下文传递，复用 agent_loop.run_agent）
  - router.py：REST + SSE 端点

节点（Node）prompt_template 占位符：
  {{input.<key>}}       — 工作流输入参数
  {{upstream.<node_id>}} — 上游节点的输出内容
"""
