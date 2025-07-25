#!/usr/bin/env zx
import path from 'path'
import { fileURLToPath } from 'node:url'
import { exit } from 'node:process'
import { $, cd, within } from 'zx'
import Parser from 'rss-parser'
import fs from 'fs-extra'
import semver from 'semver'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rssParser = new Parser()

const limit = parseInt(process.env.SYNC_LIMIT) || 5
// const filterTime = (parseInt(process.env.SYNC_FILTER_TIME) || 2) * 24 * 60 * 60

const DOCKER_USERNAME = process.env.DOCKER_USERNAME || ''

let hasUpdate = false

async function buildAndPushDockerImages(versions: string[]) {
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

async function getRss(url: string) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
            Accept: 'application/rss+xml, application/xml', // 明确接受 XML 格式
        },
    })

    const contentType = response.headers.get('Content-Type')
    if (!contentType?.includes('xml')) {
        console.error(`预期 XML 格式，实际返回 ${contentType} 格式`)
        throw new Error('非 XML 格式响应')
    }

    return response.text()
}

async function getTagsByRssHub(sourceRepo: string) {
    const search = new URLSearchParams({
        // filter_time: String(filterTime),
        limit: String(limit),
        filterout: '',
    })
    const url = new URL(`https://rsshub.cmyr.dev/dockerhub/tag/${sourceRepo}`)
    url.search = search.toString()
    const rssUrl = url.toString()

    try {
        const rssText = await getRss(rssUrl)
        const rssResp = await rssParser.parseString(rssText)
        if (rssResp.items?.[0]?.pubDate && dayjs().diff(rssResp.items?.[0]?.pubDate, 'days', true) < 14) { // 更新时间在 7 天内
            hasUpdate = true
        }
        // guid library/alpine:latest@b26f5cb75a088e449b9dbbbad546a106
        // tag latest
        const tags = rssResp.items.map((item) => item.guid?.split('@')?.[0]?.split(':')?.[1])
        return tags
    } catch (error) {
        console.error(`获取 ${sourceRepo} 的 RSS 标签失败:`, error)
        return []
    }
}

async function getPkgsVersion(name: string) {
    const search = new URLSearchParams({
        // filter_time: String(filterTime),
        limit: String(limit),
        filterout: '',
    })
    const url = new URL(`https://rsshub.cmyr.dev/alpinelinux/pkgs/${name}`)
    url.search = search.toString()
    const rssUrl = url.toString()

    try {
        const rssText = await getRss(rssUrl)
        const rssResp = await rssParser.parseString(rssText)
        if (rssResp.items?.[0]?.pubDate && dayjs().diff(rssResp.items?.[0]?.pubDate, 'days', true) < 14) { // 更新时间在 7 天内
            hasUpdate = true
        }
        // guid https://pkgs.alpinelinux.org/package/edge/main/ppc64le/nodejs#20.13.1-r0
        // version 20.13.1-r0
        const versions = rssResp.items.map((item) => item.guid?.split('#')?.[1])
        return versions
    } catch (error) {
        console.error(`获取 ${name} 的版本信息失败:`, error)
        return []
    }
}

const alpineTags = await getTagsByRssHub('library/alpine')

const alpineLatestVersion = semver.parse(alpineTags.filter((e) => semver.valid(e)).sort((a, b) => semver.rcompare(a, b)).at(0))

if (!alpineLatestVersion) {
    console.error('获取 Alpine 最新版本失败')
    exit(0)
}

const ALPINE_LATEST_VERSION = `${alpineLatestVersion.major}.${alpineLatestVersion.minor}`

await $`echo "ALPINE_LATEST_VERSION=${ALPINE_LATEST_VERSION}" >> "$GITHUB_ENV"`
await $`echo "ALPINE_MAJOR_VERSION=${alpineLatestVersion.major}" >> "$GITHUB_ENV"`

const nodejsVersions = await getPkgsVersion('nodejs')

const nodejsLatestVersion = semver.parse(nodejsVersions.filter((e) => semver.valid(e)).sort((a, b) => semver.rcompare(a, b)).at(0))

if (!nodejsLatestVersion) {
    console.error('获取 Node.js 最新版本失败')
    exit(0)
}

const NODEJS_LATEST_VERSION = `${nodejsLatestVersion.major}.${nodejsLatestVersion.minor}`

await $`echo "NODEJS_LATEST_VERSION=${NODEJS_LATEST_VERSION}" >> "$GITHUB_ENV"`
await $`echo "NODEJS_MAJOR_VERSION=${nodejsLatestVersion.major}" >> "$GITHUB_ENV"`

await $`echo "HAS_UPDATE=${hasUpdate}" >> "$GITHUB_ENV"`

if (hasUpdate) {
    const versions = ['latest', `alpine${ALPINE_LATEST_VERSION}-node${NODEJS_LATEST_VERSION}`, `alpine${alpineLatestVersion.major}-node${nodejsLatestVersion.major}`, dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')]
    const dockerTags = await buildAndPushDockerImages(versions)

    const text = `\`\`\`\n${dockerTags.join('\n')}\n\`\`\``
    const readme = await fs.readFile(path.join(__dirname, '../README.md'), 'utf-8')
    const newReadme = readme.replace(/<!-- DOCKER_START -->([\s\S]*?)<!-- DOCKER_END -->/, `<!-- DOCKER_START -->\n${text}\n<!-- DOCKER_END -->`)
    await fs.writeFile(path.join(__dirname, '../README.md'), newReadme)
    console.log('更新 Docker Tags 成功')
}
