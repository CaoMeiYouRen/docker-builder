FROM alpine:latest

# 安装bun环境
RUN  apk update \
    && apk add --no-cache --update curl bash libstdc++ libgcc \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
    && bun --version \
    && apk del curl bash \
    && rm -rf /var/cache/apk/*
