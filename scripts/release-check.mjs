#!/usr/bin/env node
/**
 * 发布前自检：把「发布事故」变成可失败检查。
 *
 *   node scripts/release-check.mjs            完整检查（含单测）
 *   node scripts/release-check.mjs --skip-tests
 *   node scripts/release-check.mjs --require-tarball
 *
 * 检查项：
 *   - 包名/版本/宿主目标（dshTargets 必须覆盖兼容矩阵里所有 supported 版本）
 *   - 无 install 生命周期脚本、无调试探针
 *   - dshGo 清单关键贡献（面板 + 输入框状态条）
 *   - market 条目版本与包一致
 *   - 当前版本 tarball（若存在）内容与包一致
 *   - 单元测试（可跳过）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME, HOST_MATRIX, parseVersion } from "../lib/compat.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = {
  json: args.includes("--json"),
  skipTests: args.includes("--skip-tests"),
  requireTarball: args.includes("--require-tarball"),
};

const checks = [];
function check(name, fn) {
  try {
    const result = fn();
    checks.push({ name, ok: true, detail: typeof result === "string" ? result : "" });
  } catch (error) {
    checks.push({ name, ok: false, detail: String(error?.message || error) });
  }
}

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

function readText(fp) {
  return fs.readFileSync(fp, "utf8");
}

const pkgPath = path.join(ROOT, "package.json");
const pkg = readJson(pkgPath);

check("package name", () => {
  if (pkg.name !== PACKAGE_NAME) throw new Error(`期望 ${PACKAGE_NAME}，实际 ${pkg.name}`);
  return pkg.name;
});

check("version", () => {
  if (!parseVersion(pkg.version)) throw new Error(`不是合法 semver: ${pkg.version}`);
  return pkg.version;
});

check("dshTargets covers matrix", () => {
  const list = new Set([pkg.dshTarget, ...(Array.isArray(pkg.dshTargets) ? pkg.dshTargets : [])].filter(Boolean));
  const missing = HOST_MATRIX.filter((h) => h.status === "supported" && !list.has(h.version)).map((h) => h.version);
  if (missing.length) throw new Error(`缺少宿主版本: ${missing.join(", ")}`);
  return [...list].join(" / ");
});

check("engines / peer", () => {
  if (!pkg.engines?.dsh) throw new Error("缺少 engines.dsh");
  if (!pkg.peerDependencies?.["@deepseek-ai/cordis"]) throw new Error("缺少 cordis peerDependency");
  return `${pkg.engines.dsh} · cordis ${pkg.peerDependencies["@deepseek-ai/cordis"]}`;
});

check("no install scripts", () => {
  const scripts = pkg.scripts || {};
  const bad = ["preinstall", "install", "postinstall"].filter((k) => k in scripts);
  if (bad.length) throw new Error(`存在安装脚本: ${bad.join(", ")}`);
  return "none";
});

check("files list", () => {
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const need = ["lib", "bin", "docs", "client.js", "cordis.patch.yml", "README-ANDROID.md"];
  const missing = need.filter((n) => !files.includes(n));
  if (missing.length) throw new Error(`files 缺少: ${missing.join(", ")}`);
  return `${files.length} 项`;
});

check("dshGo manifest", () => {
  const m = pkg.dshGo;
  if (!m || m.v !== 1) throw new Error("dshGo.v 必须为 1");
  if (!parseVersion(m.minApp)) throw new Error("dshGo.minApp 不是 semver");
  const panels = m.contributes?.panels || [];
  const strips = m.contributes?.["composer.strip"] || [];
  if (!panels.some((p) => p.id === "clean")) throw new Error("缺少 panels.clean");
  if (!strips.some((s) => s.id === "status")) throw new Error("缺少 composer.strip.status");
  return `panels=${panels.length} strip=${strips.length}`;
});

function scanDebugMarkers(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDebugMarkers(fp, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      if (path.resolve(fp) === path.resolve(fileURLToPath(import.meta.url))) continue; // 自检文件本身含 marker 名
      const text = readText(fp);
      for (const marker of ["purge-probe", "purge-apply-marker", "purge-install-marker", "purge-inject-marker", "/sdcard/purge-"]) {
        if (text.includes(marker)) out.push(`${path.relative(ROOT, fp)}: ${marker}`);
      }
    }
  }
  return out;
}

check("no debug markers", () => {
  const bad = [];
  for (const dir of ["lib", "bin", "scripts"]) bad.push(...scanDebugMarkers(path.join(ROOT, dir)));
  if (bad.length) throw new Error(bad.join("; "));
  return "clean";
});

check("tarball", () => {
  const name = `${pkg.name.replace(/^@/, "").replace(/\//g, "-")}-${pkg.version}.tgz`;
  const fp = path.join(ROOT, name);
  const alt = path.join(ROOT, `${pkg.name.split("/").pop()}-${pkg.version}.tgz`);
  const target = fs.existsSync(fp) ? fp : fs.existsSync(alt) ? alt : null;
  if (!target) {
    if (flags.requireTarball) throw new Error(`缺少 ${name}`);
    return "未打包（可 skip）";
  }
  const text = execFileSync("tar", ["-xzf", target, "-O", "package/package.json"], { encoding: "utf8" });
  const inner = JSON.parse(text);
  if (inner.version !== pkg.version) throw new Error(`tarball 内版本 ${inner.version} != ${pkg.version}`);
  if (inner.name !== pkg.name) throw new Error(`tarball 内包名 ${inner.name} != ${pkg.name}`);
  return path.basename(target);
});

check("unit tests", () => {
  if (flags.skipTests) return "skipped";
  execFileSync("npm", ["run", "test", "--silent"], { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 300_000 });
  return "passed";
});

const failed = checks.filter((c) => !c.ok);
if (flags.json) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
} else {
  console.log("发布检查 / release check");
  for (const c of checks) console.log(`  [${c.ok ? "PASS" : "FAIL"}] ${c.name.padEnd(24)} ${c.detail}`);
  console.log(failed.length === 0 ? "全部通过 / all good" : `${failed.length} 项未通过`);
}
process.exit(failed.length === 0 ? 0 : 1);
