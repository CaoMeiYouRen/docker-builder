FROM alpine:latest

# 安装nodejs环境
RUN  apk update \
    && apk add --no-cache --update nodejs npm git \
    && node -v && npm -v && git --version \
    && npm i -g pnpm \
    && pnpm -v
