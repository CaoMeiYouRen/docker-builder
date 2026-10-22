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

const baseImage = `${NODE_IMAGE}:${NODE_VERSION}-alpine`
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
    if (DRY_RUN) {
        console.log(JSON.stringify({ NODE_VERSION, ALPINE_FULL_VERSION, versions }, null, 2))
        exit(0)
    }
    const buildArgs = [
        '--build-arg', `NODE_VERSION=${NODE_VERSION}`,
        '--build-arg', `ALPINE_VERSION=${ALPINE_LATEST_VERSION}`,
        '--build-arg', `NODE_IMAGE=${NODE_IMAGE}`,
    ]
    const dockerTags = await buildAndPushDockerImages(versions, buildArgs)

    const meta = `<!-- DOCKER_META node=${NODE_VERSION} alpine=${ALPINE_FULL_VERSION} base=${baseDigest} -->`
    const text = `${meta}\n\`\`\`\n${dockerTags.join('\n')}\n\`\`\``
    const newReadme = readme.replace(/<!-- DOCKER_START -->([\s\S]*?)<!-- DOCKER_END -->/, `<!-- DOCKER_START -->\n${text}\n<!-- DOCKER_END -->`)
    await fs.writeFile(readmePath, newReadme)
    console.log('更新 Docker Tags 成功')
}
