import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAllowBuildLine,
  parseAllowBuildLine,
  rewritePnpmAllowBuilds,
  validateAllowBuildRewrite,
} from "../lib/profile-insert.js";

// 1.5.2：`@scope/name: true` 裸写在 YAML 里是非法的（`@` 是保留指示符），
// pnpm 会报 "bad indentation of a mapping entry"，之后整个 profile 装不了任何包。
test("scoped 包名的 allowBuilds 键必须加引号", () => {
  assert.equal(formatAllowBuildLine("@panda11445go/dsh-purge"), '  "@panda11445go/dsh-purge": true');
  assert.equal(formatAllowBuildLine("dsh-purge"), "  dsh-purge: true");
  assert.equal(formatAllowBuildLine("dsh-purge@https://x/y.tgz"), '  "dsh-purge@https://x/y.tgz": true');
});

test("格式化后的行能被无损解析回同一个键", () => {
  for (const key of ["@panda11445go/dsh-purge", "dsh-purge", "dsh-purge@https://x/y.tgz"]) {
    assert.equal(parseAllowBuildLine(formatAllowBuildLine(key))?.key, key, key);
  }
});

test("rewritePnpmAllowBuilds 产出里不再有裸 @ 键", () => {
  const raw = "allowBuilds:\n  dsh-purge: true\n  @panda11445go/dsh-purge: true\n";
  const next = rewritePnpmAllowBuilds(raw);
  assert.ok(!/^\s*@/m.test(next), `仍有裸 @ 键：\n${next}`);
  assert.ok(next.includes('"@panda11445go/dsh-purge": true'), next);
  assert.ok(validateAllowBuildRewrite(next), "写回校验应通过");
});

test("rewritePnpmAllowBuilds 幂等：二次重写不再变化", () => {
  const once = rewritePnpmAllowBuilds("allowBuilds:\n  dsh-purge: true\n");
  const twice = rewritePnpmAllowBuilds(once);
  assert.equal(twice, once);
});
