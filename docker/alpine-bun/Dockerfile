# Alpine 固定 3.23（musl 1.2.5）：3.24+ 的 musl 把 pwrite() 改走 pwritev2，在 seccomp 未放行
# pwritev2 的宿主上会被拦成 EPERM（典型是 libseccomp < 2.3.2 的老宿主）。bun 本身走 Zig
# 原生 syscall 不受影响，但用户会在这层上 apk add 其它 musl 链接的程序，所以基底保持一致。
# 方案见 gate/README.md。
ARG ALPINE_VERSION=3.23

FROM alpine:${ALPINE_VERSION}

# 门禁：拒绝 Alpine >= 3.24 / musl >= 1.2.6 的基底
RUN set -eu; \
    alpine=$(cat /etc/alpine-release); \
    musl=$(for f in /lib/ld-musl-*.so.1; do "$f" --version 2>&1; done | sed -n 's/^Version //p' | head -n1); \
    case "$alpine" in 3.2[4-9]*|3.[3-9]*|[4-9]*) echo "门禁失败：Alpine $alpine >= 3.24，musl 的 pwrite 走 pwritev2，老宿主会 EPERM（见 gate/README.md）" >&2; exit 1;; esac; \
    case "$musl" in 1.2.[6-9]*|1.[3-9]*|[2-9]*) echo "门禁失败：musl $musl >= 1.2.6，pwrite 走 pwritev2，老宿主会 EPERM（见 gate/README.md）" >&2; exit 1;; esac; \
    echo "musl-pwrite 基线：Alpine $alpine / musl $musl"

ARG BUN_INSTALL_BIN=/usr/local/bin
ENV BUN_INSTALL_BIN=${BUN_INSTALL_BIN}

# 由构建脚本传入精确版本，保证 tag（如 alpine3.23.8-bun1.4.4）与实际安装版本一致
ARG BUN_VERSION=

# 安装bun环境
RUN  apk update \
    && apk add --no-cache --update curl bash libstdc++ libgcc \
    && if [ -n "${BUN_VERSION}" ]; then \
        curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"; \
    else \
        curl -fsSL https://bun.sh/install | bash; \
    fi \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && which bun \
    && which bunx \
    && bun --version \
    && if [ -n "${BUN_VERSION}" ] && [ "$(bun --version)" != "${BUN_VERSION}" ]; then \
        echo "bun 版本不符：期望 ${BUN_VERSION}，实际 $(bun --version)" >&2; exit 1; \
    fi \
    && apk del curl bash \
    && rm -rf /var/cache/apk/*
