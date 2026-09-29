"""Embedding 双轨：本地 sentence-transformers / API provider。

默认本地（编码机无 GPU 也能跑小模型）；provider 表里 kind=embedding 时切 API。
懒加载，首次调用才加载模型。
"""
from __future__ import annotations

import threading
from typing import Optional

from app.config import settings
from app.core.logging import logger
from app.modules.provider.cache import ProviderConfig
from app.llm.client import build_client


class _LocalEmbedder:
    """本地 sentence-transformers 封装，懒加载 + 单例。"""
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self._model = None  # 懒加载

    @classmethod
    def get(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _ensure(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            logger.info(f"加载本地 embedding 模型: {settings.local_embedding_model}")
            self._model = SentenceTransformer(settings.local_embedding_model)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self._ensure()
        vecs = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
        return [v.tolist() for v in vecs]

    def dim(self) -> int:
        return len(self.embed(["维度探测"])[0])


class _ApiEmbedder:
    """走 provider 表配置的 embedding API。"""
    def __init__(self, config: ProviderConfig, model_name: str):
        self._config = config
        self._model_name = model_name
        self._client = build_client(config)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        resp = await self._client.embeddings.create(
            model=self._model_name, input=texts
        )
        return [d.embedding for d in resp.data]


def embed_texts_local(texts: list[str]) -> list[list[float]]:
    """同步本地 embedding（用于知识库入库流程）。"""
    return _LocalEmbedder.get().embed(texts)


async def embed_texts_api(config: ProviderConfig, model_name: str, texts: list[str]) -> list[list[float]]:
    """异步 API embedding。"""
    return await _ApiEmbedder(config, model_name).embed(texts)


def local_embedding_dim() -> int:
    return _LocalEmbedder.get().dim()
