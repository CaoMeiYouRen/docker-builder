FROM alpine:latest

# 安装bun环境
RUN  apk update \
    && apk add --no-cache --update curl bash libstdc++ libgcc \
    && curl -fsSL https://bun.sh/install | bash \
    && export PATH="$HOME/.bun/bin:$PATH" \
    && bun --version \
    && apk del curl bash \
    && rm -rf /var/cache/apk/*

