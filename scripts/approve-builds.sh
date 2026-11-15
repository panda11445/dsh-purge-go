#!/bin/sh
# 把 pnpm 留下的「待批准」构建项一次性置为允许，然后可选地重试安装。
#
# pnpm 11 + dsh 的 supply-chain 策略会给非 registry 依赖（URL / file:）写入
#   allowBuilds:
#     '@scope/pkg@<spec>': set this to true or false
# 只批准包名不算数，必须把带 spec 的那条置 true。
#
# 用法：
#   sh approve-builds.sh                 # 只批准，打印结果
#   sh approve-builds.sh <tarball-url>   # 批准后重试安装
set -u
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/web"
WS="$PROFILE_DIR/pnpm-workspace.yaml"
URL="${1:-}"

[ -f "$WS" ] || { echo "找不到 $WS（先安装一次让 pnpm 生成）" >&2; exit 1; }

# 传入 URL 时先预写 allowBuilds 键，全新设备也能一次通过
if [ -n "$URL" ]; then
  node - "$WS" "$URL" <<'NODE' 2>/dev/null || true
const fs = require("fs");
const [ws, url] = process.argv.slice(2);
const key = `@panda11445go/dsh-purge@${url}`;
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
fi

before=$(grep -c "set this to true or false" "$WS" 2>/dev/null || echo 0)
sed -i '/panda11445go/ s/: set this to true or false$/: true/' "$WS"
after=$(grep -c "set this to true or false" "$WS" 2>/dev/null || echo 0)

echo "待批准条目：$before -> $after"
grep -n "panda11445go" "$WS" || true

if [ -n "$URL" ]; then
  echo
  echo "重试安装：$URL"
  exec dsh plugin --profile web add "$URL"
fi

if [ "$after" -gt 0 ]; then
  echo "仍有待批准条目，检查上面的 allowBuilds 是否都匹配 panda11445go" >&2
  exit 1
fi
echo "已全部批准。重新执行一次 dsh plugin add <url> 即可。"
