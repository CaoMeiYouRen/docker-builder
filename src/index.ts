#!/usr/bin/env zx
import path from 'path'
import { fileURLToPath } from 'node:url'
import { exit } from 'node:process'
import { $, cd } from 'zx'
import fs from 'fs-extra'
import semver from 'semver'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DOCKER_USERNAME = process.env.DOCKER_USERNAME || ''
const DRY_RUN = process.env.DRY_RUN === 'true'
const NODE_IMAGE = process.env.NODE_IMAGE || 'public.ecr.aws/docker/library/node'
const NODE_INDEX_URL = process.env.NODE_INDEX_URL || 'https://nodejs.org/dist/index.json'
/**
 * Alpine 基底固定 3.23（musl 1.2.5）。
 *
 * Alpine >= 3.24（musl >= 1.2.6）把 pwrite() 改走 pwritev2，在「内核 < 4.6 + libseccomp < 2.3.3」
 * 的老宿主（CentOS/RHEL 7 等）上会被 Docker seccomp 拦成 EPERM，且 musl 不会回退，导致 PHP
 * session / SQLite / Node 带 offset 的写入全部失败。门禁与升级路径见 gate/README.md。
 */
const ALPINE_VERSION = process.env.ALPINE_VERSION || '3.23'

let hasUpdate = false

async function buildAndPushDockerImages(versions: string[], buildArgs: string[]) {
    const rootDir = path.join(__dirname, '../docker')
    const projects = await fs.readdir(rootDir)
    const dockerTags: string[] = []
    const platform = process.env.DOCKER_PLATFORM || 'linux/amd64,linux/arm64'
    for await (const project of projects) {
        const fullDir = path.join(rootDir, project)
        const imageName = project
        cd(fullDir)
        const flags = [
            'buildx',
            'build',
            '--push',
            '--platform',
            platform,
            ...buildArgs,
            ...versions.map((version) => ['-t', `${DOCKER_USERNAME}/${imageName}:${version}`]),
            '.',
        ].flat()
        await $`docker ${flags}`
        versions.forEach((version) => {
            dockerTags.push(`${DOCKER_USERNAME}/${imageName}:${version}`)
        })
        cd('..')
    }

    return dockerTags
}

interface NodeRelease {
    version: string
    lts: string | false
}

async function getLatestLtsNodeRelease() {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(NODE_INDEX_URL, { signal: AbortSignal.timeout(30_000) })
            if (!response.ok) {
                throw new Error(`获取 Node.js 版本索引失败: ${response.status}`)
            }
            const releases = await response.json() as NodeRelease[]
            const latest = releases
                .filter((release) => release.lts !== false && Boolean(semver.valid(release.version)))
                .sort((left, right) => semver.rcompare(left.version, right.version))
                .at(0)
            if (!latest) {
                throw new Error('获取 Node.js 最新 LTS 版本失败')
            }
            return latest
        } catch (error) {
            lastError = error
            console.warn(`获取 Node.js 版本索引失败（第 ${attempt} 次）:`, error)
        }
    }
    throw lastError instanceof Error ? lastError : new Error('获取 Node.js 最新 LTS 版本失败')
}

async function writeGithubEnv(values: Record<string, string | number | boolean>) {
    const githubEnv = process.env.GITHUB_ENV
    if (!githubEnv) {
        return
    }
    const content = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')
    await fs.appendFile(githubEnv, `${content}\n`)
}

const nodeRelease = await getLatestLtsNodeRelease()

const NODE_VERSION = nodeRelease.version.replace(/^v/, '')

const nodejsLatestVersion = semver.parse(NODE_VERSION)

if (!nodejsLatestVersion) {
    console.error('解析 Node.js 最新 LTS 版本失败')
    exit(1)
}

const NODEJS_LATEST_VERSION = `${nodejsLatestVersion.major}.${nodejsLatestVersion.minor}`

const baseImage = `${NODE_IMAGE}:${NODE_VERSION}-alpine${ALPINE_VERSION}`
// bun 镜像直接用 alpine 基底，同样受 musl pwrite() 行为影响（用户可能继续 apk add 其它程序）
const alpineBaseImage = `alpine:${ALPINE_VERSION}`

/**
 * 基础镜像不存在时给出可执行的下一步，而不是让 docker build 抛一句 manifest unknown。
 * 最常见的触发场景：上游还没为新的 Node.js 版本发布 `-alpine3.23` 变体。
 */
async function assertBaseImageExists(image: string) {
    const { exitCode } = await $`docker manifest inspect ${image}`.nothrow()
    if (exitCode === 0) {
        return
    }
    console.error([
        `无法读取基础镜像：${image}`,
        '通常意味着上游尚未为该 Node.js 版本发布 Alpine 3.23 变体（也可能是镜像仓库临时不可用）。可选处理：',
        '  1. 等待上游补齐 tag 后重跑（Alpine 3.23 支持到 2027-11）',
        '  2. linux/amd64：改用 nodejs.org 的官方 musl 二进制（node-vX-linux-x64-musl.tar.xz）',
        '  3. 其它架构：在 Alpine 3.23 上从源码编译 Node.js',
        '  4. 退回 Alpine 3.24+：需自行承担老宿主 EPERM 风险，并按 gate/README.md 提供运行期自检',
    ].join('\n'))
    exit(1)
}

/**
 * 发布前门禁：在只把 pwritev2 变成 EPERM 的 seccomp 夹具下真跑一次 pwrite()，
 * 等价于在 CentOS 7（内核 3.10 + libseccomp 2.3.1）上验证，因此托管 runner 也能拦住回归。
 */
async function runMuslPwriteGate(images: string[]) {
    const gateScript = path.join(__dirname, '../gate/musl-pwrite-gate.sh')
    for (const image of images) {
        // stdio: inherit 让门禁输出按真实顺序进入 CI 日志
        const { exitCode } = await $({ stdio: 'inherit' })`bash ${gateScript} --image ${image}`.nothrow()
        if (exitCode !== 0) {
            console.error(`musl-pwrite 门禁未通过：${image}。镜像未构建、未推送。详见 gate/README.md`)
            exit(1)
        }
    }
}

await assertBaseImageExists(baseImage)
const baseDigest = (await $`docker buildx imagetools inspect ${baseImage} --format '{{.Manifest.Digest}}'`).stdout.trim()

if (!baseDigest) {
    console.error(`获取基础镜像 digest 失败: ${baseImage}`)
    exit(1)
}

const alpineRelease = (await $`docker run --rm --entrypoint cat ${baseImage} /etc/alpine-release`).stdout.trim()
const alpineLatestVersion = semver.parse(alpineRelease)

if (!alpineLatestVersion) {
    console.error(`解析 Alpine 版本失败: ${alpineRelease}`)
    exit(1)
}

const ALPINE_LATEST_VERSION = `${alpineLatestVersion.major}.${alpineLatestVersion.minor}`
const ALPINE_FULL_VERSION = alpineLatestVersion.version

const readmePath = path.join(__dirname, '../README.md')
const readme = await fs.readFile(readmePath, 'utf-8')
const metaMatch = readme.match(/<!-- DOCKER_META node=(\S+) alpine=(\S+) base=(\S+) -->/)
const hasVersionUpdate = !metaMatch || metaMatch[1] !== NODE_VERSION || metaMatch[2] !== ALPINE_FULL_VERSION || metaMatch[3] !== baseDigest

hasUpdate = hasVersionUpdate

await writeGithubEnv({
    ALPINE_LATEST_VERSION,
    ALPINE_MAJOR_VERSION: alpineLatestVersion.major,
    NODE_VERSION,
    NODEJS_LATEST_VERSION,
    NODEJS_MAJOR_VERSION: nodejsLatestVersion.major,
    HAS_UPDATE: hasUpdate,
})

if (hasUpdate) {
    const versions = ['latest', `alpine${ALPINE_LATEST_VERSION}-node${NODEJS_LATEST_VERSION}`, `alpine${alpineLatestVersion.major}-node${nodejsLatestVersion.major}`, dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')]
    await runMuslPwriteGate([baseImage, alpineBaseImage])
    if (DRY_RUN) {
        console.log(JSON.stringify({ NODE_VERSION, ALPINE_FULL_VERSION, versions }, null, 2))
        exit(0)
    }
    const buildArgs = [
        '--build-arg', `NODE_VERSION=${NODE_VERSION}`,
        '--build-arg', `ALPINE_VERSION=${ALPINE_VERSION}`,
        '--build-arg', `NODE_IMAGE=${NODE_IMAGE}`,
    ]
    const dockerTags = await buildAndPushDockerImages(versions, buildArgs)

    const meta = `<!-- DOCKER_META node=${NODE_VERSION} alpine=${ALPINE_FULL_VERSION} base=${baseDigest} -->`
    const text = `${meta}\n\`\`\`\n${dockerTags.join('\n')}\n\`\`\``
    const newReadme = readme.replace(/<!-- DOCKER_START -->([\s\S]*?)<!-- DOCKER_END -->/, `<!-- DOCKER_START -->\n${text}\n<!-- DOCKER_END -->`)
    await fs.writeFile(readmePath, newReadme)
    console.log('更新 Docker Tags 成功')
}
