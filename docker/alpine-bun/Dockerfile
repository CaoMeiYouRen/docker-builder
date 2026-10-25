# Alpine 固定 3.23（musl 1.2.5）：3.24+ 的 musl 把 pwrite() 改走 pwritev2，在「内核 < 4.6 +
# 旧 libseccomp」的老宿主上会被 seccomp 拦成 EPERM。bun 本身走 Zig 原生 syscall 不受影响，
# 但用户会在这层上 apk add 其它 musl 链接的程序，所以基底保持一致。方案见 gate/README.md。
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

# 安装bun环境
RUN  apk update \
    && apk add --no-cache --update curl bash libstdc++ libgcc \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && which bun \
    && which bunx \
    && bun --version \
    && apk del curl bash \
    && rm -rf /var/cache/apk/*
