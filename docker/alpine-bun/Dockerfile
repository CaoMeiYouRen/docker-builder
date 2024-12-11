FROM alpine:latest

# 安装bun环境
RUN  apk update \
    && apk add --no-cache --update git curl bash libstdc++ libgcc \
    && git --version \
    && curl -fsSL https://bun.sh/install | bash \
    && export PATH="$HOME/.bun/bin:$PATH" \
    && bun --version

