import { adapterFor, detectSurface } from "./surface.js";
import { allowDesktopOnAndroid, isDshGoAndroid, restartHint } from "./android.js";
import * as desktop from "./desktop.js";
import * as web from "./web.js";

const ADAPTERS = {
  web,
  desktop,
};

export function currentSurface(input) {
  return detectSurface(input);
}

export function hostAdapter(kind = detectSurface()) {
  return ADAPTERS[adapterFor(kind)] || web;
}

/**
 * dsh-Go/Android 上禁止任何形式的自行重启：引擎进程由 App 管理，spawn `dsh web` 会和
 * App 的进程/端口/会话打架。返回与 web adapter 同形状的“没重启”结果，让调用方照常
 * 继续（面板/命令会提示去 App「引擎」页重启）。
 */
function androidRestartVeto() {
  if (!isDshGoAndroid() || allowDesktopOnAndroid()) return null;
  return {
    restarting: false,
    scheduled: false,
    skipped_android: true,
    clean: true,
    note: restartHint(),
  };
}

export function scheduleRestart(request, ctx, options = {}) {
  const veto = androidRestartVeto();
  if (veto) return veto;
  return hostAdapter().scheduleRestart(request, ctx, options);
}

export function scheduleCleanupRestart(opts) {
  const veto = androidRestartVeto();
  if (veto) return veto;
  return hostAdapter().scheduleCleanupRestart(opts);
}

export function restartNote() {
  const veto = androidRestartVeto();
  if (veto) return veto.note;
  return hostAdapter().restartNote();
}
