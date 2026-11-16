#!/usr/bin/env zx
import path from 'path'
import { fileURLToPath } from 'node:url'
import { exit } from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
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
const NODE_IMAGE = process.env.NODE_IMAGE || 'docker.io/library/node'
const NODE_INDEX_URL = process.env.NODE_INDEX_URL || 'https://nodejs.org/dist/index.json'
const BUN_RELEASE_URL = process.env.BUN_RELEASE_URL || 'https://api.github.com/repos/oven-sh/bun/releases/latest'
const BUN_NPM_URL = process.env.BUN_NPM_URL || 'https://registry.npmjs.org/bun/latest'
/** bun 镜像名：tag 用 bun 自己的版本，而不是 Node.js 版本 */
const BUN_IMAGE_NAME = 'alpine-bun'
/**
 * Alpine 基底固定 3.23（musl 1.2.5）。
 *
 * Alpine >= 3.24（musl >= 1.2.6）把 pwrite() 改走 pwritev2，在 seccomp 过滤器未放行 pwritev2
 * 的宿主上会被拦成 EPERM，且 musl 不会回退（典型是 libseccomp < 2.3.2 的 CentOS/RHEL 7），
 * 导致 PHP session / SQLite / Node 带 offset 的写入全部失败。与 Docker 主版本基本无关，
 * 门禁与升级路径见 gate/README.md。
 */
const ALPINE_VERSION = process.env.ALPINE_VERSION || '3.23'

let hasUpdate = false

async function buildAndPushDockerImages(resolveVersions: (project: string) => string[], buildArgs: string[]) {
    const rootDir = path.join(__dirname, '../docker')
    const projects = await fs.readdir(rootDir)
    const dockerTags: string[] = []
    const platform = process.env.DOCKER_PLATFORM || 'linux/amd64,linux/arm64'
    for await (const project of projects) {
        const fullDir = path.join(rootDir, project)
        const imageName = project
        const versions = resolveVersions(project)
        const projectBuildArgs = imageName === BUN_IMAGE_NAME ? [...buildArgs, '--build-arg', `BUN_VERSION=${BUN_VERSION}`] : buildArgs
        cd(fullDir)
        const flags = [
            'buildx',
            'build',
            '--push',
            '--platform',
            platform,
            ...projectBuildArgs,
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

interface BunRelease {
    tag_name?: string
}

interface NpmPackageInfo {
    version?: string
}

async function fetchJson<T>(url: string, label: string) {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(url, {
                headers: { accept: 'application/json', 'user-agent': 'docker-builder' },
                signal: AbortSignal.timeout(30_000),
            })
            if (!response.ok) {
                throw new Error(`${label}失败: ${response.status}`)
            }
            return await response.json() as T
        } catch (error) {
            lastError = error
            console.warn(`${label}失败（第 ${attempt} 次）:`, error)
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`${label}失败`)
}

async function getLatestLtsNodeRelease() {
    const releases = await fetchJson<NodeRelease[]>(NODE_INDEX_URL, '获取 Node.js 版本索引')
    const latest = releases
        .filter((release) => release.lts !== false && Boolean(semver.valid(release.version)))
        .sort((left, right) => semver.rcompare(left.version, right.version))
        .at(0)
    if (!latest) {
        throw new Error('获取 Node.js 最新 LTS 版本失败')
    }
    return latest
}

/**
 * bun 镜像 tag 使用 bun 自己的版本：优先 GitHub Release（权威来源），
 * 共享 runner 被限流时回退到 npm registry（bun 包版本与发布版本一致）。
 */
async function getLatestBunVersion() {
    try {
        const release = await fetchJson<BunRelease>(BUN_RELEASE_URL, '获取 Bun 版本')
        const version = release.tag_name?.replace(/^(bun-)?v/, '')
        if (version && semver.valid(version)) {
            return version
        }
        throw new Error(`解析 Bun 版本失败: ${release.tag_name}`)
    } catch (error) {
        console.warn('获取 Bun 版本失败，回退到 npm registry:', error)
    }
    const pkg = await fetchJson<NpmPackageInfo>(BUN_NPM_URL, '获取 Bun 版本（npm registry）')
    if (!pkg.version || !semver.valid(pkg.version)) {
        throw new Error(`解析 Bun 版本失败: ${pkg.version}`)
    }
    return pkg.version
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

const BUN_VERSION = process.env.BUN_VERSION?.replace(/^v/, '') || await getLatestBunVersion()

const bunLatestVersion = semver.parse(BUN_VERSION)

if (!bunLatestVersion) {
    console.error(`解析 Bun 版本失败: ${BUN_VERSION}`)
    exit(1)
}

const BUN_LATEST_VERSION = `${bunLatestVersion.major}.${bunLatestVersion.minor}`

const baseImage = `${NODE_IMAGE}:${NODE_VERSION}-alpine${ALPINE_VERSION}`
// bun 镜像直接用 alpine 基底，同样受 musl pwrite() 行为影响（用户可能继续 apk add 其它程序）
const alpineBaseImage = `alpine:${ALPINE_VERSION}`

/** 镜像仓库限流 / 网络抖动：可以重试 */
const REGISTRY_TRANSIENT_ERROR = /toomanyrequests|rate exceeded|\b429\b|timeout|timed out|tls handshake|connection reset|broken pipe|\b(502|503|504)\b/i
/** tag 不存在：重试没有意义，直接给出 fallback 指引 */
const IMAGE_NOT_FOUND_ERROR = /manifest unknown|not found|no such manifest|name unknown/i
const REGISTRY_RETRY_DELAYS = [5_000, 20_000, 45_000]

interface CommandResult {
    exitCode: number | null
    stdout: string
    stderr: string
}

/**
 * 镜像仓库操作重试：ECR public / Docker Hub 对共享 runner 的 IP 会返回 429，
 * 一次限流不应该让整次发布失败；tag 真的不存在时则立即失败。
 */
async function runWithRegistryRetry(label: string, run: () => Promise<CommandResult>): Promise<CommandResult> {
    let result = await run()
    for (const [index, delay] of REGISTRY_RETRY_DELAYS.entries()) {
        if (result.exitCode === 0) {
            return result
        }
        const output = `${result.stdout}\n${result.stderr}`.trim()
        if (IMAGE_NOT_FOUND_ERROR.test(output) || !REGISTRY_TRANSIENT_ERROR.test(output)) {
            return result
        }
        console.warn(`${label} 失败（第 ${index + 1} 次，镜像仓库限流或网络异常），${delay / 1000}s 后重试`)
        await sleep(delay)
        result = await run()
    }
    return result
}

/**
 * 基础镜像不存在时给出可执行的下一步，而不是让 docker build 抛一句 manifest unknown。
 * 最常见的触发场景：上游还没为新的 Node.js 版本发布 `-alpine3.23` 变体。
 */
function printMissingImageHint(image: string) {
    console.error([
        `基础镜像不存在：${image}`,
        '说明上游尚未为该 Node.js 版本发布 Alpine 3.23 变体。可选处理：',
        '  1. 等待上游补齐 tag 后重跑（Alpine 3.23 支持到 2027-11）',
        '  2. linux/amd64：改用 nodejs.org 的官方 musl 二进制（node-vX-linux-x64-musl.tar.xz）',
        '  3. 其它架构：在 Alpine 3.23 上从源码编译 Node.js',
        '  4. 退回 Alpine 3.24+：需自行承担老宿主 EPERM 风险，并按 gate/README.md 提供运行期自检',
    ].join('\n'))
}

async function getBaseImageDigest(image: string) {
    const result = await runWithRegistryRetry('读取基础镜像 digest', () => $`docker buildx imagetools inspect ${image} --format '{{.Manifest.Digest}}'`.nothrow())
    const digest = result.stdout.trim()
    if (result.exitCode === 0 && digest) {
        return digest
    }
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (IMAGE_NOT_FOUND_ERROR.test(output)) {
        printMissingImageHint(image)
    } else {
        console.error(`读取基础镜像 digest 失败：${image}\n${output}`)
    }
    exit(1)
}

async function readAlpineRelease(image: string) {
    const result = await runWithRegistryRetry('读取 Alpine 版本', () => $`docker run --rm --entrypoint cat ${image} /etc/alpine-release`.nothrow())
    if (result.exitCode !== 0) {
        const output = `${result.stdout}\n${result.stderr}`.trim()
        console.error(`读取 Alpine 版本失败：${image}\n${output}\n（镜像仓库限流或网络异常，稍后重跑即可）`)
        exit(1)
    }
    return result.stdout.trim()
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

const baseDigest = await getBaseImageDigest(baseImage)
const alpineRelease = await readAlpineRelease(baseImage)
const alpineLatestVersion = semver.parse(alpineRelease)

if (!alpineLatestVersion) {
    console.error(`解析 Alpine 版本失败: ${alpineRelease}`)
    exit(1)
}

const ALPINE_LATEST_VERSION = `${alpineLatestVersion.major}.${alpineLatestVersion.minor}`
const ALPINE_FULL_VERSION = alpineLatestVersion.version

// bun 镜像直接 FROM alpine:${ALPINE_VERSION}，与 Node 镜像的 alpine 补丁号可能不同步，
// 精确 tag 必须反映 bun 基底的真实版本
const bunAlpineRelease = await readAlpineRelease(alpineBaseImage)
const bunAlpineLatestVersion = semver.parse(bunAlpineRelease)

if (!bunAlpineLatestVersion) {
    console.error(`解析 Alpine 版本失败: ${bunAlpineRelease}`)
    exit(1)
}

const BUN_ALPINE_LATEST_VERSION = `${bunAlpineLatestVersion.major}.${bunAlpineLatestVersion.minor}`
const BUN_ALPINE_FULL_VERSION = bunAlpineLatestVersion.version

const buildDate = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')

/**
 * tag 方案版本：调整下面 nodeImageVersions / bunImageVersions 的 tag 集合时 +1，
 * 让下一次定时任务即使上游版本没变也会重建并刷新 README（hasUpdate 默认为 false）。
 */
const TAG_SCHEME_VERSION = 2

const nodeImageVersions = [
    'latest',
    // Dependabot 可解析的别名（版本在前、Alpine 只锁主.次）：Node 补丁/次要升级能自动开 PR
    `${NODE_VERSION}-alpine${ALPINE_LATEST_VERSION}`,
    `alpine${ALPINE_FULL_VERSION}-node${NODE_VERSION}`,
    `alpine${ALPINE_LATEST_VERSION}-node${NODEJS_LATEST_VERSION}`,
    `alpine${alpineLatestVersion.major}-node${nodejsLatestVersion.major}`,
    buildDate,
]

const bunImageVersions = [
    'latest',
    // 同上：bun 版本在前，Alpine 只锁主.次
    `${BUN_VERSION}-alpine${BUN_ALPINE_LATEST_VERSION}`,
    `alpine${BUN_ALPINE_FULL_VERSION}-bun${BUN_VERSION}`,
    `alpine${BUN_ALPINE_LATEST_VERSION}-bun${BUN_LATEST_VERSION}`,
    `alpine${bunAlpineLatestVersion.major}-bun${bunLatestVersion.major}`,
    buildDate,
]

const readmePath = path.join(__dirname, '../README.md')
const readme = await fs.readFile(readmePath, 'utf-8')
const metaMatch = readme.match(/<!-- DOCKER_META node=(\S+) alpine=(\S+) bunalpine=(\S+) base=(\S+) bun=(\S+) tags=(\d+) -->/)
const hasVersionUpdate = !metaMatch || metaMatch[1] !== NODE_VERSION || metaMatch[2] !== ALPINE_FULL_VERSION || metaMatch[3] !== BUN_ALPINE_FULL_VERSION || metaMatch[4] !== baseDigest || metaMatch[5] !== BUN_VERSION || metaMatch[6] !== String(TAG_SCHEME_VERSION)

hasUpdate = hasVersionUpdate

await writeGithubEnv({
    ALPINE_LATEST_VERSION,
    ALPINE_MAJOR_VERSION: alpineLatestVersion.major,
    NODE_VERSION,
    NODEJS_LATEST_VERSION,
    NODEJS_MAJOR_VERSION: nodejsLatestVersion.major,
    BUN_VERSION,
    HAS_UPDATE: hasUpdate,
})

if (hasUpdate) {
    const versionsByProject = (project: string) => (project === BUN_IMAGE_NAME ? bunImageVersions : nodeImageVersions)
    await runMuslPwriteGate([baseImage, alpineBaseImage])
    if (DRY_RUN) {
        console.log(JSON.stringify({
            NODE_VERSION,
            ALPINE_FULL_VERSION,
            BUN_VERSION,
            BUN_ALPINE_FULL_VERSION,
            tags: Object.fromEntries((await fs.readdir(path.join(__dirname, '../docker'))).map((project) => [project, versionsByProject(project)])),
        }, null, 2))
        exit(0)
    }
    const buildArgs = [
        '--build-arg', `NODE_VERSION=${NODE_VERSION}`,
        '--build-arg', `ALPINE_VERSION=${ALPINE_VERSION}`,
        '--build-arg', `NODE_IMAGE=${NODE_IMAGE}`,
    ]
    const dockerTags = await buildAndPushDockerImages(versionsByProject, buildArgs)

    const meta = `<!-- DOCKER_META node=${NODE_VERSION} alpine=${ALPINE_FULL_VERSION} bunalpine=${BUN_ALPINE_FULL_VERSION} base=${baseDigest} bun=${BUN_VERSION} tags=${TAG_SCHEME_VERSION} -->`
    const text = `${meta}\n\`\`\`\n${dockerTags.join('\n')}\n\`\`\``
    const newReadme = readme.replace(/<!-- DOCKER_START -->([\s\S]*?)<!-- DOCKER_END -->/, `<!-- DOCKER_START -->\n${text}\n<!-- DOCKER_END -->`)
    await fs.writeFile(readmePath, newReadme)
    console.log('更新 Docker Tags 成功')
}
