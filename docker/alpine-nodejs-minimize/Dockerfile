FROM alpine:latest

# 安装nodejs环境
RUN  apk update \
    && apk add --no-cache --update nodejs \
    && node -v \
    && rm -rf /var/cache/apk/*
