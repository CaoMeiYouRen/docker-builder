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
<!-- DOCKER_META node=26.13.0 alpine=3.23.7 base=sha256:e6c03d42b46af3b1e98207e59f06a43cfe5efd3ec4b4d3d9802bddf04f833374 -->
```
caomeiyouren/alpine-bun:latest
caomeiyouren/alpine-bun:alpine3.23-node26.13
caomeiyouren/alpine-bun:alpine3-node26
caomeiyouren/alpine-bun:2026-11-02
caomeiyouren/alpine-nodejs:latest
caomeiyouren/alpine-nodejs:alpine3.23-node26.13
caomeiyouren/alpine-nodejs:alpine3-node26
caomeiyouren/alpine-nodejs:2026-11-02
caomeiyouren/alpine-nodejs-minimize:latest
caomeiyouren/alpine-nodejs-minimize:alpine3.23-node26.13
caomeiyouren/alpine-nodejs-minimize:alpine3-node26
caomeiyouren/alpine-nodejs-minimize:2026-11-02
caomeiyouren/alpine-nodejs-mongodb-tools:latest
caomeiyouren/alpine-nodejs-mongodb-tools:alpine3.23-node26.13
caomeiyouren/alpine-nodejs-mongodb-tools:alpine3-node26
caomeiyouren/alpine-nodejs-mongodb-tools:2026-11-02
```
<!-- DOCKER_END -->

## 镜像基线

- 基础系统：**Alpine 3.23（musl 1.2.5）**，不使用 `alpine:latest`。
- 原因：Alpine ≥ 3.24（musl ≥ 1.2.6）把 `pwrite()` 改走 `pwritev2`，在 CentOS/RHEL 7 等「内核 < 4.6 + libseccomp < 2.3.3」的宿主上会被 Docker seccomp 拦成 `EPERM` 且不会回退，表现为 PHP session 丢失、SQLite `disk I/O error`、Node 写文件 `EPERM`。
- 门禁：构建期版本断言 + 推送前在 seccomp 夹具下真跑一次 `pwrite()` + CI 静态扫描，详见 [gate/README.md](gate/README.md)。

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
