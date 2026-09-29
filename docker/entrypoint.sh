#!/bin/sh
set -e

# 数据卷子目录
mkdir -p "$DATA_DIR/sqlite" "$DATA_DIR/chroma" "$DATA_DIR/uploads" "$DATA_DIR/hf_cache" 2>/dev/null || true
export DATA_DIR
export HF_HOME="${HF_HOME:-$DATA_DIR/hf_cache}"
export SENTENCE_TRANSFORMERS_HOME="$HF_HOME"

# 初始化数据库（建表 + seed 默认 settings）
echo "[entrypoint] 初始化数据库..."
python -m app.db.init || { echo "[entrypoint] DB 初始化失败"; exit 1; }

echo "[entrypoint] 启动 supervisord（nginx + uvicorn）..."
exec supervisord -c /etc/supervisord.conf
