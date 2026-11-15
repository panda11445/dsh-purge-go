/**
 * 内置检查更新（GitHub Release）。
 *
 * dsh-Go 没有"插件更新"协议：清单顶层只有 v / minApp / title / icon / wants / assets /
 * contributes / capabilities，桥接也不提供升级回调。所以更新只能由插件自己做：
 *   1) 问 GitHub 的 releases/latest 要 tag 和 tgz 资产（api.github.com；失败退回 main 的 latest.txt）；
 *   2) 有新版就在面板里提示，用户点「更新」；
 *   3) 用 Release 资产的 URL 走 `dsh plugin add` 安装，pnpm 的"待批准"自动置 true 重试。
 *
 * 不再访问 npm registry：安装只走仓库页公开的三种方式（Release tgz / install.sh / 本地包）。
 * 不 spawn 常驻进程、不常轮询：一次检查一个 https 请求，结果缓存 10 分钟。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { findDshHome } from "./core.js";

export const PKG_NAME = "@panda11445go/dsh-purge";
export const PKG_SHORT = "dsh-purge";

/** 本仓库：Release 与 latest.txt 的来源。 */
export const GH_REPO = "panda11445/dsh-purge-go";
const RELEASE_API = `https://api.github.com/repos/${GH_REPO}/releases/latest`;
const LATEST_TXT = `https://raw.githubusercontent.com/${GH_REPO}/main/latest.txt`;

/** Release 里 tgz 资产的固定命名。install.sh 也按这个拼。 */
export function releaseTarballUrl(version, repo = GH_REPO) {
  return `https://github.com/${repo}/releases/download/v${version}/panda11445go-dsh-purge-${version}.tgz`;
}

/** 从 Release JSON 里挑 tgz 资产；没上传资产就回退到约定 URL。 */
export function pickTarballAsset(release, repo = GH_REPO) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const hit = assets.find((a) => a && typeof a.browser_download_url === "string"
    && /\.tgz$/i.test(a.name || a.browser_download_url));
  return hit ? hit.browser_download_url : "";
}

/** 问 GitHub 要最新版本。先 releases/latest，再 latest.txt。 */
export async function latestFromGitHub(repo = GH_REPO) {
  const errors = [];
  try {
    const release = await getJson(repo === GH_REPO ? RELEASE_API
      : `https://api.github.com/repos/${repo}/releases/latest`);
    const version = String(release && release.tag_name || "").trim().replace(/^v/i, "");
    if (!version) throw new Error("release 缺少 tag_name");
    return {
      version,
      source: "github",
      tarball: pickTarballAsset(release, repo) || releaseTarballUrl(version, repo),
    };
  } catch (error) {
    errors.push(`releases: ${error && error.message ? error.message : error}`);
  }
  try {
    const text = await getText(repo === GH_REPO ? LATEST_TXT
      : `https://raw.githubusercontent.com/${repo}/main/latest.txt`);
    const version = String(text || "").split(/\r?\n/)
      .map((line) => line.trim()).find((line) => /^\d/.test(line)) || "";
    if (!version) throw new Error("latest.txt 为空");
    return { version, source: "latest.txt", tarball: releaseTarballUrl(version, repo) };
  } catch (error) {
    errors.push(`latest.txt: ${error && error.message ? error.message : error}`);
  }
  throw new Error(`GitHub 发布信息不可达（${errors.join("；")}）`);
}

const CACHE_MS = 10 * 60 * 1000;

const state = {
  checkedAt: 0,
  checking: null,
  result: null, // { current, latest, hasUpdate, source, tarball, error, checkedAt }
};

export function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

/** 只读缓存，永不发请求。面板/状态条用这个。 */
export function cachedUpdate() {
  if (!state.result) return { checked: false, current: localVersion(), latest: "", hasUpdate: false, error: "" };
  return { checked: true, ...state.result };
}

export function shouldRefresh(maxAgeMs = CACHE_MS) {
  return Date.now() - state.checkedAt > maxAgeMs;
}

function getJson(url, timeoutMs = 8000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "user-agent": `${PKG_NAME} update-check`, accept: "application/json" },
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        resolve(getJson(next, timeoutMs, redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 256 * 1024) {
          req.destroy(new Error("response too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(new Error(`bad json: ${error && error.message ? error.message : error}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function getText(url, timeoutMs = 8000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "user-agent": `${PKG_NAME} update-check`, accept: "text/plain" },
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(getText(new URL(res.headers.location, url).href, timeoutMs, redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) req.destroy(new Error("response too large"));
      });
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** 检查更新；并发调用共享同一次请求。 */
export async function checkForUpdate({ force = false } = {}) {
  if (!force && !shouldRefresh()) return cachedUpdate();
  if (state.checking) return state.checking;
  const current = localVersion();
  state.checking = (async () => {
    try {
      const latest = await latestFromGitHub();
      // 只有预发布版可升级时，不把稳定版用户劝去装 rc；版本号必须真的更高。
      const prerelease = latest.version.includes("-");
      const hasUpdate = compareVersions(latest.version, current) > 0
        && !(prerelease && !current.includes("-"));
      state.result = {
        current,
        latest: latest.version,
        hasUpdate,
        source: latest.source,
        tarball: latest.tarball,
        error: "",
      };
    } catch (error) {
      state.result = {
        current,
        latest: "",
        hasUpdate: false,
        source: "",
        tarball: "",
        error: String(error && error.message ? error.message : error),
      };
    }
    state.checkedAt = Date.now();
    state.checking = null;
    state.result.checkedAt = state.checkedAt;
    return cachedUpdate();
  })();
  return state.checking;
}

/** 语义化版本比较，够用即可（major.minor.patch[-pre]）。 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || "").trim());
    return m ? { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x.parts[i] !== y.parts[i]) return x.parts[i] > y.parts[i] ? 1 : -1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) > Number(q) ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

/**
 * 找到装了本插件的 profile 目录（取第一个）。
 * dsh-Go 本机引擎一般是 ~/.dsh/profiles/web。
 */
export function findInstalledProfile() {
  const home = findDshHome();
  if (!home) return null;
  const root = path.join(home, "profiles");
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (fs.existsSync(path.join(dir, "node_modules", ...PKG_NAME.split("/"), "package.json"))) {
        return { name, dir };
      }
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

/** pnpm 11 把首次 file:/URL 安装记成待批准；把它置 true。返回是否改动了文件。 */
export function approvePendingBuilds(profileDir) {
  const file = path.join(profileDir, "pnpm-workspace.yaml");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  if (!/set this to true or false\s*$/m.test(text)) return false;
  const next = text.replace(/^( *[^:\n]*panda11445go[^\n]*): set this to true or false\s*$/gm, "$1: true");
  if (next === text) return false;
  try {
    fs.writeFileSync(file, next, "utf8");
    return true;
  } catch {
    return false;
  }
}

function runDsh(args, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const child = spawn(process.env.DSH_BIN || "dsh", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        resolve({ ok: false, code: -1, output: `${out}${err}\n(timeout)` });
      }
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -1, output: `${out}${err}\n${error && error.message ? error.message : error}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output: `${out}${err}`.trim() });
    });
  });
}

/**
 * 从镜像 URL 安装指定版本，pnpm 的待批准自动重试一次。
 * 装完 DSH 会靠 HMR 替换运行中的插件；没生效时提示重启引擎。
 */
export async function installFromTarballUrl(url, { profileDir } = {}) {
  const target = profileDir || findInstalledProfile();
  if (!target) return { ok: false, output: "找不到装了本插件的 profile" };
  const args = ["plugin", "--profile", target.name, "add", url];
  const first = await runDsh(args);
  if (first.ok) return { ok: true, retried: false, output: first.output, profile: target.name };
  if (approvePendingBuilds(target.dir)) {
    const second = await runDsh(args);
    return { ok: second.ok, retried: true, output: second.output || first.output, profile: target.name };
  }
  return { ok: false, retried: false, output: first.output, profile: target.name };
}

/** 检查 + 安装一步到位，面板「更新」按钮用。 */
export async function updateNow() {
  const info = await checkForUpdate({ force: true });
  if (!info.checked) return { ok: false, message: info.error || "检查更新失败" };
  if (!info.hasUpdate) return { ok: true, message: `已是最新 ${info.current}`, updated: false };
  const result = await installFromTarballUrl(info.tarball);
  if (!result.ok) return { ok: false, message: `安装 ${info.latest} 失败：${trimOutput(result.output)}`, updated: false };
  return {
    ok: true,
    updated: true,
    version: info.latest,
    message: `已装 ${info.latest}${result.retried ? "（已批准 pnpm 构建）" : ""}，重启引擎生效`,
  };
}

function trimOutput(text) {
  return String(text || "").replace(/\s+/g, " ").slice(0, 160);
}
