"""全局配置：环境变量 + 运行时设置。

设计原则：
- 静态配置（路径、开关）走环境变量，启动时读取一次。
- 动态配置（默认 embedding、压缩阈值等）走 settings 表，运行时可改。
"""
from __future__ import annotations

import os
from pathlib import Path
from pydantic import BaseModel


class Settings(BaseModel):
    # ===== 数据卷路径（entrypoint 注入）=====
    data_dir: Path = Path(os.getenv("DATA_DIR", "/app/data"))
    sqlite_path: Path = Path(os.getenv("SQLITE_PATH", str(Path(os.getenv("DATA_DIR", "/app/data")) / "sqlite" / "app.db")))
    chroma_path: Path = Path(os.getenv("CHROMA_PATH", str(Path(os.getenv("DATA_DIR", "/app/data")) / "chroma")))
    upload_path: Path = Path(os.getenv("UPLOAD_PATH", str(Path(os.getenv("DATA_DIR", "/app/data")) / "uploads")))

    # ===== 加密主密钥（用于 provider api_key 的 Fernet 加解密）=====
    # 优先读 env；env 无则落盘到 data/.secret_key（持久化卷内，跨重启稳定）
    master_key_env: str = os.getenv("AGENT_MASTER_KEY", "")

    # ===== Embedding 双轨 =====
    # local: 本地 sentence-transformers；api: 走 provider 表里 kind=embedding 的配置
    default_embedding: str = os.getenv("DEFAULT_EMBEDDING", "local")
    local_embedding_model: str = os.getenv("LOCAL_EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")

    # ===== 服务 =====
    cors_origins: list[str] = ["*"]
    # SSE 调用最大迭代兜底（防止失控），约束 profile 可在此基础上更小
    hard_max_iterations: int = 50

    @property
    def secret_key_path(self) -> Path:
        return self.data_dir / ".secret_key"


settings = Settings()
