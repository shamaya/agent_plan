"""Provider api_key 的对称加密：Fernet。

主密钥来源（优先级）：
1. env AGENT_MASTER_KEY
2. data/.secret_key 文件（首次启动自动生成 32 字节随机密钥并落盘）

API 永不回传明文 key，仅返回 has_key / key_preview。
"""
from __future__ import annotations

import secrets
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _load_or_create_master_key() -> bytes:
    """加载或生成主密钥（Fernet 需要 32 字节 urlsafe base64）。

    env AGENT_MASTER_KEY 若已是合法 Fernet key 直接用；否则用 SHA-256 派生 32 字节再 base64url，
    使任意字符串 master key 都能工作（用户友好）。无 env 时落盘到 data/.secret_key，跨重启稳定。
    """
    if settings.master_key_env:
        env = settings.master_key_env.encode()
        try:
            Fernet(env)  # 校验是否合法 Fernet key
            return env
        except Exception:
            import base64, hashlib
            derived = hashlib.sha256(env).digest()
            return base64.urlsafe_b64encode(derived)

    key_file = settings.secret_key_path
    if key_file.exists():
        return key_file.read_bytes()

    key = Fernet.generate_key()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    key_file.write_bytes(key)
    # 文件权限收紧（仅 owner 可读）
    try:
        key_file.chmod(0o600)
    except OSError:
        pass  # Windows 上 chmod 语义不同，忽略
    return key


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    return Fernet(_load_or_create_master_key())


def encrypt(plaintext: str) -> str:
    """加密明文 api_key，返回可存库的字符串。"""
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """解密 api_key。空串返回空串。"""
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        return ""


def preview(plaintext: str) -> str:
    """生成 key 预览：sk-***x9f2 形式，用于前端展示。"""
    if not plaintext:
        return ""
    if len(plaintext) <= 8:
        return plaintext[:2] + "***"
    return f"{plaintext[:3]}***{plaintext[-4:]}"
