# 兼容性与升级保障

插件改的是宿主的官方文件，宿主一升级，原文变了，pattern 就会失效。这个仓库用四层机制
把「升级后静默失效」变成「升级前就能发现、可回归、可发布」：

1. **版本矩阵**：`lib/compat.js` 的 `HOST_MATRIX` 声明回归过哪些 DSH 版本；`package.json` 的
   `dshTargets` 必须覆盖矩阵里所有 `supported` 版本（`scripts/release-check.mjs` 会检查）。
2. **运行时诊断**：`--status` 显示宿主版本、dshGo 桥接版本与兼容性判断；`--doctor` 检查
   profile 入口名、scoped 链接、insert 与漂移补丁。入口名 ≠ 包名时直接告警（dshGo 0.4 的硬性要求）。
3. **矩阵回归**：`scripts/compat-matrix.mjs` 对每个宿主树跑 status / apply，漂移或清洗后
   仍有 pending 就失败；`--apply --syntax` 还会对目标 JS 做 `node --check`。
4. **片段回归**：`test/fixtures/dsh-<版本>-patch-snippets.json` 存真实宿主片段，
   `test/patch-variants.test.mjs` 断言每个变体仍能命中真实原文。已提交
   `0.2.2-rc.1`（8 条漂移补丁）与 `0.2.1-rc.4`（26 条补丁，共 65 个片段）两份，
   合计约 27KB——CI 不需要宿主树、不需要网络，每次 `npm test` 都会同时回归两代宿主。
   宿主升级后重新抓片段即可。

## 当前矩阵

| 宿主 DSH | 状态 | 说明 |
|---|---|---|
| `0.2.2-rc.1` | supported | dsh-Go 1.0.16 内置；privacy 管线拆到 `dsh-tools/lib/types/pipeline.js`、PTC 移到 `dsh-tool-executor-ptc`、交付物提示词移到 `dsh-deliverable-file-references` |
| `0.2.1-rc.4` | supported | dsh-Go 1.0.9–1.0.14 内置 |
| `0.2.1-rc.5` | supported | npm 上游 |
| `0.2.1-rc.2` | supported | 旧版兼容 |

dsh-Go 侧要求：`dshGo` 桥接 **>= 0.4.0**（协议 v1）。0.4 起 `#register` 用 loader 入口名在
包树里找**同名** `package.json`，所以 profile 依赖名必须是 `@panda11445go/dsh-purge`；
旧安装的裸名 `dsh-purge` 会报 `call ctx.dshGo.* as a method from a plugin context`。
插件启动时会调用 `migrateLegacyProfileIdentity()` 自动迁移，安装脚本也会在 `dsh plugin add`
之前跑一次。

## 补丁状态怎么读

`--status` 每条补丁的状态：

| 状态 | 含义 | 处理 |
|---|---|---|
| `applied` | marker 在，或替换后已落地 | 无 |
| `pending` | pattern 仍在、marker 不在 | `--apply` |
| `drifted` | 文件在、marker 不在、pattern 一条都不中 | **宿主原文变了**，补变体 |
| `missing_file` | 目标文件不存在（宿主拆分/未安装该包） | 补 targetFiles 映射或标 optional |
| `na` | 该布局/该版本本来没有这个补丁 | 无 |
| `skipped` | 撤销型补丁、本来就没加过，或 strictFiles 布局不适用 | 无 |

`drifted` 是唯一需要人工跟进的信号，也是兼容性门禁的失败条件。

## 支持新宿主版本（升级 dsh-Go / DSH）

1. **抓宿主树**（只读）：
   ```sh
   # 手机 rootfs 内（App 终端）
   tar czf /sdcard/Download/host-0.2.2.tgz -C / \
     opt/dsh/node_modules/@deepseek-ai opt/dsh/node_modules/@earendil-works opt/dsh/package.json
   adb pull /sdcard/Download/host-0.2.2.tgz .
   mkdir -p /tmp/host-0.2.2 && tar xzf host-0.2.2.tgz -C /tmp/host-0.2.2
   ```
2. **看漂移**：
   ```sh
   node scripts/compat-matrix.mjs --host /tmp/host-0.2.2
   # 输出 drifted 的补丁号；非 0 退出码表示需要适配
   ```
3. **补变体**（原则：只加不删，保证旧宿主仍可用）：
   - 文件搬走/拆包：改 `lib/core.js` 的 `targetFiles`（`firstExisting` / `allExisting` / 版本条件），
     新增文件键；
   - 代码改写：给对应 `replacements` **追加**一个 `{ pattern, replace }` 变体，
     pattern 用新原文，replace 保持原语义并保留 marker 注释；
   - 提示词文案变了：同样加变体，不要改旧 pattern。
4. **更新矩阵**：`lib/compat.js` 的 `HOST_MATRIX` 加一行；`package.json` 的
   `dshTarget`/`dshTargets` 同步；README/PORT-REPORT 记录。
5. **抓片段、跑回归**：
   ```sh
   node scripts/capture-host-snippets.mjs --host /tmp/host-0.2.2 --version 0.2.3-rc.1
   npm test
   node scripts/compat-matrix.mjs --host /tmp/host-0.2.2 --apply --syntax
   ```
6. **发布**：`node scripts/release-check.mjs --require-tarball` → 把 tgz + `latest.txt` + `sha256.txt` + `install*.sh` 传到 GitHub Release（不再 npm publish）。

## 兼容性兜底策略

- **未测试宿主**：仍允许 `--apply`，但 `--status`/`--doctor`/原生面板摘要都会告警；
  建议先跑矩阵，不要直接全量清洗。
- **漂移时不清洗**：`--apply` 只写能命中的补丁，drifted 不会硬改；`--revert` 按备份还原。
- **入口身份迁移**：旧 profile 自动迁移，失败时 `--doctor` 给出重跑安装脚本的建议。
- **发布门禁**：`release:check` 检查包名/版本/目标覆盖/安装脚本/调试探针/tarball 一致性。
- **片段只存片段**：不提交整棵宿主树（版权、体积、CI 可复现性都更差）；片段是 pattern 级别的
  回归锚点，apply 级别的验证交给 `compat-matrix` 在本地/发布前跑。`0.2.1-rc.5`、`0.2.1-rc.2`
  目前只有矩阵声明、还没有片段锚点，补宿主后可各加一份。
