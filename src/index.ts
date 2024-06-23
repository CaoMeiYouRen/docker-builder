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
        // filter_time: String(filterTime),
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

async function getPkgsVersion(name: string) {
    const search = new URLSearchParams({
        // filter_time: String(filterTime),
        limit: String(limit),
        filterout: '',
    })
    const url = new URL(`https://rsshub.app/alpinelinux/pkgs/${name}`)
    url.search = search.toString()
    const rssUrl = url.toString()
    const rssResp = await rssParser.parseURL(rssUrl)
    // guid https://pkgs.alpinelinux.org/package/edge/main/ppc64le/nodejs#20.13.1-r0
    // version 20.13.1-r0
    const versions = rssResp.items.map((item) => item.guid?.split('#')?.[1])
    return versions
}

const alpineTags = await getTagsByRssHub('library/alpine')

const alpineLatestVersion = semver.parse(alpineTags.filter((e) => semver.valid(e)).sort((a, b) => semver.rcompare(a, b)).at(0))

const ALPINE_LATEST_VERSION = `${alpineLatestVersion.major}.${alpineLatestVersion.minor}`

await $`echo "ALPINE_LATEST_VERSION=${ALPINE_LATEST_VERSION}" >> "$GITHUB_ENV"`
await $`echo "ALPINE_MAJOR_VERSION=${alpineLatestVersion.major}" >> "$GITHUB_ENV"`

const nodejsVersions = await getPkgsVersion('nodejs')

const nodejsLatestVersion = semver.parse(nodejsVersions.filter((e) => semver.valid(e)).sort((a, b) => semver.rcompare(a, b)).at(0))

const NODEJS_LATEST_VERSION = `${nodejsLatestVersion.major}.${nodejsLatestVersion.minor}`

await $`echo "NODEJS_LATEST_VERSION=${NODEJS_LATEST_VERSION}" >> "$GITHUB_ENV"`
await $`echo "NODEJS_MAJOR_VERSION=${nodejsLatestVersion.major}" >> "$GITHUB_ENV"`
