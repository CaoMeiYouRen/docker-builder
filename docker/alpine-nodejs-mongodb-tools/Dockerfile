FROM alpine:latest

# 安装nodejs环境
RUN  apk update \
    && apk add --no-cache --update nodejs npm git mongodb-tools \
    && node -v && npm -v && git --version && mongodump --version \
    && npm i -g pnpm \
    && pnpm -v
