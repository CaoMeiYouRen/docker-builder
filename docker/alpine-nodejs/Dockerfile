ARG NODE_VERSION=24.22.1
# Alpine 固定 3.23（musl 1.2.5）：3.24+ 的 musl 把 pwrite() 改走 pwritev2，在「内核 < 4.6 +
# 旧 libseccomp」的老宿主上会被 seccomp 拦成 EPERM，PHP session / SQLite / Node 带 offset 的
# 写入全部失败。EOL 2027-11，之后的升级路径见 gate/README.md。
ARG ALPINE_VERSION=3.23
ARG NODE_IMAGE=public.ecr.aws/docker/library/node

FROM ${NODE_IMAGE}:${NODE_VERSION}-alpine${ALPINE_VERSION}

# 门禁：拒绝 Alpine >= 3.24 / musl >= 1.2.6 的基底，防止上游悄悄把浮动 tag 切过去
RUN set -eu; \
    alpine=$(cat /etc/alpine-release); \
    musl=$(for f in /lib/ld-musl-*.so.1; do "$f" --version 2>&1; done | sed -n 's/^Version //p' | head -n1); \
    case "$alpine" in 3.2[4-9]*|3.[3-9]*|[4-9]*) echo "门禁失败：Alpine $alpine >= 3.24，musl 的 pwrite 走 pwritev2，老宿主会 EPERM（见 gate/README.md）" >&2; exit 1;; esac; \
    case "$musl" in 1.2.[6-9]*|1.[3-9]*|[2-9]*) echo "门禁失败：musl $musl >= 1.2.6，pwrite 走 pwritev2，老宿主会 EPERM（见 gate/README.md）" >&2; exit 1;; esac; \
    echo "musl-pwrite 基线：Alpine $alpine / musl $musl"

# 安全基线：2026-10-21 Node.js 安全公告（含 CVE-2026-111497）
# 官方镜像静态链接 OpenSSL/brotli/c-ares，不依赖 Alpine 的 nodejs/brotli-libs 包
RUN node -e "const [M,m,p]=process.versions.node.split('.').map(Number);const ok=(M===22&&(m>23||(m===23&&p>=4)))||(M===24&&(m>22||(m===22&&p>=1)))||(M===26&&(m>12||(m===12&&p>=1)))||M>26;if(!ok){console.error('Node.js '+process.versions.node+' 未包含 2026-10-21 安全修复');process.exit(1)}" \
    && apk upgrade --no-cache \
    && apk add --no-cache --update git \
    && node -v && npm -v && git --version \
    && npm i -g pnpm@11 \
    && pnpm -v \
    && npm cache clean --force \
    && rm -rf /tmp/* /var/cache/apk/*
