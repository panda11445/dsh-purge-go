import test from "node:test";
import assert from "node:assert/strict";
import { buildCleanView, installDshGo, normalizeStripMode, stripText } from "../lib/dshgo.js";

function fakeHost() {
  const captured = {};
  const go = {
    strip(id, fn) { captured.strip = { id, fn }; },
    panel(id, def) { captured.panel = { id, def }; },
  };
  const ctx = {
    inject(services, cb) {
      assert.deepEqual(services, ["dshGo"]);
      cb({ dshGo: go });
    },
  };
  return { ctx, captured };
}

test("视图在面板预算内（≤32KiB、组件数合理）", () => {
  const view = buildCleanView();
  const raw = JSON.stringify(view);
  assert.equal(view.type, "stack");
  assert.ok(Buffer.byteLength(raw) < 32 * 1024, `view too large: ${raw.length}`);
  const types = raw.split('"type"').length - 1;
  assert.ok(types <= 120, `too many components: ${types}`);
  // 1.4.1 起面板压缩成「摘要 + 两个按钮」，不再渲染指标块，避免占满底部弹层。
  assert.ok(raw.includes("data.summary"));
  assert.ok(raw.includes("data.tone"));
  assert.ok(raw.includes('"apply"'));
  assert.ok(raw.includes('"revert"'));
  assert.ok(!raw.includes("data.applied"), "compact view should not render metrics");
});

test("注册 strip 与 panel，并推送状态快照", async () => {
  process.env.DSH_PURGE_ANDROID = "1";
  const { ctx, captured } = fakeHost();
  installDshGo(ctx, {});
  assert.equal(captured.strip.id, "status");
  assert.equal(captured.panel.id, "clean");
  assert.deepEqual(Object.keys(captured.panel.def.actions).sort(), ["apply", "refresh", "revert", "update"]);

  const data = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("no data emitted")), 15_000);
    const cleanup = captured.panel.def.data({}, (payload) => {
      clearTimeout(timeout);
      cleanup?.();
      resolve(payload);
    });
  });
  assert.equal(typeof data.applied, "number");
  assert.equal(typeof data.pending, "number");
  assert.equal(typeof data.drifted, "number");
  assert.equal(typeof data.total, "number");
  assert.equal(data.mode, "dsh-go / Android");
  assert.ok(typeof data.summary === "string" && data.summary.length > 0);
  assert.ok(["good", "info", "warn", "bad"].includes(data.tone));
});

test("refresh 动作返回合法效果", async () => {
  const { ctx, captured } = fakeHost();
  installDshGo(ctx, {});
  const effects = await captured.panel.def.actions.refresh();
  assert.ok(effects && typeof effects === "object");
  assert.ok(typeof effects.toast === "string" && effects.toast.length <= 40);
  assert.equal(effects.refresh, true);
});

test("没有 dshGo 服务时静默跳过", () => {
  const ctx = { inject() { /* 桥接不存在：回调永不执行 */ } };
  assert.doesNotThrow(() => installDshGo(ctx, {}));
});

// 1.5.1：状态条从「只在异常时出现」改成三档。干净时原本发空字符串，App 不渲染，
// 用户以为没生效；auto 让它常显摘要，alert 保留旧行为。
const CLEAN = { aiBase: "/root/.dsh/opt/dsh/node_modules/@deepseek-ai", applied: 71, pending: 0, drifted: 0, total: 73 };

test("strip 文本：auto 常显摘要，alert 仅异常，off 不显示", () => {
  assert.equal(stripText(CLEAN, "auto"), "已清洗 71/73");
  assert.equal(stripText(CLEAN), "已清洗 71/73", "缺省即 auto");
  assert.equal(stripText(CLEAN, "alert"), "");
  assert.equal(stripText(CLEAN, "off"), "");
  assert.equal(stripText({ ...CLEAN, pending: 2 }, "alert"), "待清洗 2");
  assert.equal(stripText({ ...CLEAN, pending: 2 }, "auto"), "待清洗 2");
  // 漂移优先于待清洗
  assert.equal(stripText({ ...CLEAN, drifted: 1, pending: 2 }, "auto"), "漂移 1");
  assert.equal(stripText({ ...CLEAN, drifted: 1 }, "alert"), "漂移 1");
  assert.equal(stripText({ ...CLEAN, applied: 0 }, "auto"), "已还原为官方原文");
});

test("strip 文本：宿主缺失时可见（旧版发空字符串，条和错误一起消失）", () => {
  const missing = { ...CLEAN, aiBase: "" };
  assert.equal(stripText(missing, "auto"), "未找到宿主");
  assert.equal(stripText(missing, "alert"), "未找到宿主");
  assert.equal(stripText(missing, "off"), "");
  assert.equal(stripText(null, "auto"), "未找到宿主");
});

test("strip 文本不超过 App 的 24 字上限", () => {
  const worst = { aiBase: "/x", applied: 999, pending: 0, drifted: 0, total: 1000 };
  for (const mode of ["auto", "alert", "off"]) {
    assert.ok(stripText(worst, mode).length <= 24, `${mode} 超长`);
  }
});

test("stripMode 非法值收敛到 auto", () => {
  assert.equal(normalizeStripMode(""), "auto");
  assert.equal(normalizeStripMode("OFF"), "off");
  assert.equal(normalizeStripMode(" off "), "off");
  assert.equal(normalizeStripMode("alert"), "alert");
  assert.equal(normalizeStripMode("bogus"), "auto");
  assert.equal(normalizeStripMode(undefined), "auto");
});

test("strip 注册后推送 ≤24 字文本", async () => {
  process.env.DSH_PURGE_ANDROID = "1";
  const { ctx, captured } = fakeHost();
  installDshGo(ctx, { stripMode: "auto" });
  const text = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("no strip emit")), 15_000);
    const dispose = captured.strip.fn({}, (payload) => {
      clearTimeout(timeout);
      dispose?.();
      resolve(payload.text);
    });
  });
  assert.equal(typeof text, "string");
  assert.ok(text.length <= 24, `strip text too long: ${text}`);
});
