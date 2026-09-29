# Agent 开发平台

一个开源的 LLM Agent 工程化平台，提供 Skill 管理、MCP 工具集成、知识库、可观测性、上下文压缩等工程能力，帮助开发者快速构建和运维 Agent 应用。

**NOTICE**: 该平台为实验性版本，不建议在生产环境中使用，相关功能可能不完善。

## 核心功能

| 模块 | 功能 |
|------|------|
| **Agent** | 多 Agent 管理、版本快照与回滚、导入/导出、在线调试沙箱 |
| **Skill** | Prompt 模板管理、参数 Schema、在线测试、版本历史 |
| **MCP** | MCP Server 管理、工具自动发现、工具浏览器 |
| **知识库** | 文档上传、自动分块、向量检索、Chunk 预览 |
| **Provider** | 多 LLM Provider（OpenAI / Ollama / vLLM 兼容）、API Key 加密存储 |
| **可观测性** | Trace 全链路追踪、SSE 实时流、错误聚合、Token 成本统计 |
| **安全** | Prompt 注入检测、敏感数据脱敏 |
| **OpenAPI** | 第三方 API 调用、API Key 管理、代码生成器（cURL / Python / JS） |
| **Harness** | 工程测试层，批量用例管理与执行 |
| **上下文压缩** | 自动压缩长对话历史，降低 Token 消耗 |

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
agent-platform/
├── backend/
│   └── app/
│       ├── core/           # 配置、日志、生命周期
│       ├── db/             # SQLModel 数据模型、初始化
│       ├── llm/            # LLM 客户端封装
│       ├── modules/        # 业务模块
│       │   ├── agent/     # Agent 管理 + Loop 引擎
│       │   ├── skill/     # Skill 模板
│       │   ├── mcp/       # MCP 工具集成
│       │   ├── knowledge/ # 知识库 + 向量检索
│       │   ├── trace/     # 追踪与监控
│       │   ├── openapi/   # 第三方 API
│       │   ├── provider/  # LLM Provider
│       │   ├── apikey/    # API Key 管理
│       │   └── harness/   # 工程测试层
│       └── utils/          # 安全工具（注入检测、脱敏）
├── frontend/
│   └── src/
│       ├── pages/          # 页面组件
│       ├── components/     # 通用组件
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
| `GET/POST` | `/api/skills` | Skill CRUD |
| `POST` | `/api/skills/{id}/test` | Skill 在线测试 |
| `GET/POST` | `/api/mcp/servers` | MCP 服务管理 |
| `GET` | `/api/mcp/servers/{id}/tools` | MCP 工具列表 |
| `GET/POST` | `/api/knowledge` | 知识库管理 |
| `POST` | `/api/knowledge/{id}/search` | 向量检索 |
| `GET` | `/api/traces` | Trace 列表 |
| `GET` | `/api/traces/stream` | Trace SSE 实时流 |
| `GET` | `/api/stats` | 统计仪表盘 |
| `GET` | `/api/stats/errors` | 错误聚合 |
| `GET` | `/api/stats/tokens` | Token 成本统计 |

## 架构设计

```
用户 → Nginx (80) → FastAPI (8000)
                      ├── Agent Loop Engine
                      │   ├── Context Builder（历史 + 压缩）
                      │   ├── LLM Runner（流式 + tool_calls）
                      │   ├── Skill Router
                      │   ├── MCP Tool Caller
                      │   └── Knowledge Retriever
                      ├── SQLite（对话、配置、Trace）
                      ├── ChromaDB（向量检索）
                      └── SSE Stream → 前端
```

## License

MIT
