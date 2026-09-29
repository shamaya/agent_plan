"""FastAPI 入口。

运行：uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from app.core.lifecycle import app  # noqa: F401
