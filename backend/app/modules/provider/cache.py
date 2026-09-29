"""Provider 配置内存缓存：避免每次 agent loop 都查库。

CRUD 后调用 invalidate；get_active_model 优先读缓存，未命中回库。
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Optional


@dataclass
class ProviderConfig:
    """解密后的可用 provider 配置（用于实例化 LLM 客户端）。"""
    provider_id: int
    kind: str
    base_url: str
    api_key: str  # 明文（仅内存中）
    headers: dict
    enabled: bool


class _ProviderCache:
    def __init__(self):
        self._store: dict[int, ProviderConfig] = {}
        self._lock = threading.Lock()

    def get(self, provider_id: int) -> Optional[ProviderConfig]:
        with self._lock:
            return self._store.get(provider_id)

    def set(self, config: ProviderConfig) -> None:
        with self._lock:
            self._store[config.provider_id] = config

    def invalidate(self, provider_id: int) -> None:
        with self._lock:
            self._store.pop(provider_id, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


provider_cache = _ProviderCache()
