# dsh-purge 1.5.2 — 待发布

状态：**已打包、已在真机验证；npm 推送被账号状态挡住（403 账号被临时停用），市场 PR 待 GitHub 凭据。**

> 2026-11-15 推送结果：`npm publish` 返回
> `403 Forbidden - Your account has been temporarily suspended due to a recent security-sensitive action`。
> npm 侧连 `npm profile get` 也 403，属于账号级停用，不是包配置问题。恢复后重跑下面“发布步骤”即可。

## 产物

| 文件 | 说明 |
|---|---|
| `panda11445go-dsh-purge-1.5.2.tgz` | `npm pack` 产物（113 files / 2.0 MiB） |
| `market-entry.json` | dsh-go-market 条目（`version: 1.5.2`） |
| `SHA256SUMS` | 以上两个文件的 sha256 |

仓库内对应位置：`market/plugins/@panda11445go__dsh-purge.json`（scoped 名按市场规则用 `@scope__name.json`）。

## 相对 1.5.0 的变更

1. **输入框状态条默认常显**（`stripMode: auto`）
   - 干净时显示 `已清洗 71/73`，异常时优先显示 `漂移 N` / `待清洗 N`。
   - 旧行为（只在异常时出现）保留为 `stripMode: alert`；`off` 完全不显示。
   - 原生设置表单新增 `stripMode` 字段；`cordis.patch.yml` 与 profile insert 默认写入 `auto`。
2. **宿主缺失不再静默**：`aiBase` 拿不到时状态条显示 `未找到宿主`，原来发空字符串，条和错误一起消失。
3. **修 pnpm allowBuilds 的 YAML 致命错**
   - 旧版把 scoped 键裸写成 `@panda11445go/dsh-purge: true`，`@` 是 YAML 保留指示符，
     pnpm 报 `bad indentation of a mapping entry`，之后该 profile **装任何插件都失败**。
   - 现在只对「安全裸键」保留裸写，scoped / URL / 含冒号的键一律加引号。
4. 文档：修掉「状态条显示摘要」与「干净时不显示」这对自相矛盾的说法；补排查条目。
5. 市场条目文件名修正：市场规则要求 scoped 用 `@scope__name.json`，`market-preflight.mjs`
   原来把开头的 `@` 去掉了；现在保留 `@`，`release-check` 也新增文件名校验。
   `market/plugins/@panda11445go__dsh-purge.json`。
6. **新增 App 内一键安装器** `scripts/install-in-app.sh`（随包发布）。App 终端里一行
   `sh /sdcard/Download/install-in-app.sh` 完成安装，全程不经过模型：
   - 自动修 `allowBuilds` 里裸 `@scope` 键（上面第 3 条的现场版）；
   - 自动处理 pnpm 11 的「待批准」：首次装 file: tarball 时 pnpm 会写
     `'@panda…@file:…tgz': set this to true or false` 并让命令失败，脚本把它置 `true` 后重试一次；
   - 幂等：已是同版本时跳过，`--reinstall` 强制重装，`--check` 只读，`--uninstall` 卸载。

## 验证

```text
node --test test/*.test.mjs        23/23 pass（新增 allow-builds 4 条 + strip 5 条）
node scripts/release-check.mjs     全 PASS（name/version/dshTargets/engines/无安装脚本/
                                   dshGo 清单/market 条目/tarball）
npm pack                           panda11445go-dsh-purge-1.5.2.tgz 2.0 MiB / 113 files
```

真机（Xiaomi 24129PN74C / Android 16 / dsh-Go 1.0.16 / DSH 0.2.2-rc.1）：

- `dsh plugin --profile web add /sdcard/Download/…1.5.2.tgz` → `+ @panda11445go/dsh-purge 1.5.2`
- 重启引擎后输入框上方出现 `🔧 已清洗 71/73`
- 面板 `已清洗 71/73 · 0.2.2-rc.1` 正常
- `sh /sdcard/Download/install-in-app.sh --check` → 环境检查通过
- `sh /sdcard/Download/install-in-app.sh --reinstall` → 卸载 + 安装 + `--status` 全绿

## 发布步骤（需要本机凭据）

```sh
cd dsh-purge-go
npm publish --access public --registry https://registry.npmjs.org
npm view @panda11445go/dsh-purge@1.5.2 dist.integrity   # 记下 sha512-…
```

> 本机 `.npmrc` 的 registry 指向 npmmirror，**必须**用 `--registry` 覆盖，否则市场拉不到。

随后把 `market-entry.json` 作为 `plugins/@panda11445go__dsh-purge.json` 提 PR 到
`ccch1mneyyy/dsh-go-market`（一次 PR 只改一个条目，升级只改 `version`）。
流程见 `docs/MARKET-SUBMISSION.md`。

## 回滚

- 插件侧：`dsh plugin --profile web add <上一个 tarball>` 后重启引擎。
- 宿主侧：面板「还原」或 `node bin/dsh-purge.js --revert`。
- 若 `pnpm-workspace.yaml` 再被写坏，把 `allowBuilds` 里的 scoped 键加双引号即可。
