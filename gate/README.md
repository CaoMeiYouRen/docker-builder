# 门禁：musl pwritev2 / seccomp EPERM

本目录是 docker-builder 的发布门禁，用来保证**构建出来的 Alpine 镜像不会在 seccomp 过滤器未放行 `pwritev2` 的宿主上写文件报 `EPERM`**。

## 背景

Alpine 3.24 起（musl 1.2.6）把 `pwrite()` 改成先发 `pwritev2(..., RWF_NOAPPEND)`：

```
Alpine >= 3.24 (musl >= 1.2.6)
  └─ pwrite() 先发 pwritev2
       └─ 生效的 seccomp 过滤器没有放行 pwritev2（defaultAction = EPERM）
            ├─ 宿主 libseccomp < 2.3.2 不认识该名字 → 规则被丢弃（CentOS/RHEL 7）
            └─ 或运行时/平台自带的 profile 本来就没放行
                 └─ 直接 EPERM（轮不到内核返回 ENOSYS / EOPNOTSUPP）
                      └─ EPERM 不在 musl 的回退条件里 → 写入失败
```

典型受害者：PHP session（登录态丢失）、SQLite（`disk I/O error`）、Node `fs.write(fd, buf, off, len, position)`、Python `os.pwrite()`、Rust `FileExt::write_at()`，以及任何经过 musl `pwrite()` 的程序。症状统一是 `EPERM (1)`，不是 `EACCES (13)`。

**本仓库的结论：Alpine 基底固定在 3.23（musl 1.2.5），且必须有门禁防止回退。**

## 三道门禁

| 门禁 | 位置 | 作用 |
|---|---|---|
| 构建期断言 | 每个 `docker/*/Dockerfile` | Alpine >= 3.24 或 musl >= 1.2.6 时构建直接失败 |
| 发布前功能探测 | `src/index.ts` → `musl-pwrite-gate.sh` | 推送前在 seccomp 夹具下真跑一次 `pwrite()`，对应 `node:<ver>-alpine3.23` 和 `alpine:3.23` |
| CI 静态扫描 | `.github/workflows/test.yml` → `check-alpine-base.sh` | 扫描 Dockerfile（含 `ARG` 默认值解析），出现 `alpine:3.24+` 就失败 |

### 为什么用功能探测而不是只看版本

同一个 Alpine 3.24 镜像，在不同宿主上结果完全不同：

| 宿主 | 内核有 pwritev2 | seccomp 放行 | 结果 |
|---|---|---|---|
| CentOS 7 + libseccomp 2.3.1 | 无 | 否（规则被丢弃 → EPERM） | **坏** |
| CentOS 7 + libseccomp >= 2.3.2 | 无 | 是（→ ENOSYS → musl 回退） | 正常 |
| 新内核 | 有 | 是 | 正常 |
| Alpine 3.23（musl 1.2.5） | — | — | 正常（走 `pwrite64`） |

所以判定以「真跑一次 `pwrite()`」为准，版本只用于解释原因。

托管 CI runner 都是新内核，本来永远探测通过；`seccomp/pwritev2-eperm.json` 只把 `pwritev2` 改成返回 `EPERM`（其余规则与 Docker 默认 profile 一致），因此可以在任何 runner 上精确复现 CentOS 7 的行为。

## 跟 Docker 版本有关吗

基本无关。触发条件只有两个，同时成立就炸：

1. 镜像里的 musl >= 1.2.6（Alpine >= 3.24），`pwrite()` 先发 `pwritev2`；
2. **实际生效的 seccomp 过滤器**没有放行 `pwritev2`，于是落到 `defaultAction = EPERM`。

Docker 主版本只在很窄的范围里参与：

- Docker **<= 17.03** 的默认 profile 里确实没有 `pwritev2`（17.06 起才有），这种版本才会自己漏掉规则。
- 17.06 及以后 profile 一直包含 `pwritev2`，是否被拦取决于编译 profile 的 libseccomp：
  - libseccomp **< 2.3.2** 的 syscall 表里没有 `pwritev2`，runc 会静默忽略该名字（只在 debug 日志里记一句 `unknown seccomp syscall ignored`），规则消失后落到 EPERM；
  - libseccomp >= 2.3.2 会把它编译进白名单（2.3.1 没有、2.3.2 才有）。
- 发行版包（docker-ce / containerd.io）链接**宿主**的 libseccomp，升级 Docker 引擎不会替换它；官方静态二进制 / Docker Desktop 才自带较新的 libseccomp。

内核新旧本身不是触发条件：内核 < 4.6 返回 `ENOSYS`，4.6–6.8 因为不认 `RWF_NOAPPEND` 返回 `EOPNOTSUPP`，这两种 musl 都会回退到 `pwrite64`；只有 `EPERM` 不回退（对 `O_APPEND` 文件 musl 会按设计返回 `EOPNOTSUPP`，避免静默写到错误位置，与本问题无关）。反过来说，新内核 + 自定义/平台 seccomp 策略同样会炸。

公开报告与实测（镜像都是 Alpine 3.24 / musl 1.2.6）：

| 宿主 | Docker | 内核 | 结果 |
|---|---|---|---|
| CentOS 7.9（libseccomp 2.3.1） | 26.1.4 | 3.10 | 失败（[nginx#1059](https://github.com/nginx/docker-nginx/issues/1059)） |
| CentOS Stream 9 | 24.0.2 | 5.14 | 正常（同上） |
| macOS + Docker Desktop | 28.5.1 | VM 内核 | 正常（同上） |
| Ubuntu 平台（Cloud Foundry 自带 profile） | 平台自带 | 5.15 | 失败（同上） |
| Ubuntu 24.04 | 29.7.2 | 5.15 | 默认正常；套本目录夹具后失败 |

复现「规则被丢弃」这条路径：把 Docker 默认 profile 白名单里的 `pwritev2` 改名成 libseccomp 不认识的名字，容器能照常启动、无任何报错，但带 offset 的写入立刻变成 `EPERM`。这与老 libseccomp 丢规则的效果一致，而夹具只能覆盖「显式拒绝」。

老宿主的处理顺序：升级 libseccomp 到 >= 2.3.2（很多老发行版官方源没有，需要第三方源或自编译）→ 或改用自带 libseccomp 的静态 Docker 构建 → 或 `--security-opt seccomp=unconfined`（有安全代价）→ 或镜像继续用 Alpine 3.23 / glibc 基底。

## 用法

静态扫描：

```bash
./gate/check-alpine-base.sh --fail docker
```

功能探测（可对任意镜像）：

```bash
./gate/musl-pwrite-gate.sh --image node:24.22.1-alpine3.23 --image alpine:3.23
./gate/musl-pwrite-gate.sh --image caomeiyouren/alpine-nodejs:latest
./gate/musl-pwrite-gate.sh --image myimage --no-probe   # 只校验版本
```

退出码：`0` 通过 / `1` 命中问题 / `2` 无法完成检查（镜像或 docker 不可用）。

自测（应当一通过一失败）：

```bash
./gate/musl-pwrite-gate.sh --image node:24.22.1-alpine3.23   # 通过
./gate/musl-pwrite-gate.sh --image node:24.22.1-alpine       # 失败，exit 1
```

## 为什么钉 Alpine 3.23 而不是编译 Node

- `node:24.22.1-alpine3.23` 目前仍在官方多架构发布（amd64 / arm64 / s390x 等），无需源码编译。
- 体积无代价：`alpine:3.23` 与 `3.24` 同为 13MB，`node:24.22.1-alpine3.23` 与 `3.24` 同为 244MB，node 二进制完全相同。
- Alpine 3.23 支持到 **2027-11**。

## 3.23 之后怎么办

当上游不再发布 `-alpine3.23` 变体（或 3.23 到达 EOL）时，`src/index.ts` 会明确报错，可选路径：

1. **等上游补齐 tag**：先临时固定一个仍带 `-alpine3.23` 的 Node 版本。
2. **下载 musl 二进制**：`https://nodejs.org/dist/vX/node-vX-linux-x64-musl.tar.xz`（官方仅 x64）。
3. **源码编译**：在 Alpine 3.23 上编译 Node.js，覆盖 arm64 等无官方 musl 二进制的架构。
4. **退回 glibc 基底**（Debian/Ubuntu）：最稳，但体积显著增加。
5. **退回 Alpine 3.24+ 并接受风险**：必须同时提供运行期自检（例如在 entrypoint / healthcheck 里跑一次带 offset 的写入并告警），并在文档中说明老宿主要加 `--security-opt seccomp=unconfined`。

## 文件

```
gate/
├── check-alpine-base.sh        # CI 静态扫描（解析 Dockerfile 内 ARG 默认值）
├── musl-pwrite-gate.sh         # 发布前功能探测 + 版本校验
├── pwrite-probe.cjs            # 真实 pwrite() 探测脚本（零依赖）
└── seccomp/
    └── pwritev2-eperm.json     # 只把 pwritev2 变成 EPERM 的 Docker 默认 profile
```

`pwritev2-eperm.json` 取自 `freshrss-deploy/musl-pwrite-guard` 的验证夹具，含义与 `docker run --security-opt seccomp=...` 一致。
