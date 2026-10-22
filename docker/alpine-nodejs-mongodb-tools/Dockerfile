ARG NODE_VERSION=24.22.1
ARG NODE_IMAGE=public.ecr.aws/docker/library/node

FROM ${NODE_IMAGE}:${NODE_VERSION}-alpine

# 安全基线：2026-10-21 Node.js 安全公告（含 CVE-2026-111497）
RUN node -e "const [M,m,p]=process.versions.node.split('.').map(Number);const ok=(M===22&&(m>23||(m===23&&p>=4)))||(M===24&&(m>22||(m===22&&p>=1)))||(M===26&&(m>12||(m===12&&p>=1)))||M>26;if(!ok){console.error('Node.js '+process.versions.node+' 未包含 2026-10-21 安全修复');process.exit(1)}" \
    && apk upgrade --no-cache \
    && apk add --no-cache --update git mongodb-tools \
    && node -v && npm -v && git --version && mongodump --version \
    && npm i -g pnpm@11 \
    && pnpm -v \
    && npm cache clean --force \
    && rm -rf /tmp/* /var/cache/apk/*
