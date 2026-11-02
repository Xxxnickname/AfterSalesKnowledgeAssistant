FROM postgres:15-alpine

# 本地离线可复现的 pgvector 构建；镜像源不稳定时避免依赖 pgvector/pgvector 镜像。
RUN apk add --no-cache --virtual .pgvector-build git build-base \
    && git clone --depth 1 --branch v0.7.4 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && cd /tmp/pgvector \
    && make with_llvm=no \
    && make install with_llvm=no \
    && cd / \
    && rm -rf /tmp/pgvector \
    && apk del .pgvector-build


