#!/usr/bin/env node
/**
 * 从真实宿主树抓补丁片段，生成 test/fixtures/*-patch-snippets.json。
 *
 * 用途：给「变体仍能命中官方原文」加回归锚点。宿主升级后重新抓一份，
 * 配合 scripts/compat-matrix.mjs 判断哪些 pattern 需要更新。
 *
 * 用法：
 *   node scripts/capture-host-snippets.mjs --host /path/to/rootfs --version 0.2.2-rc.1
 *   node scripts/capture-host-snippets.mjs --host /path --version 0.2.2-rc.1 --ids 14,17,40
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function take(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : "";
}

const host = take("--host");
const version = take("--version") || "unknown";
const idsArg = take("--ids");
if (!host) {
  console.error("用法: node scripts/capture-host-snippets.mjs --host <rootfs> [--version 0.2.2-rc.1] [--ids 14,17]");
  process.exit(2);
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
  throw new Error(`找不到 @deepseek-ai: ${input}`);
}

const aiBase = detectAiBase(host);
process.env.DSH_BASE = aiBase;
process.env.DSH_PURGE_ANDROID = "1";
process.env.DSH_HOME = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "dsh-capture-"));

const core = await import(path.join(ROOT, "lib", "core.js").replace(/\\/g, "/"));
const files = core.targetFiles(aiBase, process.env.DSH_HOME);
const ids = idsArg ? idsArg.split(",").map((n) => Number(n.trim())).filter(Boolean)
  : core.ALL_PATCHES.filter((p) => !p.optional).map((p) => p.id);

const out = { version, source: "local dsh-Go rootfs export", patches: {} };
let captured = 0;
for (const id of ids) {
  const patch = core.ALL_PATCHES.find((p) => p.id === id);
  if (!patch) continue;
  const keys = Array.isArray(patch.file) ? patch.file : [patch.file];
  const texts = [];
  for (const key of keys) {
    const vals = files[key];
    for (const fp of Array.isArray(vals) ? vals : vals ? [vals] : []) {
      if (!fp || !fs.existsSync(fp)) continue;
      texts.push({ key, file: path.relative(aiBase, fp), text: fs.readFileSync(fp, "utf8") });
    }
  }
  const entries = [];
  for (const [index, r] of (patch.replacements || []).entries()) {
    for (const t of texts) {
      if (typeof r.pattern === "string" && t.text.includes(r.pattern)) {
        entries.push({ key: t.key, file: t.file, index, kind: "string", snippet: r.pattern });
        break;
      }
      if (r.pattern instanceof RegExp) {
        const m = r.pattern.exec(t.text);
        if (m) {
          entries.push({ key: t.key, file: t.file, index, kind: "regex", snippet: m[0] });
          break;
        }
      }
    }
  }
  if (entries.length) {
    out.patches[String(id)] = { name: patch.name, entries };
    captured += entries.length;
  }
}

const outPath = path.join(ROOT, "test", "fixtures", `dsh-${version}-patch-snippets.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`captured ${captured} snippets for ${Object.keys(out.patches).length} patches → ${path.relative(ROOT, outPath)}`);
