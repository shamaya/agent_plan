# ===== 阶段1：前端构建 =====
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ===== 阶段2：运行时（nginx + uvicorn + supervisor 单镜像） =====
FROM python:3.11-slim
# 系统依赖：nginx 反代静态 + supervisor 进程管理
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 依赖
COPY backend/requirements.txt /app/requirements.txt
# 先装 CPU-only torch（避免 sentence-transformers 拖入 CUDA 几个 GB）
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r /app/requirements.txt

# 后端代码
COPY backend/app /app/app

# 前端产物 → /app/static（nginx 托管 + FastAPI StaticFiles 兜底）
COPY --from=frontend-builder /build/dist /app/static

# 预下载本地 embedding 模型（编码机无 GPU 也用本地小模型兜底）
# 构建时联网下载到 HF 缓存；离线/无网环境可删此 RUN，首次 embedding 时按需下载
ENV HF_HOME=/app/hf_cache \
    SENTENCE_TRANSFORMERS_HOME=/app/hf_cache
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')" \
    || echo "[warn] embedding 模型预下载失败，将首次使用时按需下载"

# Docker 配置
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 运行时数据卷
ENV DATA_DIR=/app/data \
    AGENT_MASTER_KEY=change-me-please
RUN mkdir -p /app/data/sqlite /app/data/chroma /app/data/uploads

EXPOSE 80

CMD ["/app/entrypoint.sh"]
