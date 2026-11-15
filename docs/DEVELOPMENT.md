# 开发与维护手册

## 目录

| 路径 | 作用 |
|---|---|
| `lib/core.js` | 补丁表、targetFiles、匹配/应用/回滚、状态 |
| `lib/index.js` | 插件入口：命令、工具、注入、自愈 |
| `lib/dshgo.js` | dsh-Go 原生状态条 + 清洗面板 |
| `lib/profile-insert.js` | profile 登记自愈 + 旧裸名迁移 |
| `lib/compat.js` | 宿主/桥接版本矩阵、入口身份判断 |
| `lib/android.js` | dsh-Go 宿主识别与路径映射 |
| `bin/dsh-purge.js` | CLI：`--status` / `--apply` / `--revert` / `--doctor` |
| `scripts/compat-matrix.mjs` | 多宿主兼容矩阵（CI/本地） |
| `scripts/capture-host-snippets.mjs` | 从真实宿主抓片段生成回归 fixture |
| `scripts/release-check.mjs` | 发布前自检 |
| `test/` | 单测：面板、兼容模型、补丁变体、profile 迁移 |
| `work/` | 本地分析/模拟产物（不入包） |

## 补丁模型

一条补丁：

```js
{
  id: 14,
  name: "ESCALATION_GRANT_UNCONDITIONAL",
  layer: "代码",
  file: ["escalation"],          // targetFiles 的键
  replacements: [
    { pattern: "旧原文", replace: "新文本 // [dsh-purge] marker" },
    { pattern: /正则旧原文/, replace: "..." },   // 版本差异大时用正则
  ],
  markers: ["[dsh-purge] ..."],   // 已应用识别
  markersAny: true,              // 多个 marker 命中任一即可
  optional: true,                // 没有该文件时允许
  skipIfMarked: true,            // marker 在就整条跳过
  forbid: ["..."]                // 出现这些字符串说明被别的补丁/宿主改坏
}
```

规则：

1. **只加变体，不删旧变体**：一个 `replacements` 数组可以同时覆盖多个宿主版本，按顺序尝试。
2. **每个变体必须幂等**：替换后的文本不能再被同一条 pattern 命中；`markers` 用于二次运行识别。
3. **marker 用唯一注释**：`// [dsh-purge] ...` 或字符串内的固定后缀，便于状态页与 `--doctor` 判断。
4. **file 键走 targetFiles**：不要写死路径；新版本拆包时用 `firstExisting` / `allExisting` /
   版本条件（参考 `dsh-ask-pipeline`、`dsh-tools-ptc`、`deliverables-prompt`）。
5. **不要引入安装生命周期脚本**（pnpm 11 会拒跑/报错），注册与自愈放在 `apply()`。

## 新增一条补丁

1. 在 `lib/core.js` 的 `ALL_PATCHES` 里追加对象；给一个稳定的 `id`（不要复用）。
2. 选择目标 `file` 键；没有就加到 `targetFiles()`。
3. 写 `pattern`/`replace`/`markers`；先在真实宿主上 `--status` 验证 applied。
4. 加到 `work/` 的验证脚本或 `test/fixtures` 片段；跑 `npm test`。
5. 如需面板可见，确认 `patchAppliesHere()` / 分组显示逻辑不需要调整。

## 本地调试

```sh
# 指向一份宿主树（不必真的在手机上）
DSH_BASE=/tmp/host/opt/dsh/node_modules/@deepseek-ai DSH_HOME=/tmp/dsh-home \
  node bin/dsh-purge.js --status
node bin/dsh-purge.js --doctor          # 宿主/桥接/入口/漂移一次看全

# 多宿主矩阵（推荐加 --apply --syntax）
node scripts/compat-matrix.mjs --host /tmp/host-0.2.2 --apply --syntax
```

`DSH_PURGE_ANDROID=1` 可强制走 Android 分支（跳过 shim/自重启），本地测试宿主补丁时建议设置，
避免污染本机 `~/.npm-global/bin`。

## 测试

```sh
npm test                 # 全部
npm run test:compat      # 兼容模型 + 片段回归
npm run compat:matrix -- --host /tmp/host-0.2.2 --apply --syntax
```

片段 fixture 已覆盖 `0.2.2-rc.1` 与 `0.2.1-rc.4`，`npm test` 会全部回归（CI 不需要宿主树）。
宿主升级或补旧版本锚点后刷新片段：

```sh
node scripts/capture-host-snippets.mjs --host /tmp/host-新版本 --version 0.3.0-rc.1
# 只抓指定补丁：--ids 14,17,40
```

抓取时会把宿主本地路径替换成固定来源说明，避免把本机路径带进仓库。

## 发布

版本策略（语义化）：

- **patch**：只修 pattern/文案、补无关兼容的 bug；
- **minor**：新增宿主版本支持、新增用户可见功能（会更新 `HOST_MATRIX` / `dshTargets`）；
- **major**：安装形态、profile 布局、配置键或最小 DSH 范围破坏性变更。

发布清单：

```sh
npm test
node scripts/release-check.mjs            # 补全 --require-tarball 更稳
npm pack                                  # 生成 <name>-<version>.tgz
node scripts/release-check.mjs --require-tarball
# 发布：建 GitHub Release（tag v<version>），上传 tgz + latest.txt + sha256.txt + install*.sh
# 不再 npm publish：package.json 已设 private，安装只走仓库页的 Release / install.sh / 本地包
```

发布后：真机 `dsh plugin --profile web add <tgz>`（或覆盖插件目录）→ 重启引擎 →
`node bin/dsh-purge.js --status` → 面板「清洗」→ 再重启 → `--status` 无 drift。

## 安全与边界

- 不写 `/sdcard` 探针、不打印凭据；调试代码不得进入 `lib/`、`bin/`、`scripts/`（`release:check` 会扫）。
- 只改当前用户有权限的宿主；不改 App 私有数据目录以外的系统文件。
- 新增 shell 调用时走既有封装，不要新开安装脚本/守护进程。
