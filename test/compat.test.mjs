import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PACKAGE_NAME, LEGACY_PACKAGE_NAME, HOST_MATRIX,
  compareVersions, parseVersion, classifyHost, classifyBridge,
  identityProblem, compatReport, readProfileEntry,
} from "../lib/compat.js";
import { migrateLegacyProfileIdentity } from "../lib/profile-insert.js";

test("版本比较：rc 顺序与正式版优先级", () => {
  assert.ok(compareVersions("0.2.2-rc.1", "0.2.1-rc.5") > 0);
  assert.ok(compareVersions("0.2.1-rc.5", "0.2.1-rc.4") > 0);
  assert.ok(compareVersions("0.2.2", "0.2.2-rc.9") > 0);
  assert.equal(compareVersions("0.2.2-rc.1", "0.2.2-rc.1"), 0);
  assert.ok(Number.isNaN(compareVersions("not-a-version", "0.2.2")));
  assert.equal(parseVersion("0.2.2-rc.1").pre[0], "rc");
});

test("宿主分类：矩阵内 supported，新版本 untested", () => {
  for (const h of HOST_MATRIX.filter((x) => x.status === "supported")) {
    const c = classifyHost(h.version);
    assert.equal(c.known, true);
    assert.equal(c.level, "supported");
  }
  assert.equal(classifyHost("0.3.0").level, "untested");
  assert.equal(classifyHost("").level, "unknown");
});

test("桥接分类：0.4 起为 supported", () => {
  assert.equal(classifyBridge("0.4.0").level, "supported");
  assert.equal(classifyBridge("0.4.3").level, "supported");
  assert.equal(classifyBridge("0.3.9").level, "legacy");
  assert.equal(classifyBridge("").level, "unknown");
});

test("入口身份：0.4 要求入口名 == 包名", () => {
  assert.equal(identityProblem(PACKAGE_NAME), null);
  const bad = identityProblem(LEGACY_PACKAGE_NAME);
  assert.equal(bad.code, "ENTRY_NAME_MISMATCH");
  assert.match(bad.message, /注册失败/);
});

test("兼容报告：未测试宿主产生告警", () => {
  const r = compatReport({ hostVersion: "0.3.0", bridgeVersion: "0.4.0", entryName: PACKAGE_NAME });
  assert.equal(r.ok, false);
  assert.ok(r.warnings.some((w) => w.code === "HOST_UNTESTED"));
  const ok = compatReport({ hostVersion: "0.2.2-rc.1", bridgeVersion: "0.4.0", entryName: PACKAGE_NAME });
  assert.equal(ok.ok, true);
});

test("profile 迁移：依赖/bundles/insert 名都换成 scoped，且幂等", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-profile-"));
  try {
    const profile = path.join(tmp, "profiles", "web");
    const plugin = path.join(tmp, "plugin");
    fs.mkdirSync(profile, { recursive: true });
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version: "9.9.9" }));
    fs.writeFileSync(path.join(profile, "package.json"), JSON.stringify({
      name: "p",
      dependencies: { [LEGACY_PACKAGE_NAME]: "link:" + plugin },
      dsh: { profile: { bundles: ["a", LEGACY_PACKAGE_NAME] } },
    }, null, 2));
    fs.writeFileSync(path.join(profile, "cordis.patch.yml"), "- insert:\n    - id: dsh-purge\n      name: dsh-purge\n");
    fs.mkdirSync(path.join(profile, "node_modules"), { recursive: true });
    fs.symlinkSync(plugin, path.join(profile, "node_modules", LEGACY_PACKAGE_NAME), "dir");

    const first = migrateLegacyProfileIdentity(profile);
    assert.equal(first.error, null);
    const pkg = JSON.parse(fs.readFileSync(path.join(profile, "package.json"), "utf8"));
    assert.ok(pkg.dependencies[PACKAGE_NAME]);
    assert.ok(!pkg.dependencies[LEGACY_PACKAGE_NAME]);
    assert.ok(pkg.dsh.profile.bundles.includes(PACKAGE_NAME));
    assert.match(fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8"), /name: "@panda11445go\/dsh-purge"/);
    const scoped = path.join(profile, "node_modules", ...PACKAGE_NAME.split("/"));
    assert.equal(fs.realpathSync(scoped), fs.realpathSync(plugin));

    const entry = readProfileEntry(tmp);
    assert.equal(entry?.depName, PACKAGE_NAME);
    assert.equal(entry?.inBundles, true);

    assert.ok(!fs.existsSync(path.join(profile, "node_modules", LEGACY_PACKAGE_NAME)), "旧裸名链接应被清理");

    const second = migrateLegacyProfileIdentity(profile);
    assert.equal(second.changed, false);
    assert.equal(second.insert, false);
    assert.equal(second.link, false);
    assert.equal(second.legacyRemoved, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("dshTargets 覆盖兼容矩阵里的 supported 宿主", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const list = new Set([pkg.dshTarget, ...(pkg.dshTargets || [])].filter(Boolean));
  for (const h of HOST_MATRIX.filter((x) => x.status === "supported")) {
    assert.ok(list.has(h.version), `缺少 ${h.version}`);
  }
});
