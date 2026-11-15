#!/usr/bin/env bash
# dsh-purge for dsh-Go (Android) — 在 App 的「终端」里运行。
#
#   curl -fsSL .../install-android.sh | bash          # 远程（若仓库已发布）
#   ./scripts/install-android.sh                      # 在解压后的插件目录里
#   DSH_PURGE_SRC=/sdcard/Download/dsh-purge ./scripts/install-android.sh
#
# 做三件事：把插件目录放到 $DSH_HOME/dsh-go/plugins/dsh-purge，注册进 web profile，
# 打印状态。不会自动清洗宿主（改宿主文件需要你明确执行 /purge apply 或面板「清洗」）。
set -euo pipefail

log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

DSH_HOME="${DSH_HOME:-/root/.dsh}"
PROFILE="${DSH_PURGE_PROFILE:-web}"
TARGET="${DSH_PURGE_DIR:-$DSH_HOME/dsh-go/plugins/dsh-purge}"
SRC="${DSH_PURGE_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd || true)}"

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
用法: scripts/install-android.sh [--uninstall]
环境变量:
  DSH_HOME       默认 /root/.dsh
  DSH_PURGE_PROFILE  默认 web（App 本机引擎用的 profile）
  DSH_PURGE_SRC  插件源目录（默认脚本上一级）
  DSH_PURGE_DIR  安装目录（默认 $DSH_HOME/dsh-go/plugins/dsh-purge）
EOF
    exit 0 ;;
  --uninstall)
    log "== 卸载 dsh-purge =="
    if command -v dsh >/dev/null 2>&1; then
      # 先还原宿主补丁，再移除包；顺序反了会留下没有入口的补丁。
      if [ -x "$TARGET/bin/dsh-purge.js" ]; then
        node "$TARGET/bin/dsh-purge.js" --revert || true
      fi
      dsh plugin --profile "$PROFILE" remove "@panda11445go/dsh-purge" || dsh plugin --profile "$PROFILE" remove dsh-purge || true
    else
      log "未找到 dsh 命令；请手动移除 profile 里的 dsh-purge 依赖。"
    fi
    log "完成。到 App 的「引擎」页重启引擎。"
    exit 0 ;;
esac

[ -f "$SRC/package.json" ] || die "找不到插件源目录（$SRC）。用 DSH_PURGE_SRC 指到含 package.json 的目录。"
command -v node >/dev/null 2>&1 || die "PATH 里没有 node。请确认这是 dsh-Go 的本机引擎终端。"
command -v dsh >/dev/null 2>&1 || die "PATH 里没有 dsh。请确认这是 dsh-Go 的本机引擎终端（不是手机系统 shell）。"
[ -f "$DSH_HOME/profiles/$PROFILE/package.json" ] || log "提示：profile $PROFILE 尚未初始化，dsh plugin 会创建它。"

log "== dsh-purge for dsh-Go =="
log "DSH_HOME = $DSH_HOME"
log "profile  = $PROFILE"
log "源目录   = $SRC"
log "安装到   = $TARGET"

if [ "$(cd "$SRC" && pwd)" = "$(cd "$TARGET" 2>/dev/null && pwd || true)" ]; then
  log "源目录就是安装目录，跳过复制。"
else
  mkdir -p "$(dirname "$TARGET")"
  rm -rf "$TARGET"
  mkdir -p "$TARGET"
  # 不带 .git / node_modules / 本地测试产物；保留 lib、client.js、presets、scripts、docs。
  ( cd "$SRC" && tar -cf - \
      --exclude=.git --exclude=node_modules --exclude='*.tgz' \
      --exclude=work --exclude=.dsh-purge \
      package.json lib bin client.js cordis.patch.yml presets scripts docs \
      README.md README.zh-CN.md README-ANDROID.md LICENSE NOTICE \
      2>/dev/null ) | ( cd "$TARGET" && tar -xf - )
  [ -f "$TARGET/lib/index.js" ] || die "复制后缺少 lib/index.js。"
  log "已复制。"
fi

# 旧版（1.2.x）的 profile 依赖/插入用裸名 dsh-purge；dsh-Go 1.0.16 的 dshGo 桥接 0.4
# 按 loader 入口名找同名 package.json，裸名会让原生面板注册失败。先迁移，再登记 scoped 名。
log "== 迁移旧 profile 包名 =="
node --input-type=module -e '
  const { migrateLegacyProfileIdentity } = await import(process.argv[1]);
  const r = migrateLegacyProfileIdentity(process.argv[2]);
  if (r.changed || r.link) console.log("migrated:", JSON.stringify(r));
' "$TARGET/lib/profile-insert.js" "$DSH_HOME/profiles/$PROFILE" || true

# 安装（目录链接进 profile）。已装过时 pnpm 会更新链接。
log "== dsh plugin add =="
dsh plugin --profile "$PROFILE" add "$TARGET"

log "== 自检 =="
node "$TARGET/bin/dsh-purge.js" --status || {
  log "自检失败：请把上面的输出发到 issue。"
  exit 1
}

cat <<EOF

== 下一步 ==
1. 到 App 的「设置 › 本机引擎」点一次「重启」，让引擎加载插件。
2. 任选一种方式清洗：
   - 聊天里发 /purge apply
   - 或 插件面板 → 清洗 →「清洗」
3. 清洗完再重启一次引擎（App 管理引擎进程，插件不会自己重启）。
4. 还原：/purge revert，或面板 →「还原」。

只连远程主机（SSH / 中转）时，插件要装在远程主机自己的 profile 里，
本脚本的 $DSH_HOME 是手机本机引擎的家目录。
EOF
