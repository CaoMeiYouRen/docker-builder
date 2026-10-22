ARG NODE_VERSION=24.22.1
ARG ALPINE_VERSION=3.24
ARG NODE_IMAGE=public.ecr.aws/docker/library/node

# 官方 musl 二进制只提供 linux-x64-musl，arm64 必须通过官方多架构镜像获取，
# 因此这里从官方镜像复制 node，而不是下载 tarball。
FROM ${NODE_IMAGE}:${NODE_VERSION}-alpine AS node-src

FROM alpine:${ALPINE_VERSION}

# 官方 node 二进制动态依赖 libstdc++ / libgcc
RUN apk add --no-cache libstdc++ libgcc

COPY --from=node-src /usr/local/bin/node /usr/local/bin/node
COPY --from=node-src /usr/local/LICENSE /usr/local/LICENSE

# 构建期兜底：低于已修复版本直接失败，防止基础镜像回退
RUN node -e "const [M,m,p]=process.versions.node.split('.').map(Number);const ok=(M===22&&(m>23||(m===23&&p>=4)))||(M===24&&(m>22||(m===22&&p>=1)))||(M===26&&(m>12||(m===12&&p>=1)))||M>26;if(!ok){console.error('Node.js '+process.versions.node+' 未包含 2026-10-21 安全修复');process.exit(1)}" \
    && node -v
