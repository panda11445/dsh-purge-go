/**
 * dsh-Go（Android）宿主识别。
 *
 * dsh-Go 把官方 DSH 0.2.1-rc.4 装进 App 自带的 Linux rootfs，有两种启动方式：
 *   - PRoot（默认）：整个 rootfs 就是 `/`，guest 路径 = `/opt/dsh`、`/root/.dsh`、`/etc/dsh-app`；
 *   - Direct（可选）：不 chroot，Node 看到的是**物理路径**
 *     `<rootfs>/opt/dsh`、`<rootfs>/root/.dsh`、`<rootfs>/etc/dsh-app`。
 * 两种模式都由 App 拉起/重启引擎，插件不能自己 spawn `dsh web`。
 *
 * 关键事实（runtime.md / DshProcess.kt:109、DirectLaunch.kt:317）：
 *   - `DSH_GO_RUNTIME_ROOT` 两种模式都会设，值 = rootfs 物理路径 → 最可靠；
 *   - `process.platform` 恒为 `linux`（不是 android）；
 *   - PRoot 用 `env -i` 清理环境，宿主侧的 DSH_GO/ANDROID_* 变量不一定存在；
 *   - Direct 下 `/etc/dsh-app`、`/opt/dsh-go` 这些 guest 绝对路径不存在，要加 rootfs 前缀。
 */
import fs from "node:fs";
import path from "node:path";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const ROOTFS_HINT = /(?:^|\/)(?:files\/runtime\/rootfs|runtime\/rootfs)(?:\/|$)/;

function flag(value) {
  return TRUTHY.has(String(value ?? "").trim().toLowerCase());
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** PRoot / Direct 的 rootfs 物理路径；没有就返回空串。 */
export function dshGoRuntimeRoot(env = process.env) {
  const raw = String(env.DSH_GO_RUNTIME_ROOT || env.DSH_GO_DIRECT_ROOTFS || "").trim();
  return raw && raw.startsWith("/") ? raw.replace(/\/+$/, "") : "";
}

function underRoot(root, sub) {
  return root ? exists(path.join(root, sub)) : false;
}

/** 逐项标记，便于状态页/排查显示为什么判定成 Android。 */
export function androidEvidence(env = process.env, platform = process.platform) {
  const root = dshGoRuntimeRoot(env);
  const execPath = String(process.execPath || "");
  const argv = (process.argv || []).join(" ");
  const cwd = (() => {
    try {
      return process.cwd();
    } catch {
      return "";
    }
  })();
  return {
    force: flag(env.DSH_PURGE_ANDROID),
    runtimeRoot: root,
    // Direct：rootfs 下的 /etc/dsh-app 或 /opt/dsh-go 真实存在。
    runtimeRootMarker: Boolean(root) && (underRoot(root, "etc/dsh-app") || underRoot(root, "opt/dsh-go")),
    direct: flag(env.DSH_GO_DIRECT_MAIN) || Boolean(String(env.DSH_GO_DIRECT_ROOTFS || "").trim()),
    dshGoFlag: flag(env.DSH_GO),
    dshGoRoot: Boolean(env.DSH_GO_ROOT || env.DSH_GO_HOME || env.DSH_GO_APP),
    // PRoot：guest 绝对路径直接可见。
    rootfsMarker: exists("/etc/dsh-app") || exists("/opt/dsh-go"),
    androidPlatform: platform === "android",
    androidRuntimeEnv: Boolean(env.ANDROID_DATA || env.ANDROID_ROOT),
    hostPathHint: ROOTFS_HINT.test(execPath) || ROOTFS_HINT.test(argv) || ROOTFS_HINT.test(cwd),
  };
}

/** 是否是 dsh-Go 的 Android 本地引擎（含 PRoot 与 Direct 两种）。 */
export function isDshGoAndroid(env = process.env, platform = process.platform) {
  const e = androidEvidence(env, platform);
  return Boolean(
    e.force ||
    e.runtimeRoot ||
    e.direct ||
    e.dshGoFlag ||
    e.dshGoRoot ||
    e.rootfsMarker ||
    e.runtimeRootMarker ||
    e.androidPlatform ||
    e.androidRuntimeEnv ||
    e.hostPathHint
  );
}

/** 明确要求「像桌面一样」的测试开关；Android 上默认忽略。 */
export function allowDesktopOnAndroid(env = process.env) {
  return flag(env.DSH_PURGE_ALLOW_DESKTOP_ON_ANDROID);
}

/** 把 guest 绝对路径映射到 rootfs 物理路径（PRoot 下原样返回）。 */
export function androidGuestPath(guest, env = process.env) {
  const p = String(guest || "");
  if (!p.startsWith("/")) return p;
  const root = dshGoRuntimeRoot(env);
  if (!root) return p;
  if (p === root || p.startsWith(`${root}/`)) return p;
  return path.join(root, p);
}

/** 给用户看的一句重启指引（CLI / 命令 / 原生面板共用）。 */
export function restartHint() {
  if (isDshGoAndroid()) {
    return "请到 DSH Go 的「设置 › 本机引擎」点重启（或等 App 重连）后生效。";
  }
  return "重启 dsh 后生效。";
}

/** App 终端 / 日志里标识宿主，方便 issue 排查。 */
export function hostLabel() {
  return isDshGoAndroid() ? "dsh-go/android" : "dsh";
}
