# dsh-purge for dsh-Go（Android 适配版）

> **⚠️ 原作者：[YuJunZhiXue](https://github.com/YuJunZhiXue)** ·
> 原项目：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（Apache-2.0）。
> **本仓库是非官方移植分支（二次开发）**，包名 `@panda11445go/dsh-purge`（只用于打包，不发布到 npm），只做
> [ccch1mneyyy/dsh-Go](https://github.com/ccch1mneyyy/dsh-Go) **Android 本机引擎**适配。
> 与原作者无隶属关系，不代表原作者立场；上游功能与支持以原仓库为准。
> 署名要求与改动范围见 [NOTICE](NOTICE)。

本移植版的目标是让上游插件在 dsh-Go 的 **Android 本机引擎** 里安装、运行、清洗和还原；
上游的官方 Web / 桌面版行为保持不变。

## 快速开始（两种安装方式）

App → **全部功能（网格图标）→ 终端**，任选一条：

```sh
# ① 命令安装（推荐）：从 GitHub Release 拉最新版并安装
sh /sdcard/Download/install-in-app.sh --latest

# ② 本地包：先把 panda11445go-dsh-purge-<版本>.tgz 放进「下载」，再执行
sh /sdcard/Download/install-in-app.sh
```

不想用脚本时，命令安装等价于：

```sh
dsh plugin --profile web add https://github.com/panda11445/dsh-purge-go/releases/latest/download/panda11445go-dsh-purge.tgz
```

装完到「设置 › 本机引擎」重启一次；状态条 / 面板（全部功能 › 清洗）会出现。
安装器会自动处理 pnpm 11 的构建批准，不需要 `pnpm approve-builds`。细节见 [安装](#安装)。

> 上游署名要求：本分支基于 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
> （Apache-2.0，见 `LICENSE` / `NOTICE`）。二次分发请保留署名，不要当成原创或用于转售。
> 仅用于你拥有管理权限的本机 Harness、授权实验环境和合规靶场。

## 适配了什么

dsh-Go 把官方 DSH 装进 App 自带的 Linux rootfs（当前内置 `0.2.2-rc.1`，旧版本为 `0.2.1-rc.4`），
由 App 拉起/重启引擎，再用 `runtime/patches/*.diff` 预打一批官方包。上游插件原本假设“npm 全局 + 桌面/网页 + 自己重启”，
在手机上会踩到这些差异：

| 差异 | 本分支的处理 |
|---|---|
| 宿主是 `dsh-Go / Android`（PRoot 或 Direct 引擎），不是桌面 | `lib/android.js` 以 `DSH_GO_RUNTIME_ROOT`（两种模式都有）为主判据，兼容 PRoot 的 `/etc/dsh-app`、`/opt/dsh-go` 和 Direct 的 `<rootfs>/...` 物理路径；强制 web 面，不碰 asar |
| Direct 引擎下 `/opt/dsh`、`/root/.dsh` 是物理路径 | rootfs 内的 `@deepseek-ai` 发现、备份、DSH_HOME 全部按 `DSH_GO_RUNTIME_ROOT` 前缀映射 |
| 没有 `cmd.exe` / PowerShell / `.cmd` / `.ps1` shim | 跳过 shim 注入、cmd 闪窗处理、桌面 bin 清理 |
| 引擎由 App 管理 | **不自动重启**。清洗只落盘，完成后到 App「引擎」页手动重启 |
| DSH 版本随 dsh-Go 更新（0.2.2-rc.1 / 0.2.1-rc.4） | `dshTarget/dshTargets` 覆盖 0.2.2-rc.1 / 0.2.1-rc.4 / rc.5 / rc.2；0.2.2 的 `types/pipeline.js`、`dsh-tool-executor-ptc`、`dsh-deliverable-file-references` 等迁移路径一并适配 |
| App 原生 UI 看不到网页 dock | 新增 `dshGo` 清单：原生「清洗」面板 + 输入框状态条 + 原生设置表单；网页版 dock 仍可用 |
| pnpm 11 默认不跑包的 postinstall，且会因此让 `dsh plugin add` 失败 | 本分支移除 `postinstall`；注册与 profile 自愈在插件 `apply()` 里完成，tarball 安装可直接成功 |

## dsh-Go 1.0.16 / DSH 0.2.2-rc.1 适配（1.4.1）

- 宿主包迁移：0.2.2 把审批管线拆到 `dsh-tools/lib/types/pipeline.js`，PTC/run_code 移到
  `@deepseek-ai/dsh-tool-executor-ptc`，交付物提示词移到 `@deepseek-ai/dsh-deliverable-file-references`；
  本版补齐了这些目标文件和 8 条新代码/提示词变体。
- 原生界面：dsh-Go 1.0.16 的 `dshGo` 桥接升到 0.4，按 loader 入口名在包树里找**同名** `package.json`。
  旧安装用的裸名 `dsh-purge` 与 scoped 包名 `@panda11445go/dsh-purge` 不一致，会让原生面板/状态条
  报 `call ctx.dshGo.* as a method from a plugin context`。1.4.1 会把 profile 依赖、bundles 与
  `cordis.patch.yml` 的 insert 名自动迁移到 scoped 名，并把入口链接到
  `node_modules/@panda11445go/dsh-purge`。
- 显示占用：1.4.1 起清洗完成（0 待清洗、0 漂移）时不显示输入框状态条，只有
  `漂移 N` / `待清洗 N` 才出现。1.5.1 改成默认常显摘要（`stripMode: auto`），
  旧行为保留为 `stripMode: alert`；宿主缺失时状态条也会显示 `未找到宿主`，
  不再和错误一起消失。原生面板压缩为「三项指标 + 一行提示 + 三个按钮 + 一行宿主信息」。

## 宠物位置与内置「插件」胶囊

dsh-Go 1.0.16 的宠物会站在输入框上方**最靠上的栖息层**上：内置「插件」胶囊行也算一层。
装了本插件后这一行会出现，宠物会被抬高，看起来像悬浮。想让宠物贴着输入框，可在引擎里
的 `$DSH_HOME/dsh-go/ui.json` 隐藏内置插件胶囊（面板仍可从「对话详情 › 插件」进入）：

```json
{ "version": 1, "hide": ["pluginCapsule"] }
```

这是 App 层设置、不属于插件包；改完重开 App 生效。隐藏后输入框上方只保留输入框本身，
宠物会重新站在它的顶边。

## 环境要求

- dsh-Go **本机引擎** 已安装并启动过（App 内“安装运行环境”，约 1 GB）。
- 只连 SSH / 中转主机时不适用：那是远程主机自己的 DSH，请在那台机器上按上游方式安装。
- 本分支面向 DSH `0.2.2-rc.1`（dsh-Go 1.0.16 内置）与 `0.2.1-rc.4`（旧版本）。升级 dsh-Go 后若宿主包
  大改，状态页会出现 `drifted`，按提示更新补丁即可。

## 维护与兼容性

- 兼容矩阵与升级流程见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)；
  开发/补丁模型/发布清单见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
- 排障先跑：
  ```sh
  node /root/.dsh/dsh-go/plugins/dsh-purge/bin/dsh-purge.js --status
  node /root/.dsh/dsh-go/plugins/dsh-purge/bin/dsh-purge.js --doctor
  ```
  `--doctor` 会检查宿主/桥接版本、profile 入口名、scoped 链接、insert 与漂移补丁。
- 宿主升级后：导出 rootfs 的 `opt/dsh/node_modules/@deepseek-ai`，跑
  `node scripts/compat-matrix.mjs --host <目录> --apply --syntax`，按输出补变体；
  `npm test` 会校验兼容矩阵、片段回归和 profile 迁移。

## 安装

两种方式，任选其一；装完都要到「设置 › 本机引擎」点一次**重启**。

### 方式一：命令安装（推荐，自动走国内镜像）

App → **全部功能（网格图标）→ 终端**，粘一行：

```sh
sh /sdcard/Download/install-in-app.sh --latest
```

脚本按顺序做四件事：从 **GitHub Release** 查最新版（`releases/latest`，失败再退仓库里的 `latest.txt`）
→ 用 Release 资产的 tarball 地址 `dsh plugin --profile web add` 安装 → pnpm 若把这次安装记成
"待批准"就自动置 `true` 重试一次 → 打印 `--status` 自检并提示重启。

不想用脚本时，等价的一条命令：

```sh
dsh plugin --profile web add https://github.com/panda11445/dsh-purge-go/releases/latest/download/panda11445go-dsh-purge.tgz
```

Release 资产名固定，换版本只改 tag：

```
https://github.com/panda11445/dsh-purge-go/releases/download/v<版本>/panda11445go-dsh-purge-<版本>.tgz
```

#### 变体：GitHub + 国内加速镜像（不用自己的 CDN）

把一个仓库当成镜像目录（release 资产或在仓库里放文件都行）：

```
latest.txt                              # 一行版本号，例如 x.y.z
panda11445go-dsh-purge-<ver>.tgz        # npm pack 产物
```

然后一条命令：

```sh
sh /sdcard/Download/install-in-app.sh --latest --gh panda11445/dsh-purge-go
```

`--gh` 会依次尝试 **ghfast.top → ghproxy.net → gh-proxy.com → 直连 GitHub →
jsDelivr**，取到 tgz 后本地安装并自动释放；tag 本身就是版本号时可以不放
`latest.txt`（用 `main` 这类分支名时必须有）。想看全部候选地址：
`sh install-in-app.sh --gh <owner>/<repo> --print-sources`。

### 方式二：本地包（离线可用）

1. 把 `panda11445go-dsh-purge-<版本>.tgz` 放进手机「下载」目录
   （`adb push panda11445go-dsh-purge-<ver>.tgz /sdcard/Download/`，或用文件管理器拷）。
2. App → 终端：

```sh
sh /sdcard/Download/install-in-app.sh
```

安装器全部参数：

| 命令 | 作用 |
|---|---|
| `sh install-in-app.sh` | 装「下载」目录里最新的 tarball |
| `sh install-in-app.sh --latest` | 从 GitHub Release 查最新版并安装 |
| `sh install-in-app.sh --check` | 只看环境与包，不改动任何文件 |
| `sh install-in-app.sh --reinstall` | 同版本也强制重装（先卸再装） |
| `sh install-in-app.sh --uninstall` | 卸载 |
| `sh install-in-app.sh <url>` / `<path>` | 指定镜像 URL 或本地包 |
| `sh install-in-app.sh --detach` | 安装放后台跑：引擎重载 / 终端断开也不会中断 |
| `sh install-in-app.sh --base <URL>` | 用自建镜像目录（同 `DSH_PURGE_TARBALL_BASE`） |
| `sh install-in-app.sh --gh <owner>/<repo>[@tag]` | 用 GitHub + 国内加速镜像（自动回退多个代理） |
| `… --print-sources` | 只打印候选镜像地址，不安装 |
| `sh install-in-app.sh --mirror` | 只用镜像：镜像没有可用版本就报错，不回退本地包 |
| `sh install-in-app.sh --keep` | 装完保留安装包（默认装完自动删除） |
| `sh install-in-app.sh --plain` | 关掉颜色与动画（日志、截图里用） |
| `sh install-in-app.sh --verbose` | 实时显示 pnpm 原始输出（默认收进日志） |

默认装完会**自动删除**下载目录里用过的 tarball（`--keep` 保留）；装到一半失败不会删，
方便重试。镜像源可以是任意静态目录（OSS/COS/CDN/GitHub Release/局域网 HTTP），约定两个文件：

```
<base>/latest.txt                              # 一行版本号，例如 x.y.z
<base>/panda11445go-dsh-purge-<版本>.tgz       # npm pack 产物
<base>/sha256.txt                              # 可选：`<sha256>  <文件名>`，用于校验
```

安装器会先校验 gzip 完整性；有 `sha256.txt` 时再比对哈希，不通过就换下一个镜像，
避免加速站把包截断（实测 ghproxy 出现过 2.0MB 只回 1.1MB 的情况）。

指向它即可纯镜像安装，不再需要本地 tarball：

```sh
sh install-in-app.sh --latest --base https://your.cdn/dsh-purge
# 或
DSH_PURGE_TARBALL_BASE=https://your.cdn/dsh-purge sh install-in-app.sh --latest
```

安装器顺序：`--base` / 环境变量 → GitHub Release（含国内加速镜像）→ 本地包。
版本只会升不会降：镜像或本地包低于已装版本时直接中止（`--reinstall` 才允许降级）。

安装器是逐步骤的进度视图：`[1/6] 环境 → [2/6] pnpm 配置 → [3/6] 定位包 →
[4/6] 安装（带计时）→ [5/6] 自检 → [6/6] 完成`，每步一行 `✓/⚠/✗`；
安装阶段的 pnpm 输出默认收进 `$TMPDIR/dsh-purge-install.log`，失败才打印末尾 14 行。

> 为什么不点插件市场：App 的市场只列官方与已上架条目。本包不发布到 npm，市场里点不到它；
> 终端是 DSH 自带的原生安装入口，链路是 `dsh plugin add → pnpm`，不经过任何模型。

### 装完自检

```sh
node /root/.dsh/profiles/web/node_modules/@panda11445go/dsh-purge/bin/dsh-purge.js --status
```

应看到 `宿主 / surface web（dsh-Go / Android）`、`插件根` 指向 rootfs 里的 `@deepseek-ai`，
以及补丁的 `applied/pending/drifted` 计数。`插件根` 找不到时见文末排查。

## 使用

### 原生界面（App 内）

- **清洗面板**：`对话详情 › 插件`、`全部功能` 或聊天页「插件」弹层 →「清洗」。
  面板显示 已清洗 / 待清洗 / 漂移 三个数，按钮：**清洗**、**还原**、**更新**。
- **检查更新**：dsh-Go 没有插件更新协议（清单顶层只有 `v/minApp/title/icon/wants/assets/
  contributes/capabilities`），所以更新由插件自己做：打开面板时后台问 GitHub Release 的 latest（失败回退 latest.txt），
  有新版就在摘要里加 `可更新 x.y.z`；点「更新」会走镜像 tarball 安装并自动处理 pnpm 批准。
  纯检查不发请求、不自动安装；`checkUpdateOnStart` 可关。
- **输入框状态条**：默认常显 `已清洗 71/73` 这类摘要，点一下打开清洗面板。异常时优先显示
  `漂移 N` / `待清洗 N` / `未找到宿主`，摘要让位。想省掉输入框上方那一行就把
  `stripMode` 设成 `alert`（只在异常时出现）或 `off`（从不显示，只留面板）；默认 `auto`。
- **设置表单**：`插件详情` / `设置 › 引擎参数 › 插件` → dsh-purge，可改启用、自动重试、
  最大重试次数、锚点模式、输入框状态条模式等（与 `cordis.patch.yml` 的 config 字段一致）。
- **斜杠命令**（原生输入框 `/` 菜单）：
  - `/purge status` — 状态
  - `/purge apply` — 清洗（落盘，需重启引擎）
  - `/purge revert` — 还原
  - `/purge uninstall` / `/purge edit` / `/purge help`
  - `/rules` — 规则集；`/skills` — 用户 Skill；`/rewind` — 回退
- **给模型的工具**：`purge_status` / `purge_apply` / `purge_revert`（模型可在对话里调用）。

清洗后到 App「设置 › 本机引擎」点「重启」。插件**不会**自己杀进程或 `dsh web` 重启，避免和 App 的
进程管理抢。

### 网页版（Drill / 规则编辑 / 完整 dock）

App 的「网页版」入口打开官方 Web UI 后，右上角 dsh-purge 按钮、Clean/Drill 双页、提示词编辑器、
规则集等和上游一致。网页版插件（`client.js`）走 dsh-Go 的网页岛 /「在网页版打开」降级路径，
不影响原生面板。

## 重置引擎与升级

- 「重置引擎」默认保留 `root/.dsh/dsh-go`（插件目录）与 skills，但**不保留** `root/.dsh/profiles`。
  重置后插件文件还在，安装记录没了：重新跑一遍 `scripts/install-android.sh`（或
  `dsh plugin --profile web add /root/.dsh/dsh-go/plugins/dsh-purge`）即可。
- 装到 `/opt/**` 的改动会被运行时升级覆盖；插件目录放 `/root/.dsh/dsh-go/plugins/` 才保留。
- dsh-Go 升级会整体替换 DSH prefix，`.dshpurge.bak` 随之消失；重启后重新 `/purge apply` 即可。
  升级后若状态页出现 `drifted`，说明官方原文变了，需要更新补丁 pattern（见上游 issue 流程）。

## 还原与卸载

```sh
# 只还原宿主补丁（保留插件与提示词文件）
node /root/.dsh/dsh-go/plugins/dsh-purge/bin/dsh-purge.js --revert

# 卸载插件（先还原再移除）
bash scripts/install-android.sh --uninstall
```

还原后重启引擎。`prompt-inject.md`（`$DSH_HOME/prompt-inject.md`）是用户文件，不会被还原删掉。

## 与上游的差异清单（给维护者）

- `lib/android.js`：宿主识别、重启指引、Android 标记。
- `lib/surface.js`：Android 上强制 `web`，忽略桌面路径误判。
- `lib/core.js`：跳过 shim / cmd 闪窗 / 桌面清理；Android rootfs 的 `@deepseek-ai` 发现；
  `applyRuntimeEnv` 不在 Android 上猜桌面 DSH_HOME。
- `lib/settle-policy.js`：Android 上禁止自动重启与 settle 重启。
- `lib/dshgo.js`：`ctx.dshGo` 原生状态条 + 清洗面板 + 延后效果。
- `lib/config-schema.js`：原生设置表单的 `Config`（动态解析宿主 schemastery，解析不到就省略）。
- `package.json`：`dshGo` 清单、`engines.dsh`、rc.4 目标。
- `scripts/install-android.sh`、本文件。

## 排查

| 现象 | 处理 |
|---|---|
| `插件根未找到` | 在终端跑 `ls /opt/dsh/node_modules/@deepseek-ai`；有的话 `export DSH_BASE=/opt/dsh/node_modules/@deepseek-ai` 再试 |
| 面板显示漂移 `drifted` | dsh-Go 升级换了官方原文；先 `/purge apply` 看哪些补丁失配，再更新 `lib/core.js` 的 pattern |
| 清洗后没变化 | 没重启引擎。到「设置 › 本机引擎」重启；模型侧提示词在会话重建后生效 |
| 引擎起不来 | 终端执行 `node …/bin/dsh-purge.js --revert`，再到「设置 › 本机引擎」重启 |
| 安装时 pnpm 提示 ignored build scripts / ERR_PNPM_IGNORED_BUILDS | 这是旧包（带 postinstall）才会出现；本分支已移除 postinstall，重装本分支的包即可 |
| 装任何插件都报 `bad indentation of a mapping entry`，指向 `allowBuilds` 里的 `@panda11445go/dsh-purge` | 1.5.1 及更早的自愈会在 `pnpm-workspace.yaml` 里写裸 `@` 键（YAML 保留符）。1.5.2 已修；旧版手动把该键用双引号包成 `"@panda11445go/dsh-purge": true` 即可 |
| 装插件报 `ERR_PNPM_IGNORED_BUILDS`，且 `allowBuilds` 里出现一行 `'@panda…@file:…tgz': set this to true or false` | pnpm 11 把这次 file: 安装记成待批准。把那一行结尾改成 `true` 再重跑，或直接用 `install-in-app.sh`（会自动改并重试） |
| SSH / 中转主机没有面板 | 原生插槽只在本机引擎（有 dsh-go 桥接）出现；远程主机按上游方式装，用网页版 |

## 许可与免责

Apache-2.0。保留上游 `LICENSE`、`NOTICE` 与署名。本项目只修改你本机、你有权管理的
Harness 安装；不提供对公网目标的扫描/攻击能力，不用于游戏作弊或未授权测试。
