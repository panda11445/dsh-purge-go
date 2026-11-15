/**
 * dsh-Go 原生界面接入（App 的「插件」页签 / 聊天页面板 / 输入框状态条）。
 *
 * 设计原则：
 *   - 只依赖 ctx.dshGo（App 的桥接插件提供的服务）。没有桥接（官方网页版、SSH 主机）时
 *     整个模块是 no-op，网页 dock 和 /purge 命令照旧工作。
 *   - 面板只做三件事：看状态、清洗、还原。Drill / 规则编辑器仍在网页版。
 *   - 所有耗时操作走延后效果（pending/result），避免 3 秒窗口。
 *   - 视图保持 v1 组件，老 App 也能画。
 */
import { isDshGoAndroid } from "./android.js";
import * as core from "./core.js";
import * as reapply from "./reapply.js";
import { cachedUpdate, checkForUpdate, updateNow } from "./update-check.js";

const PANEL_ID = "clean";
const STRIP_ID = "status";
const REFRESH_MS = 30_000;

function toneFor(s) {
  if (s.drifted > 0) return "warn";
  if (s.pending > 0) return "info";
  return "good";
}

function summarize(s) {
  if (!s.aiBase) return "未找到宿主 @deepseek-ai，请确认引擎已安装。";
  if (s.drifted > 0) return `漂移 ${s.drifted} · 清洗后重启 · ${s.host}`;
  if (s.pending > 0) return `待清洗 ${s.pending} · 清洗后重启 · ${s.host}`;
  if (s.applied === 0) return `已还原为官方原文 · ${s.host}`;
  return `已清洗 ${s.applied}/${s.total} · ${s.host}`;
}

async function snapshot(cfg = {}) {
  let state = {};
  try {
    state = await core.gatherState();
  } catch (error) {
    return {
      applied: 0, pending: 0, drifted: 0, total: core.ALL_PATCHES.length,
      host: "", mode: isDshGoAndroid() ? "dsh-go / Android" : "DSH",
      aiBase: "", tone: "bad",
      summary: `读取状态失败：${String(error && error.message ? error.message : error)}`.slice(0, 120),
      driftText: "", hint: "可再点刷新；详细日志见 App 的引擎日志。",
    };
  }
  const applied = Number(state.patches_applied || 0);
  const pending = Number(state.patches_pending || 0);
  const driftRows = (state.patch_status ? Object.entries(state.patch_status) : [])
    .filter(([, v]) => v === "drifted");
  // 可选补丁在干净宿主上也可能显示 drifted（例如 #88 是 #87 的后续补丁，apply 顺序决定）。
  // 面板只把「必需补丁」的漂移当成告警，避免第一次打开就误报上游已改。
  const requiredDrift = driftRows.filter(([id]) => {
    const p = core.ALL_PATCHES.find((x) => String(x.id) === String(id));
    return !p || p.optional !== true;
  });
  const drifted = requiredDrift.length;
  const s = {
    applied, pending, drifted, total: Number(state.patches_total || core.ALL_PATCHES.length),
    host: state.host_version || "未知",
    mode: isDshGoAndroid() ? "dsh-go / Android" : (state.surface === "desktop" ? "desktop" : "web"),
    aiBase: state.ai_base ? String(state.ai_base).replace(/^\/root\//, "~/") : "",
    tone: "info",
    summary: "",
    driftText: "",
    hint: isDshGoAndroid()
      ? "清洗后到 App 的「设置 › 本机引擎」重启引擎生效；本插件不会自己重启引擎。"
      : "清洗后重启 dsh 生效。",
  };
  s.tone = toneFor(s);
  s.summary = summarize(s);
  // 更新提示只读缓存：面板打开时由 register() 在后台刷新，不阻塞渲染。
  const upd = cachedUpdate();
  s.update = upd;
  if (upd.hasUpdate) {
    s.summary = `${s.summary} · 可更新 ${upd.latest}`;
    if (s.tone === "good") s.tone = "info";
  }
  if (drifted > 0) {
    const names = requiredDrift.map(([id]) => {
      const p = core.ALL_PATCHES.find((x) => String(x.id) === String(id));
      return p ? `#${p.id} ${p.name}` : `#${id}`;
    }).slice(0, 6);
    s.driftText = names.length ? `漂移：${names.join("、")}` : "";
  }
  if (!s.aiBase) s.tone = "bad";
  return s;
}

/** v1 视图：指标 + 提示 + 关键值 + 三个按钮。绑定 data.*，数据由 data() 推。 */
export function buildCleanView() {
  return {
    v: 1,
    type: "stack",
    title: "dsh-purge · 清洗",
    children: [
      { type: "callout", tone: { $: "data.tone" }, text: { $: "data.summary" } },
      {
        type: "actions",
        items: [
          { label: "清洗", action: "apply", style: "primary" },
          { label: "还原", action: "revert" },
          { label: "更新", action: "update" },
        ],
      },
    ],
  };
}

function toastOf(text) {
  return String(text).slice(0, 40);
}

/**
 * 状态条显示模式：
 *   auto  — 常显摘要（已清洗 71/73），异常时让位给告警。默认。
 *   alert — 只在漂移 / 待清洗 / 宿主缺失时出现，干净时不占输入框上方那一行（1.4.1 行为）。
 *   off   — 从不显示，只留面板。
 */
export const STRIP_MODES = ["auto", "alert", "off"];

export function normalizeStripMode(value) {
  const mode = String(value ?? "auto").trim().toLowerCase();
  return STRIP_MODES.includes(mode) ? mode : "auto";
}

/**
 * 状态条文本。App 收到空字符串就不渲染，所以「不显示」只能靠返回 ""。
 * 优先级固定：宿主缺失 > 漂移 > 待清洗 > 摘要。摘要必须短——App 只留 24 字。
 */
export function stripText(s, mode = "auto") {
  const m = normalizeStripMode(mode);
  if (m === "off") return "";
  if (!s || !s.aiBase) return "未找到宿主";
  if (s.drifted > 0) return `漂移 ${s.drifted}`;
  if (s.pending > 0) return `待清洗 ${s.pending}`;
  if (m === "alert") return "";
  if (s.applied === 0) return "已还原为官方原文";
  return `已清洗 ${s.applied}/${s.total}`;
}

/**
 * 注册原生状态条 + 面板。必须在 apply 里调用，且只有桥接主机才会真正注册。
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {object} cfg 归一化后的插件配置
 */
export function installDshGo(ctx, cfg = {}) {
  if (!ctx || typeof ctx.inject !== "function") return;
  try {
    // 文档要求：写 ['dshGo']，不要写 ['dshGo?']，也不要放进顶层 inject。
    ctx.inject(["dshGo"], (goCtx) => {
      try {
        register(goCtx, cfg);
      } catch (error) {
        console.warn("[dsh-purge] dshGo 原生界面注册失败:", String(error && error.message ? error.message : error));
      }
    });
  } catch (error) {
    console.warn("[dsh-purge] dshGo 注入失败:", String(error && error.message ? error.message : error));
  }
}

function register(goCtx, cfg) {
  if (!goCtx.dshGo || typeof goCtx.dshGo.panel !== "function") return;

  let emitPanel = null;
  let emitStrip = null;
  let timer = null;

  const push = async () => {
    const s = await snapshot(cfg);
    try { emitPanel?.(s); } catch { /* 面板已关闭 */ }
    try {
      const text = stripText(s, cfg.stripMode);
      emitStrip?.({ text: text.slice(0, 24), icon: "wrench", tone: s.tone });
    } catch { /* 状态条未显示 */ }
    return s;
  };

  goCtx.dshGo.strip(STRIP_ID, (scope, emit) => {
    emitStrip = emit;
    push().catch(() => {});
    timer = setInterval(() => { push().catch(() => {}); }, REFRESH_MS);
    if (typeof timer.unref === "function") timer.unref();
    return () => {
      if (timer) clearInterval(timer);
      timer = null;
      emitStrip = null;
    };
  });

  goCtx.dshGo.panel(PANEL_ID, {
    view: () => buildCleanView(),
    data: (scope, emit) => {
      emitPanel = emit;
      push().catch(() => {});
      const t = setInterval(() => { push().catch(() => {}); }, REFRESH_MS);
      if (typeof t.unref === "function") t.unref();
      return () => {
        clearInterval(t);
        emitPanel = null;
      };
    },
    actions: {
      async refresh() {
        const s = await push();
        return { toast: toastOf(s.summary), refresh: true };
      },
      async apply() {
        return {
          pending: { label: "正在清洗", timeoutMs: 60_000 },
          result: async () => {
            const state = await core.gatherState();
            if (!state.ai_base) return { toast: "未找到宿主 @deepseek-ai" };
            const multi = await core.applyPatchesAllHosts(core.ALL_PATCHES, {
              preserveClientBundles: false,
              forApply: true,
            });
            const summary = core.summarizeApplyReport(multi.report);
            try { core.seedPromptInjectAtBoot(state.dsh_home); } catch { /* 主目录未就绪 */ }
            try { reapply.markPatchesApplied(); } catch { /* 主目录未就绪 */ }
            await push();
            const failed = (summary.failed || []).length;
            return {
              toast: toastOf(failed
                ? `完成，${failed} 个补丁失败，见状态`
                : (isDshGoAndroid() ? "清洗完成，到设置重启引擎" : "清洗完成，重启 dsh 生效")),
            };
          },
        };
      },
      async revert() {
        return {
          pending: { label: "正在还原", timeoutMs: 60_000 },
          result: async () => {
            const state = await core.gatherState();
            if (!state.ai_base) return { toast: "未找到宿主 @deepseek-ai" };
            const { reverted, errors } = await core.revertAll(state.ai_base);
            await push();
            const failed = (errors || []).length;
            return {
              toast: toastOf(failed
                ? `还原完成，${failed} 个失败`
                : `已还原 ${reverted.length} 个文件`),
            };
          },
        };
      },
      async update() {
        return {
          pending: { label: "检查更新", timeoutMs: 180_000 },
          result: async () => {
            const result = await updateNow();
            await push();
            return { toast: toastOf(result.message), refresh: true };
          },
        };
      },
    },
  });

  // 打开面板时后台查一次版本（镜像优先），有结果再推一次；失败静默，不打扰界面。
  if (cfg.checkUpdateOnStart !== false) {
    checkForUpdate()
      .then(() => push().catch(() => {}))
      .catch(() => {});
  }
}

export const DSHGO_PANEL_ID = PANEL_ID;
export const DSHGO_STRIP_ID = STRIP_ID;
