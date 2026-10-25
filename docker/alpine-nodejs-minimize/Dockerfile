ARG NODE_VERSION=24.22.1
# Alpine 固定 3.23（musl 1.2.5）：3.24+ 的 musl 把 pwrite() 改走 pwritev2，在「内核 < 4.6 +
# 旧 libseccomp」的老宿主上会被 seccomp 拦成 EPERM。EOL 2027-11，后续方案见 gate/README.md。
ARG ALPINE_VERSION=3.23
ARG NODE_IMAGE=public.ecr.aws/docker/library/node

# 官方只提供 linux-x64-musl 的独立二进制，arm64 必须通过官方多架构镜像获取，
# 因此这里从官方镜像复制 node，而不是下载 tarball。
FROM ${NODE_IMAGE}:${NODE_VERSION}-alpine${ALPINE_VERSION} AS node-src

FROM alpine:${ALPINE_VERSION}

# 门禁：拒绝 Alpine >= 3.24 / musl >= 1.2.6 的基底（本地安装的 node 也会链接这个 musl）
RUN set -eu; \
    alpine=$(cat /etc/alpine-release); \
    musl=$(for f in /lib/ld-musl-*.so.1; do "$f" --version 2>&1; done | sed -n 's/^Version //p' | head -n1); \
    case "$alpine" in 3.2[4-9]*|3.[3-9]*|[4-9]*) echo "门禁失败：Alpine $alpine >= 3.24，musl 的 pwrite 走 pwritev2，老宿主会 EPERM（见 gate/README.md）" >&2; exit 1;; esac; \
    case "$musl" in 1.2.[6-9]*|1.[3-9]*|[2-9]*) echo "门禁失败：musl $musl >= 1.2.6，pwrite 走 pwritev2，老宿主会 EPERM（见 gate/README.md）" >&2; exit 1;; esac; \
    echo "musl-pwrite 基线：Alpine $alpine / musl $musl"

# 官方 node 二进制动态依赖 libstdc++ / libgcc
RUN apk add --no-cache libstdc++ libgcc

COPY --from=node-src /usr/local/bin/node /usr/local/bin/node
COPY --from=node-src /usr/local/LICENSE /usr/local/LICENSE

# 构建期兜底：低于已修复版本直接失败，防止基础镜像回退
RUN node -e "const [M,m,p]=process.versions.node.split('.').map(Number);const ok=(M===22&&(m>23||(m===23&&p>=4)))||(M===24&&(m>22||(m===22&&p>=1)))||(M===26&&(m>12||(m===12&&p>=1)))||M>26;if(!ok){console.error('Node.js '+process.versions.node+' 未包含 2026-10-21 安全修复');process.exit(1)}" \
    && node -v
