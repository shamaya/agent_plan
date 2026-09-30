# Agent 开发平台

一个开源的 LLM Agent 工程化平台，提供多智能体协同、Skill 管理、MCP 工具集成、知识库、可观测性、上下文压缩等工程能力，帮助开发者快速构建和运维 Agent 应用。

**NOTICE**: 该平台为实验性版本，不建议在生产环境中使用，相关功能可能不完善。

## 核心功能

| 模块 | 功能 |
|------|------|
| **多智能体协同** | Agent-as-Tool 委托、Supervisor-Worker 模式、Auto/Managed 双模式切换、委托链追踪 |
| **Agent** | 多 Agent 管理、版本快照与回滚、导入/导出、在线调试沙箱、长期记忆、智能路由、HITL 审批、流式中断、多模态图片输入 |
| **Skill** | Prompt 模板管理、参数 Schema、在线测试、版本历史 |
| **Prompt 模板市场** | 可复用 Prompt 模板（`{{变量}}` 占位符）、分类标签、渲染预览、一键应用到 Agent、Prompt 缓存（命中统计 + Token 节省） |
| **MCP** | MCP Server 管理、工具自动发现、工具浏览器（搜索筛选） |
| **知识库** | 文档上传、自动分块、向量检索、Chunk 预览、文档删除 |
| **Provider** | 多 LLM Provider（OpenAI / Ollama / vLLM 兼容）、API Key 加密存储 |
| **可观测性** | Trace 全链路追踪、SSE 实时流、错误聚合、Token 成本统计 |
| **安全** | Prompt 注入检测、敏感数据脱敏、Guardrails 输出校验（6 种规则 + 重试/拒绝/警告） |
| **OpenAPI** | 第三方 API 调用、API Key 管理、代码生成器（cURL / Python / JS） |
| **Harness** | 工程测试层，批量用例管理与执行 |
| **上下文压缩** | 自动压缩长对话历史，降低 Token 消耗 |
| **DAG 工作流** | 多 Agent 拓扑编排、节点级 Prompt 模板、上游产物注入、SSE 流式运行、版本快照与回滚 |
| **评估框架** | LLM-as-Judge、多准则加权评分、趋势图 + 雷达图、版本快照与回滚 |
| **A2A Protocol** | Agent Card 自描述、远程任务接入、状态追踪 |

## 多智能体协同

平台支持两种委托模式，通过独立的协同管理页面配置：

### Auto 模式（Agent-as-Tool）
- Worker 池为空时自动启用
- LLM 可通过 `delegate(agent_name, task)` 委托**任意其他 Agent**
- System Prompt 自动注入所有可用 Agent 清单
- 适合快速验证和灵活编排

### Managed 模式（Supervisor-Worker）
- 配置 Worker 池后启用
- LLM 只能通过 `assign_task(worker_id, task)` 委托**池内 Agent**
- System Prompt 仅注入配置的 Worker + 角色描述
- 适合生产环境、权限受控场景

### 委托执行流程

```
Supervisor Agent Loop
  ├── System Prompt 注入 Worker 清单
  ├── LLM 生成 tool_call: delegate / assign_task
  ├── 委托拦截器（loop.py 内）
  │   ├── 拉取子 Agent 配置 + Skills + MCP + KB
  │   ├── 以 task 为 user 消息启动子 Agent Loop
  │   ├── 子 Agent 可使用自身工具（MCP / Knowledge）
  │   ├── 防递归委托（子 Agent 不可再委托）
  │   └── 收集子 Agent 最终回复
  ├── 回传为 tool_result
  └── LLM 继续推理（可多次委托，最后整合输出）
```

### 对话页适配
对话页自动识别委托工具调用，以蓝色主题卡片展示：
- 卡片标题：委托 → {Worker 名} + 任务摘要
- 展开后：委托任务全文 + Worker 响应内容
- 执行中状态：等待 Worker 响应

## Agent 工程化能力

### 流式中断
对话生成过程中可随时点击「停止」，已生成的部分内容会被保留并标记「已中断」，避免丢失有效输出。

### HITL 审批（Human-in-the-Loop）
为 Agent 配置需要人工审批的工具，执行到这些工具时会暂停并弹出黄色审批卡片，用户批准后继续、拒绝则跳过。

### 长期记忆
Agent 自动从对话中提取关键事实存入记忆库，下次对话时按相关性检索注入 System Prompt，实现跨会话的持续记忆。

### 智能路由
基于消息长度、代码块、推理关键词、历史工具调用等信号评估复杂度，按阈值在简单/复杂模型间自动切换，平衡成本与质量。对话页展示路由决策卡片。

### 多模态（图片输入）
对话输入区支持上传本地图片（转 base64）或粘贴图片 URL，消息以多模态格式发送给视觉模型，消息气泡内可预览图片。

### Prompt 模板市场
- 用 `{{变量名}}` 定义占位符，保存时自动识别变量
- 实时渲染预览，一键将渲染后的模板应用到 Agent 的 system_prompt
- Prompt 缓存：相同 Prompt 直接命中缓存，统计命中次数与节省的 Token

### Guardrails 输出校验
6 种规则类型（正则 / 长度 / 关键词 / JSON 格式 / JSON Schema / 前缀匹配），3 种处理动作（重试 / 拒绝 / 追加警告），在 Agent 每次 LLM 输出后自动校验。

### DAG 工作流
可视化编排多个 Agent 节点，通过 `depends_on` 决定拓扑序，上游节点输出可通过 `{{upstream.<node_id>}}` 注入下游 Prompt，支持 SSE 流式运行与节点级进度。

### 评估框架（LLM-as-Judge）
配置多条评分准则（权重 + 评分标准 rubric），运行时用 Judge 模型对 Agent 输出打分，支持趋势折线图与多准则雷达图。

### A2A Protocol
遵循 Agent2Agent 互操作协议，每个 Agent 暴露 Agent Card（自描述能力），支持远程任务接入与状态追踪。

### 全链路版本化
**Agent / Workflow / Evaluation** 三类核心实体均支持：
- 手动保存带备注的版本快照
- 每次更新自动生成「更新前快照」
- 一键回滚到任意历史版本（回滚前自动保存当前状态）
- 版本历史抽屉可展开查看快照 JSON 内容

## 技术栈

- **后端**：Python 3.11 / FastAPI / SQLModel / ChromaDB / OpenAI SDK / MCP SDK
- **前端**：React 18 / TypeScript / Ant Design 5 / Vite
- **基础设施**：Docker / Nginx / Supervisor

## 快速开始

### Docker Compose 一键部署（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/shamaya/agent_plan.git
cd agent_plan

# 2. 复制环境配置
cp .env.example .env

# 3. 启动服务
docker compose up -d

# 4. 访问
# 打开 http://localhost:8080
```

首次启动会自动建表并初始化默认配置。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENT_MASTER_KEY` | `change-me-please` | Provider API Key 加密主密钥，**生产环境务必修改** |
| `DATA_DIR` | `/app/data` | 数据持久化目录 |
| `DEFAULT_EMBEDDING` | `local` | Embedding 方式：`local`（本地模型）或 `api`（走 Provider） |
| `LOCAL_EMBEDDING_MODEL` | `paraphrase-multilingual-MiniLM-L12-v2` | 本地 Embedding 模型名 |

### 本地开发

**后端**：
```bash
cd backend
pip install -r requirements.txt
export DATA_DIR=./data
python -m app.db.init          # 初始化数据库
uvicorn app.main:app --reload --port 8000
```

**前端**：
```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

## 项目结构

```
agent_plan/
├── backend/
│   └── app/
│       ├── core/           # 配置、日志、生命周期
│       ├── db/             # SQLModel 数据模型、初始化
│       ├── llm/            # LLM 客户端封装
│       ├── modules/        # 业务模块
│       │   ├── agent/     # Agent 管理 + Loop 引擎 + 委托引擎
│       │   │   ├── loop.py            # 主循环 + 委托拦截 + 路由 + Guardrail
│       │   │   ├── context_builder.py # 上下文组装 + Worker 清单 + 多模态
│       │   │   ├── runner.py          # LLM 流式调用
│       │   │   ├── compressor.py      # 上下文压缩
│       │   │   ├── memory.py          # 长期记忆（提取 + 检索注入）
│       │   │   ├── routing.py         # 智能路由（复杂度 → 模型切换）
│       │   │   ├── approval.py        # HITL 审批（asyncio.Event 阻塞）
│       │   │   ├── service.py          # CRUD + 版本 + 导入导出 + Worker 池
│       │   │   ├── router.py           # API 路由
│       │   │   └── schemas.py          # 请求/响应模型
│       │   ├── skill/     # Skill 模板
│       │   ├── mcp/       # MCP 工具集成
│       │   ├── knowledge/ # 知识库 + 向量检索
│       │   ├── trace/     # 追踪与监控
│       │   ├── openapi/   # 第三方 API
│       │   ├── provider/  # LLM Provider
│       │   ├── apikey/    # API Key 管理
│       │   ├── harness/   # 工程测试层
│       │   ├── a2a/       # A2A Protocol（Agent Card + 任务接入）
│       │   ├── workflow/  # DAG 工作流（拓扑编排 + 版本）
│       │   ├── evaluation/# 评估框架（LLM-as-Judge + 版本）
│       │   ├── guardrail/ # 输出校验（6 种规则 + 重试/拒绝/警告）
│       │   └── prompt_template/ # Prompt 模板市场 + Prompt 缓存
│       └── utils/          # 安全工具（注入检测、脱敏）
├── frontend/
│   └── src/
│       ├── pages/          # 页面组件
│       │   ├── Collaboration.tsx  # 多智能体协同管理
│       │   ├── AgentEditor.tsx   # Agent 编辑器（审批/路由/A2A 配置）
│       │   ├── Chat.tsx          # 对话页（多模态、审批、路由、中断）
│       │   ├── Memory.tsx        # 长期记忆管理
│       │   ├── Workflows.tsx     # DAG 工作流（含版本历史）
│       │   ├── Evaluations.tsx   # 评估框架（含版本历史）
│       │   ├── Guardrails.tsx    # Guardrail 规则编辑器 + 测试
│       │   ├── PromptTemplates.tsx # Prompt 模板市场 + 缓存
│       │   ├── Dashboard.tsx    # 仪表盘
│       │   ├── Skills.tsx       # Skill 管理
│       │   ├── Traces.tsx       # Trace 监控
│       │   └── ...
│       ├── components/     # 通用组件
│       │   ├── ToolCallCard.tsx  # 工具卡片（含委托卡片）
│       │   └── ChatMessage.tsx  # 消息气泡
│       ├── api/            # API 调用层
│       ├── stores/         # Zustand 状态管理
│       └── types/          # TypeScript 类型
├── docker/                 # Docker 构建配置
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── supervisord.conf
│   └── entrypoint.sh
└── docker-compose.yml
```

## API 文档

启动服务后访问 `http://localhost:8080/docs` 查看 OpenAPI 自动文档。

主要 API 端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/agents/{id}/chat` | Agent 对话（SSE 流式） |
| `GET/POST` | `/api/agents` | Agent CRUD |
| `GET/POST` | `/api/agents/{id}/versions` | Agent 版本管理 |
| `GET` | `/api/agents/{id}/export` | 导出 Agent 配置 |
| `POST` | `/api/agents/import` | 导入 Agent 配置 |
| `GET/POST` | `/api/agents/{id}/workers` | Worker 池管理（多智能体协同） |
| `DELETE` | `/api/agents/{id}/workers/{row_id}` | 移除 Worker |
| `GET/POST` | `/api/skills` | Skill CRUD |
| `POST` | `/api/skills/{id}/test` | Skill 在线测试 |
| `GET/POST` | `/api/mcp/servers` | MCP 服务管理 |
| `GET` | `/api/mcp/servers/{id}/tools` | MCP 工具列表 |
| `GET/POST` | `/api/knowledge` | 知识库管理 |
| `POST` | `/api/knowledge/{id}/search` | 向量检索 |
| `GET` | `/api/knowledge/{kb_id}/documents/{doc_id}/chunks` | Chunk 预览 |
| `GET` | `/api/traces` | Trace 列表 |
| `GET` | `/api/traces/stream` | Trace SSE 实时流 |
| `GET` | `/api/stats` | 统计仪表盘（含 Token/错误/延迟） |
| `GET` | `/api/stats/errors` | 错误聚合 |
| `GET` | `/api/stats/tokens` | Token 成本统计 |
| `GET/POST` | `/api/agents/{id}/memories` | 长期记忆 CRUD |
| `GET` | `/api/a2a/agents/{id}/card` | A2A Agent Card |
| `POST` | `/api/a2a/tasks` | A2A 远程任务接入 |
| `GET/POST` | `/api/workflows` | 工作流 CRUD |
| `POST` | `/api/workflows/{id}/run` | 运行工作流（SSE） |
| `GET/POST` | `/api/workflows/{id}/versions` | 工作流版本管理 |
| `POST` | `/api/workflows/{id}/versions/{vid}/rollback` | 工作流版本回滚 |
| `GET/POST` | `/api/evaluations` | 评估定义 CRUD |
| `POST` | `/api/evaluations/{id}/run` | 运行评估（SSE） |
| `GET/POST` | `/api/evaluations/{id}/versions` | 评估版本管理 |
| `POST` | `/api/evaluations/{id}/versions/{vid}/rollback` | 评估版本回滚 |
| `GET/POST` | `/api/guardrails` | Guardrail 规则 CRUD |
| `POST` | `/api/guardrails/{id}/test` | Guardrail 规则测试 |
| `GET/POST` | `/api/prompt-templates` | Prompt 模板市场 CRUD |
| `POST` | `/api/prompt-templates/{id}/render` | 模板渲染预览 |
| `POST` | `/api/prompt-templates/{id}/apply/{agent_id}` | 应用模板到 Agent |
| `GET` | `/api/prompt-cache/stats` | Prompt 缓存统计 |
| `DELETE` | `/api/prompt-cache` | 清空 Prompt 缓存 |

## 架构设计

```
用户 → Nginx (80) → FastAPI (8000)
                      ├── Agent Loop Engine
                      │   ├── Context Builder（历史 + 压缩 + Worker 清单 + 多模态图片）
                      │   ├── Smart Routing（复杂度评估 → 模型切换）
                      │   ├── LLM Runner（流式 + tool_calls + 中断保留）
                      │   ├── HITL Approval（工具执行前人工审批）
                      │   ├── Guardrails（输出校验 + 重试/拒绝/警告）
                      │   ├── Long-term Memory（跨会话记忆提取与检索注入）
                      │   ├── Delegation Engine（委托拦截 + 子 Agent Loop）
                      │   ├── Skill Router
                      │   ├── MCP Tool Caller
                      │   └── Knowledge Retriever
                      ├── DAG Workflow Engine（拓扑编排 + 节点级流式执行）
                      ├── Evaluation Engine（LLM-as-Judge 多准则评分）
                      ├── Prompt Cache（相同 Prompt 命中缓存）
                      ├── SQLite（对话、配置、Trace、Worker 池、版本快照）
                      ├── ChromaDB（向量检索）
                      └── SSE Stream → 前端
```

## License

MIT
