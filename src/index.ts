#!/usr/bin/env zx
import { $ } from 'zx'
import Parser from 'rss-parser'
import fs from 'fs-extra'
import semver from 'semver'

const rssParser = new Parser()

const limit = parseInt(process.env.SYNC_LIMIT) || 5
const filterTime = (parseInt(process.env.SYNC_FILTER_TIME) || 2) * 24 * 60 * 60

async function getTagsByRssHub(sourceRepo: string) {
    const search = new URLSearchParams({
        filter_time: String(filterTime),
        limit: String(limit),
        filterout: '',
    })
    const url = new URL(`https://rsshub.app/dockerhub/tag/${sourceRepo}`)
    url.search = search.toString()
    const rssUrl = url.toString()

    const rssResp = await rssParser.parseURL(rssUrl)
    // guid library/alpine:latest@b26f5cb75a088e449b9dbbbad546a106
    // tag latest
    const tags = rssResp.items.map((item) => item.guid?.split('@')?.[0]?.split(':')?.[1])

    return tags
}

const alpineTags = await getTagsByRssHub('library/alpine')

const alpineLatestVersion = alpineTags.filter((e) => semver.valid(e)).sort((a, b) => semver.rcompare(a, b)).at(0)

await $`echo "ALPINE_LATEST_VERSION=${alpineLatestVersion}" >> "$GITHUB_ENV"`

// // 创建新的构建器实例
// await $`docker buildx create --name mybuilder`

// // 切换到新的构建器实例
// await $`docker buildx use mybuilder`

// // 构建跨平台镜像
// await $`docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 -t myimage:tag .`

// // 推送跨平台镜像
// await $`docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 -t myimage:tag --push .`

// // 查看构建器信息
// await $`docker buildx inspect --bootstrap`

// await $`echo "{environment_variable_name}={value}" >> "$GITHUB_ENV"`
