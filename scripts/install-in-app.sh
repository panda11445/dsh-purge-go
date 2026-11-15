#!/bin/sh
# dsh-purge 在 App 内安装 / 更新（不经过模型）
#
# 用法（dsh-Go 的「终端」里）：
#   sh /sdcard/Download/install-in-app.sh                 # 装「下载」里最新的包
#   sh /sdcard/Download/install-in-app.sh --latest        # 从 GitHub Release 查最新版并安装
#   sh /sdcard/Download/install-in-app.sh --check         # 只体检，不改动
#   sh /sdcard/Download/install-in-app.sh --reinstall     # 同版本也强制重装
#   sh /sdcard/Download/install-in-app.sh --uninstall     # 卸载
#   sh /sdcard/Download/install-in-app.sh <url|tgz>       # 指定 URL 或本地包
#   追加 --verbose 实时显示 pnpm 原始输出；--plain 关闭颜色与动画
#   --detach 安装放到后台跑（应用引擎重载、终端断开也不会中断）
#   --base URL 自建镜像目录（<URL>/latest.txt + <URL>/panda11445go-dsh-purge-<ver>.tgz）
#   --gh owner/repo[@tag]  用 GitHub + 国内加速镜像（ghfast/ghproxy/gh-proxy/jsDelivr 自动回退）
#   --mirror 只用远端（--base / GitHub）：取不到就报错，不回退本地包
#   --keep   装完保留安装包（默认装完删除）
#   环境变量 DSH_PURGE_TARBALL_BASE 可指向自建镜像目录（放 panda11445go-dsh-purge-<ver>.tgz）
#
# 这是 DSH 自己的插件链路（dsh plugin add → pnpm），不经过任何模型。
# 装完到「设置 › 本机引擎」重启引擎。
set -u

PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
DL_DIR="${DSH_PURGE_DL:-/sdcard/Download}"
PKG_NAME="@panda11445go/dsh-purge"
PKG_SLUG="panda11445go-dsh-purge"
TOTAL=6

MODE="install"
SPEC=""
VERBOSE=0
PLAIN=0
DETACH=0
BG=0
MIRROR_ONLY=0
KEEP=0
REINSTALL=0
GH_REPO=""
GH_TAG=""
PRINT_SOURCES=0
BASE_URL="${DSH_PURGE_TARBALL_BASE:-}"
NEXT=""
for arg in "$@"; do
  if [ "$NEXT" = "base" ]; then BASE_URL="$arg"; NEXT=""; continue; fi
  if [ "$NEXT" = "gh" ]; then
    GH_REPO="${arg%%@*}"
    case "$arg" in *@*) GH_TAG="${arg#*@}" ;; esac
    NEXT=""
    continue
  fi
  case "$arg" in
    --check) MODE="check" ;;
    --reinstall) REINSTALL=1 ;;
    --uninstall) MODE="uninstall" ;;
    --latest) MODE="latest" ;;
    --verbose|-v) VERBOSE=1 ;;
    --detach) DETACH=1 ;;
    --bg) BG=1 ;;
    --mirror) MIRROR_ONLY=1 ;;
    --keep) KEEP=1 ;;
    --plain) PLAIN=1 ;;
    --base) NEXT="base" ;;
    --gh) NEXT="gh" ;;
    --print-sources) PRINT_SOURCES=1 ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "未知参数：$arg" >&2; exit 2 ;;
    *) SPEC="$arg" ;;
  esac
done

# ---------------------------------------------------------------- 显示层
ESC=$(printf '\033')
if [ "$PLAIN" = 0 ] && [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_R="${ESC}[31m"; C_G="${ESC}[32m"; C_Y="${ESC}[33m"
  C_C="${ESC}[36m"; C_B="${ESC}[1m"; C_D="${ESC}[2m"; C_0="${ESC}[0m"
  TTY=1
else
  C_R=""; C_G=""; C_Y=""; C_C=""; C_B=""; C_D=""; C_0=""; TTY=0
fi

N=0
step() { N=$((N + 1)); printf '%s[%d/%d]%s %s%s%s\n' "$C_D" "$N" "$TOTAL" "$C_0" "$C_B" "$1" "$C_0"; }
ok()   { printf '        %s✓%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '        %s⚠%s %s\n' "$C_Y" "$C_0" "$*"; }
bad()  { printf '        %s✗%s %s\n' "$C_R" "$C_0" "$*"; }
note() { printf '        %s%s%s\n' "$C_D" "$*" "$C_0"; }
rule() { printf '%s────────────────────────────────────────────%s\n' "$C_D" "$C_0"; }

SPIN_PID=""
spin() {
  [ "$TTY" = 1 ] || return 0
  printf '\r        %s…%s %s' "$C_D" "$C_0" "$1" >/dev/tty 2>/dev/null
  return 0
}
spin_stop() {
  [ "$TTY" = 1 ] || return 0
  printf '\r%s' "${ESC}[K" >/dev/tty 2>/dev/null
  return 0
}
trap 'spin_stop' EXIT INT TERM

fail() { spin_stop; bad "$*"; exit 1; }
STATUS_FILE=/sdcard/Download/dsh-purge-install.status
set_status() { { printf '%s\n' "$1" > "$STATUS_FILE"; } 2>/dev/null || true; }



# ---------------------------------------------------------------- 工具
ver_gt() {
  a="$1"; b="$2"
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" != "$b" ] || return 1
  top=$(printf '%s\n%s\n' "$a" "$b" | sort -V 2>/dev/null | tail -n 1)
  [ -n "$top" ] && [ "$top" = "$a" ]
}

fetch_text() {
  url="$1"
  if command -v curl >/dev/null 2>&1; then curl -fsSL --max-time 8 "$url" 2>/dev/null && return 0; fi
  if command -v wget >/dev/null 2>&1; then wget -q -T 8 -O - "$url" 2>/dev/null && return 0; fi
  if command -v node >/dev/null 2>&1; then
    node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)process.exit(1);return r.text()}).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))' "$url" 2>/dev/null && return 0
  fi
  return 1
}

short() {
  v="$1"
  [ "${#v}" -le 58 ] && { printf '%s' "$v"; return 0; }
  printf '…%s' "$(printf '%s' "$v" | tail -c 46)"
}

download_file() {
  url="$1"; dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time 20 "$url" -o "$dest" 2>/dev/null && return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const [u, d] = process.argv.slice(1);
      fetch(u, { signal: AbortSignal.timeout(20000) })
        .then(async (r) => {
          if (!r.ok) process.exit(2);
          const b = Buffer.from(await r.arrayBuffer());
          if (b.length < 10000) process.exit(3);
          require("fs").writeFileSync(d, b);
        })
        .catch(() => process.exit(1));' "$url" "$dest" && return 0
  fi
  return 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; return; fi
  if command -v node >/dev/null 2>&1; then
    node -e 'const c=require("crypto"),fs=require("fs");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
    return
  fi
  printf ''
}

valid_tarball() {
  f="$1"
  [ -s "$f" ] || return 1
  if command -v gzip >/dev/null 2>&1; then
    gzip -t "$f" >/dev/null 2>&1 || return 1
  elif command -v tar >/dev/null 2>&1; then
    tar -tzf "$f" >/dev/null 2>&1 || return 1
  elif command -v node >/dev/null 2>&1; then
    node -e 'require("zlib").gunzipSync(require("fs").readFileSync(process.argv[1]))' "$f" 2>/dev/null || return 1
  fi
  return 0
}

# 有 sha256.txt 就比对（大小写不敏感），没有则只做 gzip 完整性检查
verify_artifact() {
  f="$1"; base="$2"
  valid_tarball "$f" || return 1
  body=$(fetch_text "${base%/}/sha256.txt") || return 0
  want=$(printf '%s' "$body" | awk '{print $1}' | head -n 1 | tr 'A-F' 'a-f')
  case "$want" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
    *) return 0 ;;
  esac
  have=$(sha256_of "$f" | tr 'A-F' 'a-f')
  [ -n "$have" ] && [ "$have" = "$want" ]
}

# GitHub 仓库 → 一串候选 base（国内加速镜像在前，官方在后）
build_bases() {
  BASES=""
  [ -n "$BASE_URL" ] && BASES="$BASE_URL"
  GH_VER_FROM_TAG=""
  if [ -n "$GH_REPO" ]; then
    # 没写 @tag 时自动解析最新版本：latest.txt（jsDelivr/raw 多源）
    if [ -z "$GH_TAG" ]; then
      for _u in "https://github.com/$GH_REPO/releases/latest/download/latest.txt" \
                "https://gh-proxy.com/https://github.com/$GH_REPO/releases/latest/download/latest.txt" \
                "https://testingcf.jsdelivr.net/gh/$GH_REPO@main/latest.txt" \
                "https://raw.githubusercontent.com/$GH_REPO/main/latest.txt"; do
        _b=$(fetch_text "$_u" 2>/dev/null) || continue
        _v=$(printf '%s' "$_b" | tr -d '\r' | sed -n '1s/^[[:space:]]*//;s/[[:space:]]*$//p')
        [ -n "$_v" ] && { GH_TAG="v$_v"; break; }
      done
      if [ -z "$GH_TAG" ]; then
        warn "未能解析最新版本（latest.txt 不可达）；可临时改用 --gh $GH_REPO@vX.Y.Z"
        return 0
      fi
      note "最新版本：${GH_TAG#v}"
    fi
    ref="${GH_TAG:-main}"
    case "$ref" in
      v[0-9]*) GH_VER_FROM_TAG="${ref#v}" ;;
      [0-9]*) GH_VER_FROM_TAG="$ref" ;;
    esac
    rel="https://github.com/$GH_REPO/releases/download/$ref"
    raw="https://raw.githubusercontent.com/$GH_REPO/$ref"
    # 顺序按国内实测：直连 raw / 官方 release → jsDelivr(CF) → 两个可用代理 → ghfast → jsDelivr(主站)
    BASES="$BASES
$raw
$rel
https://testingcf.jsdelivr.net/gh/$GH_REPO@$ref
https://gh-proxy.com/$rel
https://gh-proxy.com/$raw
https://ghproxy.net/$rel
https://ghproxy.net/$raw
https://ghfast.top/$rel
https://ghfast.top/$raw
https://cdn.jsdelivr.net/gh/$GH_REPO@$ref"
  fi
  BASES=$(printf '%s\n' "$BASES" | sed '/^[[:space:]]*$/d')
  # 发布包只存在于 Release 资产里，raw/jsDelivr 取不到 tarball，只保留 release 及其代理
  GH_URLS=""
  if [ -n "$GH_REPO" ] && [ -n "${GH_VER_FROM_TAG:-}" ]; then
    # 顺序按国内实测：代理优先（无梯子也能用），github 直连次之
    for prefix in https://gh-proxy.com https://ghproxy.net "" https://ghfast.top; do
      if [ -n "$prefix" ]; then
        GH_URLS="$GH_URLS
$prefix/$rel/$PKG_SLUG-$GH_VER_FROM_TAG.tgz"
      else
        GH_URLS="$GH_URLS
$rel/$PKG_SLUG-$GH_VER_FROM_TAG.tgz"
      fi
    done
    GH_URLS=$(printf '%s\n' "$GH_URLS" | sed '/^[[:space:]]*$/d')
  fi
}

base_latest() {
  # 自建镜像：<base>/latest.txt 第一行就是版本号
  [ -n "$BASE_URL" ] || return 1
  body=$(fetch_text "${BASE_URL%/}/latest.txt") || body=""
  ver=$(printf '%s' "$body" | head -n 1 | tr -d ' \r\n')
  case "$ver" in
    [0-9]*) MIRROR_ROOT="$BASE_URL"; LATEST_VER="$ver"; return 0 ;;
  esac
  return 1
}

build_bases
if [ "$PRINT_SOURCES" = 1 ]; then
  if [ -z "$BASES" ]; then echo "(没有配置来源；用 --base 或 --gh owner/repo@tag)" >&2; exit 2; fi
  printf '%s\n' "$BASES"
  exit 0
fi

# ---------------------------------------------------------------- 开始
printf '\n%s  dsh-purge 安装器%s  %s%s%s\n' "$C_B" "$C_0" "$C_D" "$PKG_NAME" "$C_0"
rule

# --bg：立刻返回，把安装丢到独立会话里跑，终端被引擎重载关闭也不受影响
if [ "$BG" = 1 ]; then
  BOUT=/sdcard/Download/dsh-purge-bg.out
  BLOG=/sdcard/Download/dsh-purge-install.log
  _args=""
  for _a in "$@"; do
    [ "$_a" = "--bg" ] && continue
    _args="$_args $_a"
  done
  if command -v setsid >/dev/null 2>&1; then
    setsid sh "$0" $_args > "$BOUT" 2>&1 < /dev/null &
  else
    sh "$0" $_args > "$BOUT" 2>&1 < /dev/null &
  fi
  printf '\n  已在后台开始安装（终端可以关闭，不会中断）\n'
  printf '  进度  %s\n' "$STATUS_FILE"
  printf '  日志  %s\n' "$BOUT"
  printf '  完成  %s\n' "输入框上方出现「已清洗 x/xx」，或「全部功能 › 清洗」能开面板"
  printf '  查看  cat %s\n\n' "$STATUS_FILE"
  exit 0
fi

# [1/6] 环境
step "环境"
command -v dsh >/dev/null 2>&1 || fail "找不到 dsh，请在 App 的「终端」里跑（不要在手机 adb shell 里）"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
CACHE_DIR="$DSH_HOME_DIR/cache/dsh-purge"
cleanup_orphan_runs() {
  _me=$$
  for _d in /proc/[0-9]*; do
    _p=${_d#/proc/}
    [ "$_p" = "$_me" ] && continue
    _cm=$(tr '\000' ' ' < "$_d/cmdline" 2>/dev/null) || continue
    case "$_cm" in *install-in-app.sh*) ;; *) continue ;; esac
    _ppid=$(awk '{print $4}' "$_d/stat" 2>/dev/null)
    [ "$_ppid" = 1 ] && kill -9 "$_p" 2>/dev/null
  done
}
cleanup_orphan_runs

SPIN_FLAG="${TMPDIR:-/tmp}/dsh-purge-spin.$$"
rm -f "${TMPDIR:-/tmp}"/dsh-purge-spin.* 2>/dev/null || true
touch "$SPIN_FLAG" 2>/dev/null || true
trap 'rm -f "$SPIN_FLAG" 2>/dev/null' EXIT INT TERM HUP
[ -d "$PROFILE_DIR" ] || fail "找不到 profile：$PROFILE_DIR（先在 App 里启动过一次引擎）"
ok "dsh 就位 · profile=$PROFILE"

note "$(short "$PROFILE_DIR")"

WS="$PROFILE_DIR/pnpm-workspace.yaml"
INSTALLED_PKG="$PROFILE_DIR/node_modules/$PKG_NAME/package.json"
HAVE_VER=""
if [ -f "$INSTALLED_PKG" ]; then
  HAVE_VER=$(node -e "process.stdout.write(require('$INSTALLED_PKG').version)" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$INSTALLED_PKG" | head -n 1)
fi

if [ -z "$HAVE_VER" ]; then
  printf '\n  %s首次安装说明%s\n' "$C_B" "$C_0"
  printf '    1) 安装会让引擎重载，终端可能自动关闭——这是正常的，不是失败\n'
  printf '    2) 进度写入 /sdcard/Download/dsh-purge-install.log\n'
  printf '    3) 成功后输入框上方出现「已清洗 x/xx」，或「全部功能 › 清洗」能开面板\n'
  printf '    4) 终端若关闭，重新打开终端执行：\n'
  printf '       cat /sdcard/Download/dsh-purge-install-result.txt\n\n'
fi

if [ "$MODE" = "uninstall" ]; then
  step "定位插件"
  [ -n "$HAVE_VER" ] || fail "没有安装 $PKG_NAME"
  ok "已安装 $HAVE_VER"
  step "卸载"
  spin "移除 $HAVE_VER"
  dsh plugin --profile "$PROFILE" remove "$PKG_NAME" || { spin_stop; fail "卸载失败"; }
  spin_stop
  ok "已卸载"
  rule
  printf '  %s下一步%s：到「设置 › 本机引擎」重启一次\n\n' "$C_B" "$C_0"
  exit 0
fi

# [2/6] pnpm 配置
step "pnpm 配置"
FIXED=0
if [ -f "$WS" ]; then
  if grep -q '^ *@panda11445go/dsh-purge: true' "$WS" 2>/dev/null; then
    cp "$WS" "$WS.bak.$(date +%s)"
    sed -i 's|^\( *\)@panda11445go/dsh-purge: true|\1"@panda11445go/dsh-purge": true|' "$WS"
    FIXED=1
  fi
  if grep -q ': set this to true or false$' "$WS" 2>/dev/null; then
    cp "$WS" "$WS.bak.$(date +%s)" 2>/dev/null
    sed -i '/panda11445go/ s/: set this to true or false$/: true/' "$WS"
    FIXED=1
  fi
fi
if [ "$FIXED" = 1 ]; then ok "已修正 allowBuilds（旧文件已备份）"; else ok "无需修改"; fi

# [3/6] 定位包
step "定位包"
SRC_LABEL="本地包"
if [ "$MODE" = "latest" ] && [ -n "${GH_URLS:-}" ] && [ -z "$SPEC" ]; then
  LATEST_VER="$GH_VER_FROM_TAG"
  WANT_VER="$LATEST_VER"
  DL_TMP="$CACHE_DIR"
  mkdir -p "$DL_TMP"
  DLFILE="$DL_TMP/$PKG_SLUG-$LATEST_VER.tgz"
  set_status "downloading"
  spin "从 GitHub 下载 $LATEST_VER"
  GH_FROM=""
  GH_DEADLINE=$(( $(date +%s) + 90 ))
  for u in $GH_URLS; do
    if [ "$(date +%s)" -ge "$GH_DEADLINE" ]; then
      note "下载超时（90s），停止尝试"
      break
    fi
    host=$(printf '%s' "$u" | sed 's#^https\?://##; s#/.*##')
    b=$(printf '%s' "$u" | sed "s|/$PKG_SLUG-$LATEST_VER.tgz$||")
    spin "探测 $host"
    # 先用小文件探测，避免不可达的源白等
    if ! fetch_text "$b/sha256.txt" >/dev/null 2>&1; then
      note "跳过 $host（不通）"
      continue
    fi
    spin "下载 $host"
    if download_file "$u" "$DLFILE" && valid_tarball "$DLFILE"; then
      want=$(fetch_text "$b/sha256.txt" 2>/dev/null | awk '{print $1}' | head -n 1 | tr 'A-F' 'a-f')
      if [ -z "$want" ]; then
        GH_FROM="$host"; break
      fi
      have=$(sha256_of "$DLFILE" | tr 'A-F' 'a-f')
      if [ "$have" = "$want" ]; then
        GH_SHA="ok"; GH_FROM="$host"; break
      fi
      note "$host 的包 sha256 不符，换下一个"
      rm -f "$DLFILE"
      continue
    fi
    rm -f "$DLFILE"
  done
  spin_stop
  if [ -n "$GH_FROM" ]; then
    SPEC="$DLFILE"
    GH_SIZE=$(wc -c < "$DLFILE" 2>/dev/null | tr -d ' ')
    SRC_LABEL="GitHub 下载（$GH_FROM${GH_SHA:+，sha256 校验通过}）"
  else
    warn "GitHub 镜像都下载失败"
    spin_stop
    fail "所有镜像下载失败（网络或镜像不可达）；稍后重试，或改用本地包/--base"
  fi
fi

if [ "$MODE" = "latest" ] && [ -n "$BASES" ] && [ -z "$SPEC" ] && [ -z "${GH_URLS:-}" ]; then
  spin "查询镜像"
  LATEST_VER=""
  GOOD_BASES=""
  if [ -n "${GH_VER_FROM_TAG:-}" ]; then
    # tag 本身就是版本号，不必再查 latest.txt（少一轮网络探测）
    LATEST_VER="$GH_VER_FROM_TAG"
    GOOD_BASES="$BASES"
  else
    for b in $BASES; do
      body=$(fetch_text "${b%/}/latest.txt") || continue
      ver=$(printf '%s' "$body" | head -n 1 | tr -d ' \r\n')
      case "$ver" in
        [0-9]*) LATEST_VER="$ver"; GOOD_BASES="$b"; break ;;
      esac
    done
  fi
  spin_stop
  if [ -n "$LATEST_VER" ]; then
    DL_DIR_TMP="$CACHE_DIR"
    mkdir -p "$DL_DIR_TMP"
    DLFILE="$DL_DIR_TMP/$PKG_SLUG-$LATEST_VER.tgz"
    spin "下载 $LATEST_VER"
    DL_FROM=""
    DL_START=$(date +%s)
    for b in ${GOOD_BASES:-}; do
      [ $(( $(date +%s) - DL_START )) -gt 45 ] && break
      download_file "${b%/}/$PKG_SLUG-$LATEST_VER.tgz" "$DLFILE" || continue
      if verify_artifact "$DLFILE" "$b"; then DL_FROM="$b"; break; fi
      note "校验未通过，换下一个镜像（$b）"
      rm -f "$DLFILE"
    done
    spin_stop
    if [ -n "$DL_FROM" ] && [ -f "$DLFILE" ]; then
      SPEC="$DLFILE"
      SRC_LABEL="镜像下载（$DL_FROM）"
    else
      rm -rf "$DL_DIR_TMP"
      warn "所有镜像都没下载成功"
    fi
  fi
fi

if [ "$MODE" = "latest" ] && [ -z "$SPEC" ] && [ -z "${GH_URLS:-}" ]; then
  spin "查询自建镜像"
  if base_latest; then
    spin_stop
    case "$LATEST_VER" in
      0.0.0*)
        LATEST_VER=""
        SRC_LABEL="本地包（镜像只有占位版）"
        ;;
      *)
        SPEC="${BASE_URL%/}/$PKG_SLUG-$LATEST_VER.tgz"
        SRC_LABEL="自建镜像 $BASE_URL"
        ;;
    esac
  else
    spin_stop
    SRC_LABEL="本地包（镜像无响应）"
  fi
fi

if [ -z "$SPEC" ] && [ -z "${GH_URLS:-}" ]; then
  SPEC=$(ls -t "$CACHE_DIR/$PKG_SLUG"-*.tgz 2>/dev/null | head -n 1)
fi
if [ -z "$SPEC" ] && [ -z "${GH_URLS:-}" ]; then
  SPEC=$(ls -t "$DL_DIR/$PKG_SLUG"-*.tgz 2>/dev/null | head -n 1)
  if [ -z "$SPEC" ]; then
    if [ "$MODE" = "check" ]; then
      step "体检结果"
      if [ -n "$HAVE_VER" ]; then
        ok "已装 $HAVE_VER（本地没有安装包，联网安装请用 --latest --gh）"
      else
        ok "未安装（本地没有安装包；联网安装请用 --latest --gh owner/repo@tag）"
      fi
      rule; printf '\n'; exit 0
    fi
    fail "没有可用的安装包：$CACHE_DIR 和 $DL_DIR 下都没有 $PKG_SLUG-*.tgz"
  fi
fi

# 自建镜像 latest 比已装旧时回退本地包（仅 --base 路径；--gh 有 tag 版本，不走这里）
if [ "$MODE" = "latest" ] && [ -z "${GH_URLS:-}" ] && [ -n "${LATEST_VER:-}" ] && [ -n "$HAVE_VER" ] && ver_gt "$HAVE_VER" "$LATEST_VER"; then
  SPEC=$(ls -t "$DL_DIR/$PKG_SLUG"-*.tgz 2>/dev/null | head -n 1)
  [ -n "$SPEC" ] || fail "本地也没有 tarball；先放一个到 $DL_DIR"
  SRC_LABEL="本地包（镜像 $LATEST_VER 不高于已装）"
fi

if [ -n "$SPEC" ]; then
  case "$SPEC" in
    http://*|https://*) SPEC_KIND="url" ;;
    *) [ -f "$SPEC" ] || fail "文件不存在：$SPEC"
       valid_tarball "$SPEC" || fail "安装包损坏（不是有效的 .tgz）：$SPEC"
       SPEC_KIND="file" ;;
  esac
  WANT_VER=$(basename "$SPEC" | sed -n "s/^$PKG_SLUG-\(.*\)\.tgz$/\1/p")
  ok "${WANT_VER:-$(basename "$SPEC")} · $SRC_LABEL"
  note "$(short "$SPEC")"
else
  SPEC_KIND="url"
  ok "${WANT_VER:-${LATEST_VER:-?}} · $SRC_LABEL"
  note "$(printf '%s\n' "$GH_URLS" | head -n 1)"
fi

# 任何路径都不许悄悄降级：本地包比已装旧时直接中止（--reinstall 才允许）
if [ "$REINSTALL" != 1 ] && [ -n "$WANT_VER" ] && [ -n "$HAVE_VER" ] && ver_gt "$HAVE_VER" "$WANT_VER"; then
  fail "要装的 $WANT_VER 低于已装 $HAVE_VER，已中止（确需降级请用 --reinstall）"
fi

# --mirror：镜像没给出可用版本就直接失败，不悄悄回退本地包
if [ "$MIRROR_ONLY" = 1 ] && [ "$SPEC_KIND" != "url" ]; then
  fail "没有取到可用版本（--base/GitHub 都没有）；去掉 --mirror 用本地包，或先发布 Release"
fi

if [ "$MODE" = "check" ]; then
  step "体检结果"
  if [ -n "$HAVE_VER" ] && [ "$HAVE_VER" = "$WANT_VER" ]; then
    ok "已是 $HAVE_VER（--reinstall 可强制重装）"
  elif [ -n "$HAVE_VER" ]; then
    ok "已装 $HAVE_VER → 可升级 $WANT_VER"
  else
    ok "未安装 → 将安装 ${WANT_VER:-该包}"
  fi
  rule
  printf '\n'
  exit 0
fi

if [ "$REINSTALL" != 1 ] && [ "$MODE" = "install" ] && [ -n "$HAVE_VER" ] && [ -n "$WANT_VER" ] && [ "$HAVE_VER" = "$WANT_VER" ]; then
  step "安装"
  ok "已是 $WANT_VER，跳过（--reinstall 强制重装）"
  rule
  printf '  %s下一步%s：界面没生效就到「设置 › 本机引擎」重启\n\n' "$C_B" "$C_0"
  exit 0
fi

# [4/6] 安装
step "安装"
T0=$(date +%s)
if [ "$REINSTALL" = 1 ] && [ -n "$HAVE_VER" ]; then
  spin "移除旧版 $HAVE_VER"
  if dsh plugin --profile "$PROFILE" remove "$PKG_NAME" >/dev/null 2>&1; then
    spin_stop; note "已移除 $HAVE_VER"
  else
    spin_stop; fail "卸载失败，已中止（未安装新版本）"
  fi
fi
LOG="${TMPDIR:-/tmp}/dsh-purge-install.log"
# 预批准：pnpm 对非 registry 依赖按「包名@spec」逐条要求批准。
# 在第一次安装前就把缓存包的键写进 allowBuilds，全新设备也能一次通过。
preapprove_build() {
  _tgz="$1"
  [ -f "$WS" ] && [ -n "$_tgz" ] || return 0
  node - "$WS" "$PROFILE_DIR" "$_tgz" <<'NODE' 2>/dev/null || true
const fs = require("fs");
const path = require("path");
const [ws, profile, tgz] = process.argv.slice(2);
const rel = path.relative(profile, tgz).split(path.sep).join("/");
const key = `@panda11445go/dsh-purge@file:${rel}`;
let text = fs.readFileSync(ws, "utf8");
if (text.includes(key)) process.exit(0);
const line = `  '${key.replace(/'/g, "''")}': true\n`;
if (/^allowBuilds:[ \t]*$/m.test(text)) {
  text = text.replace(/^allowBuilds:[ \t]*$/m, `allowBuilds:\n${line}`);
} else {
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  text += `allowBuilds:\n${line}`;
}
fs.writeFileSync(ws, text);
NODE
}

add_once() {
  dsh plugin --profile "$PROFILE" add "$SPEC" >"$LOG" 2>&1
  _rc=$?
  [ "$VERBOSE" = 1 ] && cat "$LOG"
  return $_rc
}
if [ "$REINSTALL" = 1 ]; then
  note "重装会触发引擎重载，终端可能中断；中断后重开终端跑 --check 即可"
fi
T0=$(date +%s)
if [ "$DETACH" = 1 ] && command -v setsid >/dev/null 2>&1; then
  EXITF="$LOG.exit"; rm -f "$EXITF"
  setsid sh -c "dsh plugin --profile '$PROFILE' add '$SPEC' >'$LOG' 2>&1; echo \$? >'$EXITF'" >/dev/null 2>&1 &
  spin "后台安装中（终端断开也会继续）"
  while [ ! -f "$EXITF" ]; do sleep 1; done
  spin_stop
  DETACH_CODE=$(cat "$EXITF" 2>/dev/null || echo 1)
  if [ "${DETACH_CODE:-1}" = "0" ]; then ADD_OK=1; else ADD_OK=0; fi
else
  case "$SPEC" in
    "$CACHE_DIR"/*) preapprove_build "$SPEC" ;;
  esac
  if [ -z "$HAVE_VER" ]; then
    printf '    %s3 秒后开始安装（引擎将重载，终端可能关闭）…%s\n' "$C_B" "$C_0"
    sleep 3
  fi
  set_status "installing"
  spin "pnpm 安装中"
  if add_once; then ADD_OK=1; else ADD_OK=0; fi
fi
if [ "$ADD_OK" = 0 ]; then
  spin_stop
  if grep -q ': set this to true or false$' "$WS" 2>/dev/null; then
    warn "pnpm 待批准 → 已置 true，重试"
    sed -i '/panda11445go/ s/: set this to true or false$/: true/' "$WS"
    spin "重试中"
    if ! add_once; then
      spin_stop
      bad "安装失败"
      printf '\n  %s最近日志%s（%s）\n' "$C_D" "$C_0" "$LOG"
      tail -n 14 "$LOG" | sed 's/^/    /'
      printf '\n  %s建议%s：加 --verbose 看完整输出，或检查网络 / 镜像\n\n' "$C_B" "$C_0"
      exit 1
    fi
  else
    bad "安装失败"
    printf '\n  %s最近日志%s（%s）\n' "$C_D" "$C_0" "$LOG"
    tail -n 14 "$LOG" | sed 's/^/    /'
    printf '\n  %s建议%s：加 --verbose 看完整输出，或检查网络 / 镜像\n\n' "$C_B" "$C_0"
    exit 1
  fi
fi
spin_stop
ok "完成（$(( $(date +%s) - T0 ))s）"
if [ "$SPEC_KIND" = "file" ]; then
  case "$SPEC" in
    "$CACHE_DIR"/*)
      note "安装包已缓存：$(short "$SPEC")"
      ;;
    *)
      # 从 /sdcard 等外部路径安装时，把包装进缓存，profile 的 file: 依赖指向缓存，
      # 避免用户删掉外部文件后 pnpm 解析失败。
      mkdir -p "$CACHE_DIR" 2>/dev/null
      if cp "$SPEC" "$CACHE_DIR/$(basename "$SPEC")" 2>/dev/null; then
        note "安装包已缓存：$(short "$CACHE_DIR/$(basename "$SPEC")")"
        note "提示：如需让依赖指向缓存，可重装一次（默认已从缓存读取）"
      fi
      ;;
  esac
fi
[ "$VERBOSE" = 0 ] && rm -f "$LOG" 2>/dev/null

# [5/6] 自检
step "自检"
BIN="$PROFILE_DIR/node_modules/$PKG_NAME/bin/dsh-purge.js"
if [ -f "$BIN" ] && command -v node >/dev/null 2>&1; then
  NEW_VER=$(node -e "process.stdout.write(require('$INSTALLED_PKG').version)" 2>/dev/null || echo "$WANT_VER")
  # 重装会触发 HMR 重载，宿主可能打断本进程的子命令；窗口内静音，拿不到就降级展示。
  exec 9>&2; exec 2>/dev/null
  OUT=$(node "$BIN" --status 2>&1) || OUT=""
  exec 2>&9; exec 9>&-
  if [ -z "$OUT" ]; then
    ok "v${NEW_VER:-?} · 已装（引擎正在重载，自检跳过）"
  else
    HOST=$(printf '%s\n' "$OUT" | sed -n 's/^宿主 \/ host: *//p' | head -n 1)
    PATCHES=$(printf '%s\n' "$OUT" | sed -n 's/^补丁 \/ patches: *//p' | head -n 1)
    ok "v${NEW_VER:-?}"
    if [ -n "$HOST" ]; then note "宿主：$HOST"; fi
    if [ -n "$PATCHES" ]; then note "补丁：$PATCHES"; fi
  fi
else
  ok "已装（跳过自检）"
fi

# [6/6] 完成
step "完成"
ok "dsh-purge 已就绪"
set_status "done ${NEW_VER:-${WANT_VER:-?}}"

_FINAL_VER="${NEW_VER:-$WANT_VER}"
_SRC="${GH_FROM:-}"
[ -z "$_SRC" ] && case "$SRC_LABEL" in *"（"*) _SRC=$(printf '%s' "$SRC_LABEL" | sed 's/.*（//; s/）.*//') ;; esac

RESULT_FILE=/sdcard/Download/dsh-purge-install-result.txt
if { printf '时间: %s\n版本: %s\n位置: %s\n来源: %s\n缓存: %s\n' \
      "$(date 2>/dev/null)" "${_FINAL_VER:-?}" "$PROFILE_DIR/node_modules/$PKG_NAME" "${_SRC:-本地}" "${SPEC:-无}" \
      > "$RESULT_FILE"; } 2>/dev/null; then :; else RESULT_FILE=""; fi

rule
printf '  %s安装结果%s\n' "$C_B" "$C_0"
printf '    版本    %s%s%s' "$C_0" "${_FINAL_VER:-?}" "$C_0"
if [ -n "$HAVE_VER" ] && [ "${_FINAL_VER:-}" != "${HAVE_VER}" ]; then printf '（原 %s）' "$HAVE_VER"; fi
printf '\n'
printf '    位置    %s\n' "$PROFILE_DIR/node_modules/$PKG_NAME"
if [ -n "$_SRC" ]; then printf '    来源    %s\n' "$_SRC"; fi
if [ -n "${SPEC:-}" ] && [ -f "${SPEC:-}" ]; then
  _SZ=$(wc -c < "$SPEC" 2>/dev/null | tr -d ' ')
  _SHA=$(sha256_of "$SPEC" 2>/dev/null | cut -c1-16)
  printf '    安装包  %s（%s 字节）\n' "$SPEC" "${_SZ:-?}"
  if [ -n "$_SHA" ]; then printf '    sha256  %s…\n' "$_SHA"; fi
fi
printf '    下一步  %s设置 › 本机引擎 › 重启%s\n' "$C_B" "$C_0"
printf '            重启后：对话页输入框上方状态条，或「全部功能 › 清洗」开面板\n'
if [ -n "$RESULT_FILE" ]; then printf '    结果    %s\n' "$RESULT_FILE"; fi
printf '    日志    %s\n\n' "${LOG:-（无）}"
