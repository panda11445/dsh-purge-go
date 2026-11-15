/**
 * 兼容性模型：宿主 DSH 版本、dsh-Go 桥接版本与应用入口身份。
 *
 * 这个模块只做「描述与判断」，不做补丁匹配。状态页、--doctor、compat-matrix
 * 和发布检查共用同一套口径，避免各说各话：
 *   - 宿主版本是否在测试矩阵里（supported / untested / unknown）；
 *   - dsh-Go 桥接是否 >= 0.4（0.4 起按 loader 入口名定位包，要求入口名 == package.json name）；
 *   - 入口名与包名是否一致（不一致时原生面板/状态条会注册失败）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@panda11445go/dsh-purge";
export const LEGACY_PACKAGE_NAME = "dsh-purge";

/** 已回归过的宿主版本。新增版本时同步 core.js 的 dshTargets 与本表。 */
export const HOST_MATRIX = [
  { version: "0.2.2-rc.1", status: "supported", note: "dsh-Go 1.0.16 内置" },
  { version: "0.2.1-rc.4", status: "supported", note: "dsh-Go 1.0.9–1.0.14 内置" },
  { version: "0.2.1-rc.5", status: "supported", note: "npm 上游" },
  { version: "0.2.1-rc.2", status: "supported", note: "旧版兼容" },
];

/** dsh-Go dshGo 桥接：0.4 起要求入口名与包名一致。 */
export const BRIDGE_MIN = "0.4.0";
export const BRIDGE_PROTOCOL = 1;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value) {
  const m = SEMVER.exec(String(value || "").trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".") : [],
    raw: String(value).trim(),
  };
}

function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // 正式版 > 预发布
  if (b.length === 0) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (nx !== ny) {
      return nx ? -1 : 1; // 数字标识 < 字母标识
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a, b) {
  const x = typeof a === "string" ? parseVersion(a) : a;
  const y = typeof b === "string" ? parseVersion(b) : b;
  if (!x || !y) return NaN;
  if (x.major !== y.major) return x.major < y.major ? -1 : 1;
  if (x.minor !== y.minor) return x.minor < y.minor ? -1 : 1;
  if (x.patch !== y.patch) return x.patch < y.patch ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

export function classifyHost(version) {
  const v = String(version || "").trim();
  if (!v) return { known: false, level: "unknown", version: "", entry: null };
  const entry = HOST_MATRIX.find((h) => compareVersions(h.version, v) === 0);
  if (entry) return { known: true, level: entry.status, version: v, entry };
  return { known: true, level: "untested", version: v, entry: null };
}

export function classifyBridge(version) {
  const v = String(version || "").trim();
  if (!v) return { known: false, level: "unknown", version: "" };
  const cmp = compareVersions(v, BRIDGE_MIN);
  if (Number.isNaN(cmp)) return { known: false, level: "unknown", version: v };
  return { known: true, level: cmp >= 0 ? "supported" : "legacy", version: v };
}

/** dshGo 0.4 用 loader 入口名找同名 package.json；入口名和包名不一致就注册不上原生界面。 */
export function identityProblem(entryName, packageName = PACKAGE_NAME) {
  if (!entryName) return null;
  if (String(entryName) === String(packageName)) return null;
  return {
    code: "ENTRY_NAME_MISMATCH",
    entryName: String(entryName),
    packageName: String(packageName),
    message: `loader 入口名 "${entryName}" 与包名 "${packageName}" 不一致；dshGo 0.4+ 的原生面板/状态条会注册失败`,
    fix: "重跑 scripts/install-android.sh，或让插件在启动时执行 migrateLegacyProfileIdentity() 迁移 profile 名称",
  };
}

/** 读插件自己的 name/version。 */
export function readSelfIdentity() {
  try {
    const fp = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(fp, "utf8"));
    return { name: String(pkg.name || ""), version: String(pkg.version || ""), path: fp };
  } catch {
    return { name: PACKAGE_NAME, version: "0.0.0", path: "" };
  }
}

/** dsh-Go 桥接版本（不是 dsh-Go App 版本）。找不到时返回 null。 */
export function readBridgeVersion() {
  const env = String(process.env.DSH_GO_BRIDGE_VERSION || "").trim();
  if (env) return env;
  const roots = [];
  const runtimeRoot = String(process.env.DSH_GO_RUNTIME_ROOT || "").trim();
  if (runtimeRoot) roots.push(runtimeRoot);
  roots.push("/");
  const relatives = [
    "opt/dsh-go/dsh-go-bridge/package.json",
    "opt/dsh-app/dsh-go-bridge/package.json",
    "opt/dsh/node_modules/@ccch1mneyyy/dsh-go-bridge/package.json",
  ];
  for (const rel of relatives) {
    for (const root of roots) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
        if (pkg && pkg.version) return String(pkg.version);
      } catch {
        /* 下一个候选 */
      }
    }
  }
  return null;
}

/**
 * 汇总兼容性判断。返回的 warnings 面向用户；notes 只做说明。
 * ok 表示没有会直接影响原生界面/补丁行为的已知问题。
 */
export function compatReport(input = {}) {
  const hostVersion = input.hostVersion || "";
  const bridgeVersion = input.bridgeVersion || "";
  const entryName = input.entryName || "";
  const packageName = input.packageName || PACKAGE_NAME;
  const host = classifyHost(hostVersion);
  const bridge = classifyBridge(bridgeVersion);
  const identity = identityProblem(entryName, packageName);
  const warnings = [];
  const notes = [];

  if (host.level === "untested") {
    warnings.push({
      code: "HOST_UNTESTED",
      message: `宿主 DSH ${hostVersion} 不在测试矩阵内（${HOST_MATRIX.map((h) => h.version).join(" / ")}）`,
      fix: "先跑 scripts/compat-matrix.mjs 对照漂移，再补变体并更新 dshTargets",
    });
  } else if (host.level === "unknown") {
    notes.push("未读到宿主版本（可能还没装引擎，或 DSH_BASE 未指向 @deepseek-ai）");
  } else if (host.entry) {
    notes.push(`宿主 DSH ${hostVersion}（${host.entry.note}）`);
  }

  if (bridge.level === "legacy") {
    notes.push(`dshGo 桥接 ${bridgeVersion} < ${BRIDGE_MIN}；原生界面按旧规则注册`);
  } else if (bridge.level === "supported") {
    notes.push(`dshGo 桥接 ${bridgeVersion}（协议 v${BRIDGE_PROTOCOL}）`);
  }

  if (identity) warnings.push(identity);

  return {
    ok: warnings.length === 0,
    host,
    bridge,
    identity,
    warnings,
    notes,
    hostVersion,
    bridgeVersion,
    packageName,
  };
}


/** 找到登记了本插件的 profile，返回依赖名（也是 loader 入口名）与所在目录。 */
export function readProfileEntry(dshHome) {
  const root = path.join(String(dshHome || ""), "profiles");
  let names = [];
  try { names = fs.readdirSync(root); } catch { return null; }
  for (const name of names) {
    const dir = path.join(root, name);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch { continue; }
    const deps = pkg && typeof pkg.dependencies === "object" && pkg.dependencies ? pkg.dependencies : {};
    const depName = [PACKAGE_NAME, LEGACY_PACKAGE_NAME].find((key) => key in deps) || "";
    const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
    const inBundles = bundles.some((b) => b === PACKAGE_NAME || b === LEGACY_PACKAGE_NAME);
    const link = path.join(dir, "node_modules", ...PACKAGE_NAME.split("/"));
    let linkTarget = null;
    try { linkTarget = fs.realpathSync(link); } catch { /* 未建 scoped 链接 */ }
    const legacyLink = path.join(dir, "node_modules", LEGACY_PACKAGE_NAME);
    let legacyTarget = null;
    try { legacyTarget = fs.realpathSync(legacyLink); } catch { /* 无旧链接 */ }
    if (!depName && !inBundles && !linkTarget && !legacyTarget) continue;
    return {
      name,
      dir,
      depName,
      dependencySpec: depName ? deps[depName] : "",
      inBundles,
      linkTarget,
      legacyLinkTarget: legacyTarget,
      packageName: String(pkg?.name || ""),
    };
  }
  return null;
}

export function compatHeadline(report) {
  const level = report.host.level === "supported" && report.bridge.level !== "legacy"
    ? "受支持 / supported"
    : report.host.level === "untested"
      ? "未测试 / untested"
      : report.warnings.length
        ? "有告警 / warnings"
        : "未知 / unknown";
  const bits = [];
  if (report.hostVersion) bits.push(`DSH ${report.hostVersion}`);
  if (report.bridgeVersion) bits.push(`bridge ${report.bridgeVersion}`);
  return `${bits.join(" · ") || "宿主未知"} · ${level}`;
}
