"""OpenAI 兼容客户端工厂。

按 provider 配置实例化 AsyncOpenAI，支持 OpenAI / Ollama / vLLM 等兼容端点。
不硬编码 provider 类型，纯配置驱动。
"""
from __future__ import annotations

from typing import Optional

from openai import AsyncOpenAI

from app.core.logging import logger
from app.modules.provider.cache import ProviderConfig, provider_cache


def build_client(config: ProviderConfig) -> AsyncOpenAI:
    """按 ProviderConfig 构造 AsyncOpenAI 客户端。"""
    kwargs: dict = {
        "base_url": config.base_url,
        # 空字符串 key 也兼容（如本地 Ollama 无需 key）
        "api_key": config.api_key or "not-required",
    }
    if config.headers:
        kwargs["default_headers"] = config.headers
    return AsyncOpenAI(**kwargs)


async def list_remote_models(config: ProviderConfig) -> list[str]:
    """调用远端 /v1/models 列模型，用于「测试连接」。"""
    client = build_client(config)
    try:
        resp = await client.models.list()
        return [m.id for m in resp.data]
    except Exception as e:
        logger.warning(f"列模型失败 base_url={config.base_url}: {e}")
        raise
