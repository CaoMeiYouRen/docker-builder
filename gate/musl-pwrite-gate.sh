#!/usr/bin/env bash
# =============================================================================
# musl-pwrite-gate.sh — 发布前门禁：镜像的 Alpine/musl 版本 + 真实 pwrite() 探测
#
# 背景：Alpine >= 3.24（musl >= 1.2.6）把 pwrite() 改走 pwritev2。在「内核 < 4.6 +
#       libseccomp < 2.3.3」（CentOS/RHEL 7 等）的宿主上，Docker 的 seccomp 白名单
#       不认识这个系统调用 → 直接返回 EPERM（而不是 ENOSYS），musl 不会回退到
#       pwrite64，于是所有带 offset 的写入都失败。
#       典型症状：PHP session 丢失、SQLite `disk I/O error`、Node `EPERM`。
#
# 判定方式：不猜宿主内核，直接在 seccomp 夹具（seccomp/pwritev2-eperm.json）下跑一次
#          真实 pwrite()。夹具只把 pwritev2 变成 EPERM，等价于老宿主，因此在任何
#          新内核的 CI runner 上都能复现。
#
# 用法：
#   ./gate/musl-pwrite-gate.sh --image node:24-alpine3.23 --image alpine:3.23
#   ./gate/musl-pwrite-gate.sh --image caomeiyouren/alpine-nodejs:latest
#   ./gate/musl-pwrite-gate.sh --image myimage --no-probe      # 只校验版本
#
# 退出码：0 通过 / 1 命中问题 / 2 无法完成检查（镜像或 docker 不可用）
# =============================================================================
set -uo pipefail

DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SECCOMP_PROFILE="$DIR/seccomp/pwritev2-eperm.json"
PROBE_SCRIPT="$DIR/pwrite-probe.cjs"
MAX_ALPINE="${MAX_ALPINE:-3.23}"
MAX_MUSL="${MAX_MUSL:-1.2.5}"
IMAGES=()
DO_PROBE=1
QUIET=0
FAILURES=0
ERRORS=0

usage() {
	cat <<EOF
musl-pwrite-gate.sh — 校验镜像不会踩 musl pwritev2 / seccomp EPERM

用法: ./gate/musl-pwrite-gate.sh --image <ref> [--image <ref>...] [选项]
  --image <ref>      要校验的镜像，可重复
  --no-probe         只校验 Alpine / musl 版本，不跑 pwrite() 探测
  --quiet            只输出结论行
环境变量:
  MAX_ALPINE         允许的最高 Alpine 版本，默认 $MAX_ALPINE
  MAX_MUSL           允许的最高 musl 版本，默认 $MAX_MUSL
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--image) [ $# -ge 2 ] || { usage >&2; exit 3; }; IMAGES+=("$2"); shift 2 ;;
		--no-probe) DO_PROBE=0; shift ;;
		--quiet) QUIET=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) printf 'musl-pwrite-gate: 未知参数 %s\n' "$1" >&2; usage >&2; exit 3 ;;
	esac
done

if [ ${#IMAGES[@]} -eq 0 ]; then
	usage >&2
	exit 3
fi

log() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

# ver_gt A B → A > B 时返回 0
ver_gt() {
	awk -v a="$1" -v b="$2" 'BEGIN {
		n = split(a, x, "."); split(b, y, ".")
		for (i = 1; i <= 4; i++) {
			if (x[i] + 0 > y[i] + 0) exit 0
			if (x[i] + 0 < y[i] + 0) exit 1
		}
		exit 1
	}'
}

# 镜像仓库限流（如 ECR public 429）时重试拉取
pull_image() {
	local img=$1 attempt=0 delay
	for delay in 5 20 45; do
		if docker pull -q "$img" >/dev/null 2>&1; then
			return 0
		fi
		attempt=$((attempt + 1))
		printf '  [WARN] 拉取 %s 失败（第 %d 次，可能被仓库限流），%ds 后重试\n' "$img" "$attempt" "$delay" >&2
		sleep "$delay"
	done
	docker pull -q "$img" >/dev/null 2>&1
}

check_image() {
	local img=$1 info alpine musl probe_result

	if ! docker image inspect "$img" >/dev/null 2>&1; then
		if ! pull_image "$img"; then
			printf '  [ERROR] 无法拉取镜像 %s\n' "$img" >&2
			return 2
		fi
	fi

	info=$(docker run --rm --entrypoint sh "$img" -c '
		cat /etc/alpine-release 2>/dev/null
		for f in /lib/ld-musl-*.so.1; do
			if [ -e "$f" ]; then "$f" --version 2>&1; fi
		done
		exit 0
	' 2>/dev/null) || {
		printf '  [ERROR] 无法在 %s 内执行 sh，无法判定\n' "$img" >&2
		return 2
	}

	alpine=$(printf '%s\n' "$info" | head -n1)
	musl=$(printf '%s\n' "$info" | sed -n 's/^Version //p' | head -n1)

	# 非 musl 镜像：pwrite 走 pwrite64，不受影响
	if [ -z "$musl" ]; then
		log "  [PASS] ${img} 非 musl 镜像（glibc），不受 pwritev2 影响"
		return 0
	fi

	# Alpine 只比较 major.minor（3.23.7 < 3.24）
	alpine_mm=$(printf '%s' "$alpine" | cut -d. -f1-2)
	if [ -n "$alpine_mm" ] && ver_gt "$alpine_mm" "$MAX_ALPINE"; then
		printf '  [FAIL] %s Alpine %s > %s：musl 的 pwrite 走 pwritev2，老宿主会被 seccomp 拦成 EPERM\n' "$img" "$alpine" "$MAX_ALPINE" >&2
		return 1
	fi

	if ver_gt "$musl" "$MAX_MUSL"; then
		printf '  [FAIL] %s musl %s > %s：pwrite 走 pwritev2，老宿主会被 seccomp 拦成 EPERM\n' "$img" "$musl" "$MAX_MUSL" >&2
		return 1
	fi

	log "  [ OK ] ${img} Alpine ${alpine:-unknown} / musl ${musl}"

	if [ "$DO_PROBE" -eq 0 ]; then
		return 0
	fi

	if ! docker run --rm --entrypoint sh "$img" -c 'command -v node >/dev/null 2>&1' >/dev/null 2>&1; then
		log "  [SKIP] ${img} 内没有 node，跳过 pwrite 探测（版本已通过）"
		return 0
	fi

	probe_result=$(docker run --rm \
		--security-opt "seccomp=$SECCOMP_PROFILE" \
		-v "$PROBE_SCRIPT:/pwrite-probe.cjs:ro" \
		--entrypoint node "$img" /pwrite-probe.cjs 2>&1)
	if [ $? -ne 0 ]; then
		printf '  [FAIL] %s pwrite 探测失败（模拟内核对 pwritev2 返回 EPERM）：\n%s\n' "$img" "$probe_result" >&2
		return 1
	fi

	log "  [ OK ] ${img} pwrite 探测通过（seccomp 夹具模拟老宿主）"
	return 0
}

log "musl-pwrite-gate: 校验 ${#IMAGES[@]} 个镜像（上限 Alpine $MAX_ALPINE / musl $MAX_MUSL）"
for img in "${IMAGES[@]}"; do
	check_image "$img"
	case $? in
		0) ;;
		1) FAILURES=$((FAILURES + 1)) ;;
		*) ERRORS=$((ERRORS + 1)) ;;
	esac
done

if [ "$FAILURES" -gt 0 ] || [ "$ERRORS" -gt 0 ]; then
	printf 'musl-pwrite-gate: 未通过（不兼容 %d / 无法判定 %d）\n' "$FAILURES" "$ERRORS" >&2
	printf '  说明：Alpine >= 3.24（musl >= 1.2.6）的镜像在 CentOS/RHEL 7 等老宿主上会写失败。\n' >&2
	printf '        请改用 Alpine 3.23 基底，或参考 gate/README.md 的替代方案。\n' >&2
	[ "$ERRORS" -gt 0 ] && exit 2
	exit 1
fi

log 'musl-pwrite-gate: 通过'
exit 0
