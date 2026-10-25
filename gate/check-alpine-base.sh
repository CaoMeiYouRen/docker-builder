#!/usr/bin/env bash
# =============================================================================
# check-alpine-base.sh — CI 静态检查：Dockerfile 里是否用了 Alpine >= 3.24
#
# 背景：Alpine 3.24 起 musl 1.2.6 的 pwrite() 改走 pwritev2，在「老内核 + 旧
#       libseccomp」（CentOS/RHEL 7 等）上会被 seccomp 拦成 EPERM，导致 PHP
#       session / SQLite / 各类写文件操作失败。它不报编译错误，只在运行期炸。
#
# 用法：
#   ./check-alpine-base.sh .                  # 扫当前目录（默认 warn，不失败）
#   ./check-alpine-base.sh --fail .           # 发现问题时 exit 1（CI 用）
#   ./check-alpine-base.sh --json Dockerfile web/Dockerfile
#
# 会先读取同一 Dockerfile 里 ARG 的默认值，把 FROM ${VAR} 解析成实际镜像再判定，
# 因此 `ARG ALPINE_VERSION=3.24` 这类间接写法同样能被拦下。
#
# 退出码：0 无阻断问题（或有但未开 --fail）/ 1 有 ERROR 且启用 --fail / 3 用法错误
# =============================================================================
set -uo pipefail

PROG=${0##*/}
FAIL=0
JSON=0
MAX_ALPINE=${MAX_ALPINE:-3.23}   # 认为安全的最高 Alpine 版本
PATHS=()
ERRORS=0
WARNS=0
INFOS=0

usage() {
	cat <<EOF
$PROG — 扫描 Dockerfile 中的 Alpine >= 3.24 基底（musl 1.2.6 / pwritev2 风险）

用法: $PROG [--fail] [--json] [路径...]
  --fail          存在 ERROR 时返回 1
  --json          输出 JSON
  路径            文件或目录（默认 .）；目录内匹配 Dockerfile*、*.Dockerfile、*.dockerfile
环境变量:
  MAX_ALPINE      视为安全的最高版本，默认 $MAX_ALPINE
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--fail) FAIL=1; shift ;;
		--json) JSON=1; shift ;;
		-h|--help) usage; exit 0 ;;
		-*) printf '%s: 未知参数 %s\n' "$PROG" "$1" >&2; usage >&2; exit 3 ;;
		*) PATHS+=("$1"); shift ;;
	esac
done
[ ${#PATHS[@]} -eq 0 ] && PATHS=(".")

ver_ge() {
	local min
	min=$(printf '%s\n%s\n' "$2" "$1" | sort -V 2>/dev/null | head -n1)
	[ "$min" = "$2" ]
}

collect_files() {
	local p
	for p in "$@"; do
		if [ -d "$p" ]; then
			find "$p" \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' -o -name '*.dockerfile' \) \
				-not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null
		elif [ -f "$p" ]; then
			printf '%s\n' "$p"
		fi
	done | sort -u
}

# 分类：输出 "<level>\t<reason>"
classify() {
	local img=$1 ref=$2 ver="" base
	base=${img%%:*}

	# FROM ${BASE_IMAGE}
	case "$img" in
		*'$'*) printf 'WARN\tbase image 由变量/ARG 决定且缺少默认值，无法静态判断（运行前请用 musl-pwrite-gate.sh --image 探测）'; return ;;
	esac

	# 显式版本：alpine:3.24 / alpine:3.25 / node:24-alpine3.24 / python:3.13-alpine3.24
	ver=$(printf '%s' "$img" | sed -nE 's/.*alpine[:.-]?(3\.[0-9]+).*/\1/p')
	if [ -z "$ver" ]; then
		ver=$(printf '%s' "$img" | sed -nE 's/^alpine:(3\.[0-9]+).*/\1/p')
	fi

	if [ -n "$ver" ]; then
		if ver_ge "$ver" "3.24"; then
			printf 'ERROR\tAlpine %s（musl 1.2.6）：pwrite 走 pwritev2，老内核 + 旧 libseccomp 上会被 seccomp 拦成 EPERM' "$ver"
		else
			printf 'INFO\tAlpine %s（musl <= 1.2.5）：pwrite 走 pwrite64，不受该问题影响' "$ver"
		fi
		return
	fi

	# 浮动 tag：alpine / alpine:latest / alpine:edge / node:24-alpine
	case "$img" in
		alpine|alpine:*|*-alpine|*-alpine:*)
			printf 'WARN\t浮动 tag（%s）：上游一旦切到 3.24+ 就会踩中，建议钉到 -alpine3.23 或改用 Debian 基底' "$img" ;;
		*) printf 'INFO\t非 Alpine 基底（%s）：pwrite 走 pwrite64，不受影响' "$img" ;;
	esac
}

FILES=$(collect_files "${PATHS[@]}")
if [ -z "$FILES" ]; then
	printf '%s: 未找到 Dockerfile\n' "$PROG" >&2
	exit 0
fi

RESULT=""
while IFS= read -r f; do
	[ -n "$f" ] || continue
	# 收集本 Dockerfile 内 ARG 的默认值，用于解析 FROM ${VAR}
	declare -A DF_ARGS=()
	while IFS= read -r argline; do
		argline=${argline%%#*}
		if [[ $argline =~ ^[[:space:]]*[Aa][Rr][Gg][[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=(.+)$ ]]; then
			argname=${BASH_REMATCH[1]}
			argvalue=${BASH_REMATCH[2]}
			argvalue=${argvalue%"${argvalue##*[![:space:]]}"}
			argvalue=${argvalue%\"}
			argvalue=${argvalue#\"}
			DF_ARGS[$argname]=$argvalue
		fi
	done <"$f"
	lineno=0
	while IFS= read -r line; do
		lineno=$((lineno + 1))
		# 归一化：去注释、转大写比较 FROM
		trim=$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]*#.*$//')
		case "$(printf '%s' "$trim" | tr '[:upper:]' '[:lower:]')" in
			from\ *) ;;
			*) continue ;;
		esac
		# 取镜像名（跳过 --platform=... 等 flag，忽略 AS alias）
		img=$(printf '%s' "$trim" | awk '{for(i=2;i<=NF;i++){if($i ~ /^--/){continue} print $i; break}}')
		[ -n "$img" ] || continue
		# 用 ARG 默认值替换 ${VAR} / $VAR，让间接写法也能被判定
		for argname in "${!DF_ARGS[@]}"; do
			img=${img//\$\{$argname\}/${DF_ARGS[$argname]}}
			img=${img//\$$argname/${DF_ARGS[$argname]}}
		done
		out=$(classify "$img" "")
		level=${out%%	*}
		reason=${out#*	}
		case "$level" in
			ERROR) ERRORS=$((ERRORS + 1)) ;;
			WARN)  WARNS=$((WARNS + 1)) ;;
			*)     INFOS=$((INFOS + 1)) ;;
		esac
		RESULT="${RESULT}${f}:${lineno}	${level}	${img}	${reason}
"
	done <"$f"
done <<EOF
$FILES
EOF

if [ "$JSON" -eq 1 ]; then
	printf '{\n\t"tool": "check-alpine-base",\n\t"max_safe_alpine": "%s",\n\t"errors": %d,\n\t"warnings": %d,\n\t"info": %d,\n\t"findings": [' \
		"$MAX_ALPINE" "$ERRORS" "$WARNS" "$INFOS"
	first=1
	printf '%s' "$RESULT" | while IFS='	' read -r loc level img reason; do
		[ -n "${loc:-}" ] || continue
		[ $first -eq 1 ] || printf ','
		first=0
		printf '\n\t\t{"location": "%s", "level": "%s", "image": "%s", "reason": "%s"}' \
			"$loc" "$level" "$img" "$(printf '%s' "$reason" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
	done
	printf '\n\t]\n}\n'
else
	printf '%s' "$RESULT" | while IFS='	' read -r loc level img reason; do
		[ -n "${loc:-}" ] || continue
		printf '%-24s %-5s %-28s %s\n' "$loc" "[$level]" "$img" "$reason"
	done
	printf '\n%s: ERROR %d / WARN %d / INFO %d（安全上限 Alpine %s）\n' "$PROG" "$ERRORS" "$WARNS" "$INFOS" "$MAX_ALPINE"
	if [ "$ERRORS" -gt 0 ]; then
		printf '%s\n' "提示：Alpine 3.24 镜像在 CentOS/RHEL 7（内核 3.10）等宿主上需要 seccomp=unconfined，或改用 Debian 基底。"
		printf '%s\n' "      运行期验证：./gate/musl-pwrite-gate.sh --image <ref>"
	fi
fi

if [ "$FAIL" -eq 1 ] && [ "$ERRORS" -gt 0 ]; then
	exit 1
fi
exit 0
