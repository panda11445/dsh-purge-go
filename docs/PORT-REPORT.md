# dsh-purge × dsh-Go（Android）适配报告

本仓库是 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（v1.1.90 基线）的移植分支，
目标是让插件在 [ccch1mneyyy/dsh-Go](https://github.com/ccch1mneyyy/dsh-Go) 的 Android 本机引擎里
**可安装、可清洗、可还原、可提交 dsh-go-market**。上游桌面/网页行为保持不变。

- 本分支版本：`1.2.1`
- 目标宿主：dsh-Go 内置 DSH `0.2.1-rc.4`（Node 24.22.1，PRoot / Direct 两种引擎）
- 许可：Apache-2.0，保留上游 `LICENSE` / `NOTICE` 与署名

## 1. 适配结论

| 层 | 上游假设 | dsh-Go 现实 | 本分支处理 |
|---|---|---|---|
| 宿主面 | Web / Electron 桌面 | Android rootfs，App 管理引擎 | `lib/android.js` 识别 `DSH_GO_RUNTIME_ROOT`（PRoot+Direct 都有）、`DSH_GO_DIRECT_*`、PRoot guest 标记 `/etc/dsh-app`、`/opt/dsh-go`、Direct 物理 `<rootfs>/...`、rootfs 路径特征；强制 web 面 |
| 重启 | 自己 spawn `dsh web` / 杀进程 | App 按 pid 文件停引擎，PRoot 忽略 SIGTERM | 所有重启入口（`applyShouldRestart`、`settleMayRestart`、`host.scheduleRestart`、`scheduleCleanupRestart`、`restartNote`）在 Android 上返回 `skipped_android`，提示去「设置 › 本机引擎」重启 |
| shim | 写 `dsh.cmd` / `dsh.ps1` / `dsh` | 没有 cmd/ps1；`/usr/local/bin/dsh` 是 App 的 sh 包装脚本 | `patchShim` / `patchAllShims` 跳过；`silenceCmdFlash` 整段跳过（不往宿主 `bin.js` 注入 sidecar） |
| 路径 | npm 全局 `@deepseek-ai` | `/opt/dsh/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`；Direct 下是物理路径 | `findAiBase` 走 argv 祖先 + `DSH_GO_RUNTIME_ROOT` 映射；宿主版本从 `<aiBase>/../..` 读 `@deepseek-ai/dsh/package.json` |
| 安装 | `postinstall` 写 profile | pnpm 11 设备上不跑插件 postinstall，且会 `ERR_PNPM_IGNORED_BUILDS` | 移除 `postinstall`；注册与 profile 自愈在 `apply()` 里完成；目录/tarball 两种安装都验证 |
| UI | Web dock | App 原生界面 + 网页岛 | 新增 `dshGo` 清单（清洗面板 + 输入框状态条）与 `ctx.dshGo` 实现；网页 dock 保留 |

### 补丁兼容矩阵（86 条）

在 `work/sandbox-go/prefix`（官方 rc.4 + dsh-Go 15 个 runtime diff / 25 个 pin 哈希全命中）上验证：

- **文本层零漂移**：86 条补丁的 240 个替换项，命中数与官方 rc.4 逐条一致；dsh-Go 新增行丢失 0。
- **应用结果**：71 applied / 13 na / 1 missing_file / 1 skipped，0 pending / 0 drifted；
  56 文件改写，46/46 JS `node --check` 通过；还原后 57 个目标文件逐字节一致。
- **3 条语义变体（已合入）**：
  - **F1 #67**：dsh-Go `input-recovery` 在 `preStep` 新增未设防的 `decision.messages.filter`，
    早于 #67 守卫 → 追加数组兜底变体；
  - **F2 #68**：rc.4 把 `append` 行改成 runtime-context 分支（旧变体成死变体）→ 追加 `for..of` 兜底；
  - **F3 #61**：Direct 引擎对执行域外路径是 `FS_IO_ERROR`（启动模式限制，不是审批）→ 文案改为“不要重试”。
- **15 条结构性 skip**：桌面专用 7、hooks 包缺失 4、liangshen preset 2、用户自建 preset 1、拆除型 1。
- **未启用**：F4（定时任务授权绕过）默认保留 dsh-Go 的 `userQuestions` 闸门；Direct 的
  `dsh-fs-local` 硬拒绝不打补丁（会破坏引擎不变量）。

## 2. Android 原生界面

`package.json.dshGo`（协议 v1，`minApp: 1.0.3`，App 当前 1.0.9）：

- `panels`: `clean`（标题“清洗”，placement `session.tab` / `chat.panel` / `features`）
- `composer.strip`: `status`（点击打开清洗面板）

`lib/dshgo.js`：

- `ctx.inject(['dshGo'])` 注册（没有桥接的主机静默跳过）；
- 面板显示 已清洗 / 待清洗 / 漂移，按钮 清洗 / 还原 / 刷新；
- 清洗/还原走 `pending` + `result` 延后效果（≤60s），完成后 `toast` 并刷新数据；
- 状态条显示 `已清洗 N/M`；
- 视图 782 B / 10 节点，远低于 32 KiB / 120 节点上限；
- 可选补丁漂移（#88 依赖 #87 的顺序噪声）不计入面板告警。

`lib/config-schema.js` 动态解析宿主 `@deepseek-ai/schemastery` 导出 `Config`，让 App 显示原生设置
表单；解析不到时省略（网页设置与命令不受影响）。注意：rc.4 的 `--dump-config-schema` 对
`cordis.patch.yml` 的 insert 条目本身会报 `unrecognized Loader tree carrier`（上游原版同样如此），
这是 DSH rc.4 的限制，不是本分支引入。

## 3. 安装与使用

见 [README-ANDROID.md](../README-ANDROID.md)。摘要：

```sh
# App 终端（本机引擎）
mkdir -p /root/.dsh/dsh-go/plugins
cp -r /sdcard/Download/dsh-purge /root/.dsh/dsh-go/plugins/dsh-purge
cd /root/.dsh/dsh-go/plugins/dsh-purge && bash scripts/install-android.sh
# 或
dsh plugin --profile web add /sdcard/Download/dsh-purge-1.2.1.tgz
```

清洗：`/purge apply` 或原生面板「清洗」；之后到「设置 › 本机引擎」重启。
还原：`/purge revert` 或面板「还原」。详细命令 / 规则 / 技能见 README。

## 4. 市场提交

已按 [dsh-go-market 提交要求](https://github.com/ccch1mneyyy/dsh-go-market#提交插件)准备：

- `package.json` 是 DSH bundle（`dsh.bundle.patch` 存在）、`Apache-2.0`（OSI）、无安装生命周期脚本、
  `dshGo` 有真实插槽（`composer.strip` + `panels`）、压缩 ~2 MiB / 展开 ~4 MiB；
- `scripts/market-preflight.mjs` 离线自检并生成市场条目（脚本与条目已移除）；
- 发布与 PR 步骤、改名检查清单见 `docs/MARKET-SUBMISSION.md`（已随 npm 发布一起移除）。

市场预期风险标记：`medium`（`shell` + `filesystem`；插件确实要 spawn 子进程并改写宿主文件），
不单独阻止上架。安装生命周期脚本、原生二进制均无。

**提交状态（2026-11-04）**：

- npm 已发布：<https://www.npmjs.com/package/dsh-purge>，`latest = 1.2.1`
  （integrity `sha512-ats54VEIia9VH…`，与本地 tarball 一致；首次发布触发了 npm staged publishing，
  开启 2FA 后已转为正式版本）
- dsh-go-market PR：<https://github.com/ccch1mneyyy/dsh-go-market/pull/14>
  - `catalog` 检查 **success**
  - `auto-merge` 检查失败：上游仓库的 auto-merge job 报
    `GraphqlResponseError: Resource not accessible by integration`（job 的 `GITHUB_TOKEN`
    没有合并权限），不是条目内容问题；已在 PR 留言请维护者手动合并或修 workflow
- npm 包名 `dsh-purge` 已归本账号（panda11445）；上游署名/许可保留在 `package.json`、`LICENSE`、`NOTICE`

**安全提醒**：调试过程中的 npm token 与 GitHub classic PAT 都曾出现在聊天记录里，
建议合并完成后到 npm Access Tokens / GitHub Settings → Tokens 撤销并重建。

## 5. 验证记录

| 验证 | 结果 |
|---|---|
| 官方 rc.4 补丁矩阵（86 条） | applied 4 / pending 66 / drifted 1(#88 可选) / missing 7 / skipped 1 / na 7，strict 违规 0 |
| dsh-Go 副本矩阵 | 与官方逐条一致（0 行差异），strict 0 |
| 应用/还原 round-trip（两种树） | 13/13 阶段 PASS，57 文件备份 → 71 applied → 0 pending → 还原逐字节一致 |
| Android 环境模拟 | 35/35 PASS（PRoot/Direct/DSH_GO_RUNTIME_ROOT/路径特征四种识别；桌面/shim/重启均被拦） |
| 原生 dshGo 面板 | 14/14 PASS（注册、视图预算、数据、效果、7 种缺失/半残桥接不崩） |
| 插件单测 | 4/4 PASS（`npm run test:dshgo`） |
| tarball 安装 | PASS（`dsh plugin --profile web add dsh-purge-1.2.1.tgz`，profile bundle 已登记） |
| 引擎启动 + 网页客户端 | PASS（`dsh web` 启动；index HTML 含 `dsh-purge/client.js`） |
| 安装脚本 | PASS（目录复制 + 注册 + `--status`） |

测试脚本在 `work/sandbox/`（工作区，非发布包）：`./work/sandbox/run-all.sh`，报告
`work/notes/harness-last.json`。


### 真机验证（2026-11-03）

设备：Xiaomi 15（24129PN74C），Android 16，arm64-v8a，dsh-Go 1.0.9，内置 DSH 0.2.1-rc.4，PRoot 模式。

| 步骤 | 结果 |
|---|---|
| `adb push dsh-purge-1.2.1.tgz /sdcard/Download/`，Guest 内 `dsh plugin --profile web add …` | PASS（pnpm 11.28.5，profile bundles 增加 `dsh-purge`） |
| 最终安装形态：解包到 `/root/.dsh/dsh-go/plugins/dsh-purge` 后 `dsh plugin --profile web add <目录>` | PASS（profile 依赖 `link:/root/.dsh/dsh-go/plugins/dsh-purge`；重置引擎保留该目录，只需重新 add） |
| 引擎重启后 App「插件」列表 | PASS（21 → 22 个；详情显示 `原生界面 · 正常`、状态条/面板、3 个组件 `dsh-purge/redteam*`） |
| 原生「清洗」面板（全部功能 › 清洗） | PASS（已清洗 4 / 待清洗 66 / 漂移 0，宿主 0.2.1-rc.4，模式 dsh-go / Android，补丁根 `/opt/dsh/node_modules/@deepseek-ai`） |
| 面板点「清洗」 | PASS（约 15s 后 71 / 0 / 0，绿色「补丁已就位」） |
| 设置 › 本机引擎 › 重启 | PASS（引擎正常启动，插件 globals `__dshPurgeHungPrompt`/`__dshPurgePrepareAssemble` 就位） |
| 重启后 `--status` | PASS（71/86 applied，0 pending；宿主版本 0.2.1-rc.4；shim 跳过） |
| 真机发现并修复的问题 | 1.2.1：PRoot 下 `DSH_GO_RUNTIME_ROOT` 指向 guest 外物理路径，原实现只认映射后路径导致找不到 `/opt/dsh/...`；改为 guest 路径与 rootfs 映射路径都探测 |

未做：网页版 dock 的真机点击验证（App 网页版入口未测试）；原生设置表单的字段编辑（`Config` 已导出，列表页正常）。


### 2026-11-14 账号/供应链加固与发布暂停

- npm 包名改为 scoped：`@panda11445go/dsh-purge`（旧 `dsh-purge@1.2.1` 已从 registry 移除，只剩 `0.0.0-stage`）
- 加固：`publishConfig.access=public`；移除 `dsh.install` 指向的上游可变 tarball；新增 `SECURITY.md`；确认无 install scripts、无密钥泄露
- 市场 PR #14（基于已消失的 1.2.1）已关闭，待新包公开后重开只含 `plugins/@panda11445go__dsh-purge.json` 的 PR
- npm 新账号在 2FA/恢复码操作后进入 **72 小时安全暂停**（发布与 token 创建暂停，安装不受影响），预计 2026-11-17 21:54 解除；已设重试提醒

## 6. 已知限制

1. **没有真机 Android 运行证据**：本环境只能模拟 dsh-Go 的路径/env（PRoot 与 Direct 的
   `DSH_GO_RUNTIME_ROOT`、rootfs 标记、物理路径映射），不能安装 APK、不能验证 App 的原生
   面板渲染、网页岛生命周期与引擎重启按钮。
2. **网页岛/路由守卫未端到端验证**：只验证了官方 Web 客户端成功打包并下发 `dsh-purge/client.js`；
   App 内网页岛的 12 秒回退、route-guard 对 `ctx.webServer` 路由的门控需要真机。
3. **配置原生表单**：`Config` 已导出，但 rc.4 的 `--dump-config-schema` 对 bundle insert 条目报错
   （上游原版同样），App 的插件设置页能否完整投影需真机确认。
4. **自动更新**：`autoUpdateOnStart` 默认 false；本分支未改上游的 GitHub 更新逻辑，Android 上
   不建议开启（更新拿到的是上游包名/结构）。
5. **Drill 全套**：原生面板只做 Clean；Drill/规则编辑器/提示词编辑器仍走网页版（App 的
   「网页版」入口）。
6. **市场扫描**：本分支只做了离线近似自检；最终以市场 CI 的 `check`/`build` 为准。

## 7. 文件清单（相对本仓库）

| 文件 | 作用 |
|---|---|
| `lib/android.js` | dsh-Go/Android 识别、guest→物理路径映射、重启指引 |
| `lib/dshgo.js` | 原生状态条 + 清洗面板 + 延后效果 |
| `lib/config-schema.js` | 原生设置表单 Config（动态 schemastery） |
| `lib/surface.js` / `lib/core.js` / `lib/host.js` / `lib/settle-policy.js` / `lib/index.js` / `bin/dsh-purge.js` | Android 分支：跳过桌面/shim/闪窗/自重启；rootfs 路径发现；F1/F2/F3 变体；消息 |
| `package.json` | 版本 1.2.1、`engines.dsh`、rc.4 目标、`dshGo` 清单、无 postinstall |
| `scripts/install-android.sh` | App 终端安装/卸载脚本 |
| `scripts/market-preflight.mjs` | 市场提交前离线自检 + 生成条目（已移除） |
| `market/plugins/dsh-purge.json` | 市场条目（已移除） |
| `docs/MARKET-SUBMISSION.md` | 发布/PR/改名流程（已移除） |
| `README-ANDROID.md` | 用户在 dsh-Go 上的安装、使用、排查 |
| `test/dshgo-panel.test.mjs` | 原生面板单测 |

## 7. DSH 0.2.2-rc.1 / dsh-Go 1.0.16（2026-11-14 真机）

设备 Xiaomi 24129PN74C（Android 16，arm64），dsh-Go 1.0.16，内置 DSH 0.2.2-rc.1 / Node 24.22.1 /
rootfs `r15-…-cadf10a5c5d3`，proot 启动。

- **宿主迁移**：0.2.2 把审批执行管线拆到 `dsh-tools/lib/types/pipeline.js`，PTC/run_code 移到
  `@deepseek-ai/dsh-tool-executor-ptc`，交付物提示词移到 `@deepseek-ai/dsh-deliverable-file-references`。
  `lib/core.js` 的 targetFiles 改成按新包是否存在选择路径，并新增 8 条变体：
  #14（`escalationDisplayReason` 辅助函数）、#17（`requirePresent` 重构）、#40（assemble 结果带 `tools`）、
  #54/#60/#62（新包路径）、#74（`dshGoRecall.prepare`）、#86（`dshGoDeletion.assertAdmit`）。
- **实测**：真机宿主 `--status` → 63/86 applied、8 drifted；apply → **71/86、0 待清洗、0 漂移**；
  改动的 JS 全部 `node --check` 通过；本地 apply→revert round-trip 通过（还原 57 个目标文件）。
- **dshGo 桥接 0.4**：`#register` 用 loader 入口名在包树里找同名 `package.json`，旧安装的裸名
  `dsh-purge` 与 scoped 包名 `@panda11445go/dsh-purge` 不一致，原生面板报
  `call ctx.dshGo.* as a method from a plugin context`。1.4.1 增加
  `migrateLegacyProfileIdentity()`：把 profile 依赖、`dsh.profile.bundles`、`cordis.patch.yml` 的
  insert 名迁移到 scoped 名，并补 `node_modules/@panda11445go/dsh-purge` 入口链接；安装脚本在
  `dsh plugin add` 前也跑一次。真机重启后状态条与面板恢复正常。
- **界面占用**：清洗完成（0 待清洗、0 漂移）时不显示输入框状态条，需要处理时只显示
  `漂移 N` / `待清洗 N`；原生面板压缩为「一行摘要（含宿主版本）+ 两个按钮」，摘要行
  形如 `已清洗 71/73 · 0.2.2-rc.1`。
- 真机验证：面板点「清洗」进入 pending 后正常完成；`dshGo 原生界面注册失败` 日志不再出现。

## 8. 维护与兼容性框架（1.5.0）

- `lib/compat.js`：宿主版本矩阵（`HOST_MATRIX`）、桥接 0.4 判定、入口身份检查、
  `readProfileEntry`/`readBridgeVersion`；`--status` 增加兼容性行，`--doctor` 输出
  宿主/桥接/入口/insert/漂移的全量诊断。
- `scripts/compat-matrix.mjs`：多宿主 status/apply/syntax 矩阵，失败退出码 1；
  `scripts/capture-host-snippets.mjs`：从真实宿主抓片段生成回归 fixture；
  `scripts/release-check.mjs`：包名/版本/目标覆盖/安装脚本/调试探针/market/tarball 门禁。
- `test/`：兼容模型、0.2.2 片段回归、profile 迁移（幂等）单测；`npm test` 13 项通过。
- `.github/workflows/ci.yml`：Node 20/22 单测 + 入口语法 + 发布检查。
- 文档：`docs/COMPATIBILITY.md`（矩阵、状态语义、新宿主适配步骤）、
  `docs/DEVELOPMENT.md`（补丁模型、调试、发布清单、版本策略）。
