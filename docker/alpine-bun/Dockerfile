FROM alpine:latest

# 安装bun环境
RUN  apk update \
    && apk add --no-cache --update git curl bash libstdc++ libgcc\
    && git --version \
    && curl -fsSL https://bun.sh/install | bash \
    && export BUN_INSTALL="$HOME/.bun" \
    && export PATH="$BUN_INSTALL/bin:$PATH" \
    && bun --version

