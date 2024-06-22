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

const alpineLatestVersion = semver.parse(alpineTags.filter((e) => semver.valid(e)).sort((a, b) => semver.rcompare(a, b)).at(0))

const ALPINE_LATEST_VERSION = `${alpineLatestVersion.major}.${alpineLatestVersion.minor}`

await $`echo "ALPINE_LATEST_VERSION=${ALPINE_LATEST_VERSION}" >> "$GITHUB_ENV"`

