FROM alpine:latest

# 安装bun环境
RUN  apk update \
    && apk add --no-cache --update git curl bash libstdc++ libgcc \
    && curl -fsSL https://bun.sh/install | bash \
    && export PATH="$HOME/.bun/bin:$PATH" \
    && echo 'export "PATH=$PATH' >> /etc/profile \
    && bun --version \
    && rm -rf /var/cache/apk/*

# 将bun添加到全局路径
ENV PATH="$HOME/.bun/bin:${PATH}"
