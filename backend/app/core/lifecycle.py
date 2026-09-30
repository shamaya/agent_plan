"""应用生命周期：startup 建表 + seed + 懒加载 embedding 模型。

embedding 模型懒加载：首次使用时加载（避免启动慢 + 编码机无 GPU 也能起服务）。
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from app.core.logging import logger
from app.db.init import init_db, seed_settings


@asynccontextmanager
async def lifespan(app):
    """FastAPI lifespan：启动时建表 + seed。"""
    logger.info("应用启动中...")
    init_db()
    seed_settings()
    # embedding 模型懒加载，不在此预加载
    logger.info("应用启动完成")
    yield
    logger.info("应用关闭")


def create_app():
    """构造 FastAPI 实例（供 main.py 与测试复用）。"""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.staticfiles import StaticFiles
    from pathlib import Path

    from app.config import settings

    app = FastAPI(
        title="Agent 开发平台",
        description="参考灵一 AgentOne：Skill / MCP / 知识库 / 监控 / Harness 工程层 / 上下文压缩",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 挂载各业务模块路由
    from app.modules.provider.router import router as provider_router
    from app.modules.skill.router import router as skill_router
    from app.modules.mcp.router import router as mcp_router
    from app.modules.knowledge.router import router as knowledge_router
    from app.modules.agent.router import router as agent_router
    from app.modules.harness.router import router as harness_router
    from app.modules.trace.router import router as trace_router
    from app.modules.apikey.router import router as apikey_router
    from app.modules.openapi.router import router as openapi_router
    from app.modules.a2a.router import router as a2a_router
    from app.modules.workflow.router import router as workflow_router
    from app.modules.evaluation.router import router as evaluation_router
    from app.modules.guardrail.router import router as guardrail_router
    from app.modules.prompt_template.router import router as prompt_template_router

    app.include_router(provider_router, prefix="/api")
    app.include_router(skill_router, prefix="/api")
    app.include_router(mcp_router, prefix="/api")
    app.include_router(knowledge_router, prefix="/api")
    app.include_router(agent_router, prefix="/api")
    app.include_router(harness_router, prefix="/api")
    app.include_router(trace_router, prefix="/api")
    app.include_router(apikey_router, prefix="/api")
    # 开放 API：第三方接入，认证用 X-API-Key（不走前端 X-Master-Key）
    app.include_router(openapi_router, prefix="/api/v1")
    # A2A Protocol：Agent2Agent 互操作（Agent Card + 任务接入）
    # 用 /api/a2a 前缀以便复用 nginx /api/ 转发规则
    app.include_router(a2a_router, prefix="/api/a2a")
    # DAG 工作流：多 Agent 编排
    app.include_router(workflow_router, prefix="/api")
    # 评估框架：LLM-as-Judge
    app.include_router(evaluation_router, prefix="/api")
    # Guardrail：输出校验 + 重试
    app.include_router(guardrail_router, prefix="/api")
    # Prompt 模板市场 + 缓存
    app.include_router(prompt_template_router, prefix="/api")

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": "0.1.0"}

    # 前端静态托管（生产镜像里 nginx 直接 serve；开发/兜底用 StaticFiles）
    static_dir = Path("/app/static")
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app


app = create_app()
