<h1 align="center">docker-builder </h1>
<p>
  <img alt="Version" src="https://img.shields.io/github/package-json/v/CaoMeiYouRen/docker-builder.svg" />
  <img src="https://img.shields.io/badge/node-%3E%3D16-blue.svg" />
  <a href="https://github.com/CaoMeiYouRen/docker-builder#readme" target="_blank">
    <img alt="Documentation" src="https://img.shields.io/badge/documentation-yes-brightgreen.svg" />
  </a>
  <a href="https://github.com/CaoMeiYouRen/docker-builder/graphs/commit-activity" target="_blank">
    <img alt="Maintenance" src="https://img.shields.io/badge/Maintained%3F-yes-green.svg" />
  </a>
  <a href="https://github.com/CaoMeiYouRen/docker-builder/blob/master/LICENSE" target="_blank">
    <img alt="License: MIT" src="https://img.shields.io/github/license/CaoMeiYouRen/docker-builder?color=yellow" />
  </a>
</p>


> Docker 项目构建器

## 当前构建版本

<!-- DOCKER_START -->
<!-- DOCKER_META node=26.13.1 alpine=3.23.8 bunalpine=3.23.8 base=sha256:39d8c143e60e99ae98f014bebea1e72fc96d3c9bdf9504bc3a27af5c05bfa39f bun=1.4.4 tags=2 -->
```
caomeiyouren/alpine-bun:latest
caomeiyouren/alpine-bun:1.4.4-alpine3.23
caomeiyouren/alpine-bun:alpine3.23.8-bun1.4.4
caomeiyouren/alpine-bun:alpine3.23-bun1.4
caomeiyouren/alpine-bun:alpine3-bun1
caomeiyouren/alpine-bun:2026-11-16
caomeiyouren/alpine-nodejs:latest
caomeiyouren/alpine-nodejs:26.13.1-alpine3.23
caomeiyouren/alpine-nodejs:alpine3.23.8-node26.13.1
caomeiyouren/alpine-nodejs:alpine3.23-node26.13
caomeiyouren/alpine-nodejs:alpine3-node26
caomeiyouren/alpine-nodejs:2026-11-16
caomeiyouren/alpine-nodejs-minimize:latest
caomeiyouren/alpine-nodejs-minimize:26.13.1-alpine3.23
caomeiyouren/alpine-nodejs-minimize:alpine3.23.8-node26.13.1
caomeiyouren/alpine-nodejs-minimize:alpine3.23-node26.13
caomeiyouren/alpine-nodejs-minimize:alpine3-node26
caomeiyouren/alpine-nodejs-minimize:2026-11-16
caomeiyouren/alpine-nodejs-mongodb-tools:latest
caomeiyouren/alpine-nodejs-mongodb-tools:26.13.1-alpine3.23
caomeiyouren/alpine-nodejs-mongodb-tools:alpine3.23.8-node26.13.1
caomeiyouren/alpine-nodejs-mongodb-tools:alpine3.23-node26.13
caomeiyouren/alpine-nodejs-mongodb-tools:alpine3-node26
caomeiyouren/alpine-nodejs-mongodb-tools:2026-11-16
```
<!-- DOCKER_END -->

## 镜像基线

- 基础系统：**Alpine 3.23（musl 1.2.5）**，不使用 `alpine:latest`。
- 原因：Alpine ≥ 3.24（musl ≥ 1.2.6）把 `pwrite()` 改走 `pwritev2`，在 seccomp 过滤器未放行 `pwritev2` 的宿主上会被拦成 `EPERM` 且不会回退（典型是 libseccomp < 2.3.2 的 CentOS/RHEL 7，与 Docker 主版本基本无关），表现为 PHP session 丢失、SQLite `disk I/O error`、Node 写文件 `EPERM`。
- 门禁：构建期版本断言 + 推送前在 seccomp 夹具下真跑一次 `pwrite()` + CI 静态扫描，详见 [gate/README.md](gate/README.md)。

## 镜像标签

同一个镜像会发布多组 tag，按用途选择：

| tag 形态 | 示例 | 用途 |
|---|---|---|
| `{node}-alpine{alpine 主.次}` | `26.13.1-alpine3.23` | **下游自动跟版**：Dependabot 的 docker 生态可解析，Node 补丁/次要升级会自动开 PR；Alpine 固定在 3.23 |
| `alpine{alpine 完整}-node{node 完整}` | `alpine3.23.8-node26.13.1` | 精确、可复现；双版本 tag 里没有单独的版本号，Dependabot 无法解析，只能手工跟 |
| `alpine{alpine 主.次}-node{node 主.次}` | `alpine3.23-node26.13` | 可读的浮动 tag；Dependabot 无法解析 |
| `alpine{alpine 主}-node{node 主}` | `alpine3-node26` | 大版本浮动；Dependabot 无法解析 |
| `YYYY-MM-DD` | `2026-11-16` | 当日构建快照；不带版本语义，不作为下游部署基准 |
| `latest` | `latest` | 最新构建；Dependabot 无法解析 |

bun 镜像同规则，把 `node` 换成 `bun`，例如 `1.3.4-alpine3.23`。

Dependabot 只会更新「tag 中能提取出一个版本、且 prefix/suffix 一致」的镜像：

- 下游需要自动跟版时引用 `{node}-alpine{alpine 主.次}`。Alpine 小版本变化会改变 suffix，因此不会被自动带到 3.24，与 musl pwrite 门禁保持一致。
- 该别名是浮动 tag：Alpine 补丁更新时会重新指向同一个 tag（tag 名不变，Dependabot 不会为此开 PR，正常拉取即可拿到新 digest）。
- 需要逐个补丁可复现、审计时引用精确 tag。

## 🏠 主页

[https://github.com/CaoMeiYouRen/docker-builder#readme](https://github.com/CaoMeiYouRen/docker-builder#readme)


## 📦 依赖要求


- node >=16

## 🚀 安装

```sh
npm install
```

## 👨‍💻 使用

```sh
npm run start
```

## 🛠️ 开发

```sh
npm run dev
```

## 🔧 编译

```sh
npm run build
```

## 🔍 Lint

```sh
npm run lint
```

## 💾 Commit

```sh
npm run commit
```


## 👤 作者


**CaoMeiYouRen**

* Website: [https://blog.cmyr.ltd/](https://blog.cmyr.ltd/)

* GitHub: [@CaoMeiYouRen](https://github.com/CaoMeiYouRen)


## 🤝 贡献

欢迎 贡献、提问或提出新功能！<br />如有问题请查看 [issues page](https://github.com/CaoMeiYouRen/docker-builder/issues). <br/>贡献或提出新功能可以查看[contributing guide](https://github.com/CaoMeiYouRen/docker-builder/blob/master/CONTRIBUTING.md).

## 💰 支持

如果觉得这个项目有用的话请给一颗⭐️，非常感谢

## 📝 License

Copyright © 2024 [CaoMeiYouRen](https://github.com/CaoMeiYouRen).<br />
This project is [MIT](https://github.com/CaoMeiYouRen/docker-builder/blob/master/LICENSE) licensed.

***
_This README was generated with ❤️ by [cmyr-template-cli](https://github.com/CaoMeiYouRen/cmyr-template-cli)_
