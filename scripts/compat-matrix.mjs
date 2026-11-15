#!/usr/bin/env node
/**
 * 兼容性矩阵：对每个宿主树跑一遍状态/清洗，输出一份可判定的表。
 *
 * 宿主树可以是：
 *   - 包含 `opt/dsh/node_modules/@deepseek-ai` 的 rootfs 导出目录；
 *   - 直接指向 `@deepseek-ai` 目录。
 *
 * 用法：
 *   node scripts/compat-matrix.mjs --host /path/0.2.2 --host /path/0.2.1-rc.4
 *   node scripts/compat-matrix.mjs --host /path/0.2.2 --apply --syntax
 *
 * 判定：
 *   - 不加 --apply：drifted > 0 视为失败（说明宿主原文变了，当前 pattern 不认识）；
 *   - 加 --apply：在临时副本上清洗，之后 pending/drifted 必须为 0，且 JS 语法检查通过。
 * 任何一项失败，进程退出码 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "dsh-purge.js");

function parseArgs(argv) {
  const out = { hosts: [], apply: false, syntax: false, json: false, keep: false, label: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") out.hosts.push({ path: argv[++i], label: "" });
    else if (a === "--label") out.hosts[out.hosts.length - 1].label = argv[++i];
    else if (a === "--apply") out.apply = true;
    else if (a === "--syntax") out.syntax = true;
    else if (a === "--json") out.json = true;
    else if (a === "--keep") out.keep = true;
    else if (a === "--help" || a === "-h") {
      console.log("用法: node scripts/compat-matrix.mjs --host <dir> [--label name] [--apply] [--syntax] [--json] [--keep]");
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function detectAiBase(input) {
  const p = path.resolve(input);
  const candidates = [
    path.join(p, "opt", "dsh", "node_modules", "@deepseek-ai"),
    path.join(p, "dsh", "node_modules", "@deepseek-ai"),
    path.join(p, "node_modules", "@deepseek-ai"),
    p,
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "dsh", "package.json"))) return c;
  }
  throw new Error(`找不到 @deepseek-ai（试过 ${candidates.join(", ")}）`);
}

async function loadState(aiBase, dshHome) {
  process.env.DSH_PURGE_ANDROID = "1";
  process.env.DSH_BASE = aiBase;
  process.env.DSH_HOME = dshHome;
  // core 在调用时读取 env；这里按宿主逐个刷新即可。
  const core = await import(path.join(ROOT, "lib", "core.js").replace(/\\/g, "/"));
  const state = await core.gatherState();
  return { core, state };
}

function targetJsFiles(core, aiBase) {
  const files = core.targetFiles(aiBase, process.env.DSH_HOME);
  const out = new Set();
  for (const val of Object.values(files)) {
    for (const fp of Array.isArray(val) ? val : [val]) {
      if (fp && fp.endsWith(".js") && fs.existsSync(fp)) out.add(fp);
    }
  }
  return [...out];
}

function checkSyntax(files) {
  const failed = [];
  for (const fp of files) {
    try {
      execFileSync(process.execPath, ["--check", fp], { stdio: "pipe" });
    } catch {
      failed.push(fp);
    }
  }
  return failed;
}

function runApply(aiBase, dshHome) {
  try {
    execFileSync(process.execPath, [BIN, "--apply"], {
      env: { ...process.env, DSH_PURGE_ANDROID: "1", DSH_BASE: aiBase, DSH_HOME: dshHome },
      stdio: "pipe",
      encoding: "utf8",
      timeout: 180_000,
    });
    return { ok: true, output: "" };
  } catch (error) {
    return { ok: false, output: String(error?.stdout || error?.stderr || error?.message || error) };
  }
}

function copyHost(hostDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-compat-"));
  const dst = path.join(tmp, "host");
  fs.cpSync(hostDir, dst, { recursive: true, verbatimSymlinks: true });
  return { tmp, dst };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.hosts.length === 0) {
    console.error("至少给一个 --host；见 docs/COMPATIBILITY.md");
    process.exit(2);
  }
  const rows = [];
  let failed = 0;
  for (const item of opts.hosts) {
    const aiBase = detectAiBase(item.path);
    const label = item.label || path.basename(path.resolve(item.path));
    const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-compat-home-"));
    let workDir = path.resolve(item.path);
    let workAiBase = aiBase;
    let cleanup = null;
    try {
      if (opts.apply) {
        cleanup = copyHost(path.resolve(item.path));
        workDir = cleanup.dst;
        workAiBase = detectAiBase(workDir);
      }
      const { core, state } = await loadState(workAiBase, dshHome);
      const driftAll = Object.entries(state.patch_status || {}).filter(([, v]) => v === "drifted").map(([id]) => Number(id));
      // optional 补丁（例如 #88 是 #87 的后续变体）在干净宿主上可能天然不命中，
      // 与面板口径一致：不算失败，只在输出里标注。
      const driftRequired = driftAll.filter((id) => {
        const p = core.ALL_PATCHES.find((x) => x.id === id);
        return !p || p.optional !== true;
      });
      const row = {
        label,
        host: state.host_version || "?",
        compat: state.compat_headline || "",
        applied: state.patches_applied,
        total: state.patches_total,
        pending: state.patches_pending,
        drifted: driftRequired.length,
        driftedOptional: driftAll.length - driftRequired.length,
        driftIds: driftRequired,
        syntaxFailed: [],
        apply: null,
        ok: true,
      };
      if (opts.apply) {
        const res = runApply(workAiBase, dshHome);
        const after = await loadState(workAiBase, dshHome);
        row.apply = res.ok ? "ok" : "failed";
        row.pending = after.state.patches_pending;
        row.drifted = after.state.patches_drifted;
        row.applied = after.state.patches_applied;
        if (opts.syntax) row.syntaxFailed = checkSyntax(targetJsFiles(after.core, workAiBase));
        row.ok = res.ok && row.pending === 0 && row.drifted === 0 && row.syntaxFailed.length === 0;
      } else {
        row.ok = row.drifted === 0;
      }
      if (!row.ok) failed += 1;
      rows.push(row);
    } catch (error) {
      failed += 1;
      rows.push({ label, host: "?", compat: "", applied: 0, total: 0, pending: 0, drifted: 0, driftIds: [], syntaxFailed: [], apply: null, ok: false, error: String(error?.message || error) });
    } finally {
      try { fs.rmSync(dshHome, { recursive: true, force: true }); } catch {}
      if (cleanup && !opts.keep) { try { fs.rmSync(cleanup.tmp, { recursive: true, force: true }); } catch {} }
      else if (cleanup) console.error(`保留临时树: ${cleanup.dst}`);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: failed === 0, rows }, null, 2));
  } else {
    console.log("兼容矩阵 / compat matrix");
    for (const r of rows) {
      const mark = r.ok ? "PASS" : "FAIL";
      const extra = r.error ? ` error=${r.error}` : "";
      const s = (r.apply ? ` apply=${r.apply} syntax_fail=${r.syntaxFailed.length}` : "") + (r.driftedOptional ? ` optional_drift=${r.driftedOptional}` : "");
      console.log(`  [${mark}] ${r.label.padEnd(22)} DSH ${String(r.host).padEnd(12)} ${r.applied}/${r.total} 已清洗 · pending=${r.pending} drifted=${r.drifted}${r.driftIds.length ? " (" + r.driftIds.map((i) => "#" + i).join(",") + ")" : ""}${s}${extra}`);
    }
    console.log(failed === 0 ? "全部通过 / all good" : `${failed} 个宿主未通过`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
