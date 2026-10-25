#!/usr/bin/env node
'use strict'

/**
 * 真实调用一次带 offset 的 write（Node 走 libc pwrite）。
 *
 * musl >= 1.2.6 的 pwrite() 先发 pwritev2；在老内核 + 旧 libseccomp 的宿主上会被
 * seccomp 拦成 EPERM，musl 不会回退 → 这里会抛 EPERM。
 *
 * 由 musl-pwrite-gate.sh 在 gate/seccomp/pwritev2-eperm.json 夹具下执行，
 * 因此在任何新内核的 CI runner 上都能复现老宿主的行为。
 *
 * 退出码：0 通过 / 1 失败
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const file = path.join(process.env.TMPDIR || os.tmpdir(), `.pwrite-gate-${process.pid}`)
let fd

try {
    fd = fs.openSync(file, 'w+')
    fs.writeSync(fd, Buffer.from('0123456789'))
    fs.writeSync(fd, Buffer.from('AB'), 0, 2, 2) // position = 2 → pwrite
    const buffer = Buffer.alloc(2)
    fs.readSync(fd, buffer, 0, 2, 2)
    if (buffer.toString() !== 'AB') {
        console.error('FAIL: pwrite 写入的数据读回不一致')
        process.exit(1)
    }
    console.log('PASS: pwrite 可用（带 offset 写入成功）')
} catch (error) {
    console.error(`FAIL: ${error.code || 'ERR'} ${error.message}`)
    process.exit(1)
} finally {
    try {
        if (fd !== undefined) {
            fs.closeSync(fd)
        }
    } catch {}
    try {
        fs.unlinkSync(file)
    } catch {}
}
