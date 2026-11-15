/**
 * 原生设置表单（dsh-Go App 的「插件详情 / 引擎参数」）用的 Config 导出。
 *
 * 官方 DSH 用 @deepseek-ai/schemastery 描述 Config。本插件按目录/符号链接安装时，
 * 解析不到 DSH 自己的 node_modules，所以这里在加载期按宿主入口（process.argv[1]）
 * 动态解析 schemastery；解析失败就不导出 Config——网页设置页和命令仍然可用。
 */
import { createRequire } from "node:module";
import path from "node:path";

export function resolveSchemastery(env = process.env, argv1 = process.argv[1]) {
  const req = createRequire(import.meta.url);
  const dirs = [];
  if (argv1) dirs.push(path.dirname(path.resolve(argv1)));
  try {
    dirs.push(process.cwd());
  } catch {
    /* cwd 不可用时忽略 */
  }
  if (env.DSH_HOME) dirs.push(path.join(env.DSH_HOME, "profiles", "web"));
  // 1) 直接从候选目录解析（hoisted 安装时 profile 根就有）
  for (const dir of dirs) {
    try {
      const resolved = req.resolve("@deepseek-ai/schemastery", { paths: [dir] });
      return req(resolved);
    } catch {
      /* 换下一个候选 */
    }
  }
  // 2) pnpm 常把 schemastery 嵌在 @deepseek-ai/dsh/node_modules 里，先定位 dsh 再解析
  for (const dir of dirs) {
    try {
      const dshPkg = req.resolve("@deepseek-ai/dsh/package.json", { paths: [dir] });
      const dshDir = path.dirname(dshPkg);
      const resolved = req.resolve("@deepseek-ai/schemastery", { paths: [dshDir] });
      return req(resolved);
    } catch {
      /* 换下一个候选 */
    }
  }
  try {
    return req("@deepseek-ai/schemastery");
  } catch {
    return null;
  }
}

function text(z, value) {
  return value;
}

/** 与 lib/index.js 的 DEFAULTS 对齐；新增字段时两边一起改。 */
export function buildConfigSchema(z) {
  const yes = (zh, en) => ({ zh, en });
  return z.object({
    enabled: z.boolean().default(true).i18n(yes("启用本插件", "Enable this plugin")),
    autoApplyOnStart: z.boolean().default(false).i18n(yes("启动时自动清洗（需重启才生效）", "Apply on engine start (restart to take effect)")),
    autoUpdateOnStart: z.boolean().default(false).i18n(yes("启动时检查更新", "Check for updates on start")),
    autoRevertOnMissing: z.boolean().default(false).i18n(yes("宿主文件缺失时自动还原", "Auto-revert when host files are missing")),
    injectOnce: z.boolean().default(false).i18n(yes("只注入一次", "Inject once")),
    stripMnemon: z.boolean().default(true).i18n(yes("清理 mnemon 记忆插件注入", "Strip mnemon injections")),
    postPrompt: z.string().default("").i18n(yes("追加提示词", "Extra prompt text")),
    postPromptOrder: z.number().default(5100).i18n(yes("追加提示词顺序", "Extra prompt order")),
    verbose: z.boolean().default(false).i18n(yes("详细日志", "Verbose logs")),
    autoRetry: z.boolean().default(true).i18n(yes("失败自动重试", "Retry on failure")),
    retryMax: z.number().default(3).i18n(yes("最大重试次数", "Max retries")),
    autoContinue: z.boolean().default(false).i18n(yes("自动继续", "Auto-continue")),
    continueMax: z.number().default(3).i18n(yes("最大自动继续次数", "Max auto-continues")),
    continueText: z.string().default("继续").i18n(yes("自动继续发送的文字", "Auto-continue text")),
    capabilityProtocol: z.boolean().default(true).i18n(yes("能力协议提示", "Capability protocol")),
    hooksDenyBypass: z.boolean().default(true).i18n(yes("接管 hooks 拒绝列表", "Take over hooks deny lists")),
    anchorMode: z.string().default("auto").i18n(yes("锚点模式 auto/off", "Anchor mode auto/off")),
    stripMode: z.string().default("auto").i18n(yes("输入框状态条 auto/alert/off", "Composer strip auto/alert/off")),
    checkUpdateOnStart: z.boolean().default(true).i18n(yes("打开面板时检查更新（只提示，不自动装）", "Check for updates when the panel opens (notice only)")),
    subagentControl: z.boolean().default(true).i18n(yes("子代理审批接管", "Subagent approval takeover")),
  });
}

const z = resolveSchemastery();
export const Config = z ? buildConfigSchema(z) : undefined;
export const CONFIG_AVAILABLE = Boolean(z);
