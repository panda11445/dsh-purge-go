import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ALL_PATCHES } from "../lib/core.js";
import { HOST_MATRIX } from "../lib/compat.js";

// 每个宿主版本一份真实片段 fixture；CI 只跑这些 JSON，不需要宿主树/网络。
const fixtureDir = new URL("./fixtures/", import.meta.url);
const fixtureFiles = fs.readdirSync(fixtureDir)
  .filter((f) => /^dsh-.*-patch-snippets\.json$/.test(f))
  .sort();

function applyReplacement(text, replacement) {
  if (typeof replacement.pattern === "string") {
    assert.ok(text.includes(replacement.pattern), "string pattern 未命中片段");
    return text.split(replacement.pattern).join(replacement.replace);
  }
  const re = new RegExp(replacement.pattern.source, replacement.pattern.flags.replace(/g/g, ""));
  assert.ok(re.test(text), "regex pattern 未命中片段");
  re.lastIndex = 0;
  return text.replace(re, replacement.replace);
}

test("至少覆盖 0.2.2-rc.1 与 0.2.1-rc.4 两份真实宿主片段", () => {
  const versions = new Set();
  for (const file of fixtureFiles) versions.add(JSON.parse(fs.readFileSync(new URL(file, fixtureDir), "utf8")).version);
  for (const v of ["0.2.2-rc.1", "0.2.1-rc.4"]) assert.ok(versions.has(v), `缺少 ${v} 的片段 fixture`);
});

for (const file of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(new URL(file, fixtureDir), "utf8"));
  test(`宿主 ${fixture.version}：变体仍能命中真实片段，且可重复应用`, () => {
    assert.ok(HOST_MATRIX.some((h) => h.version === fixture.version && h.status === "supported"), "fixture 版本不在矩阵");
    assert.ok(Object.keys(fixture.patches).length > 0, "fixture 没有补丁片段");
    for (const [idText, row] of Object.entries(fixture.patches)) {
      const id = Number(idText);
      const patch = ALL_PATCHES.find((p) => p.id === id);
      assert.ok(patch, `补丁 #${id} 不存在`);
      assert.ok(row.entries.length > 0, `补丁 #${id} 没有采到片段`);
      for (const entry of row.entries) {
        const replacement = patch.replacements[entry.index];
        assert.ok(replacement, `补丁 #${id} 缺少 replacement[${entry.index}]`);
        const once = applyReplacement(entry.snippet, replacement);
        assert.notEqual(once, entry.snippet, `补丁 #${id} replacement[${entry.index}] 没有产生变化`);
        // 两类合法变体：
        //  - 覆盖式：替换后原文不再出现；
        //  - 追加式（replace 保留 pattern 再补 marker）：靠 markers 的 [dsh-purge] 识别已应用。
        const stillMatches = typeof replacement.pattern === "string"
          ? once.includes(replacement.pattern)
          : new RegExp(replacement.pattern.source, replacement.pattern.flags.replace(/g/g, "")).test(once);
        if (stillMatches) {
          // 追加式变体（替换保留原文再加内容）无法靠「pattern 不再命中」判断幂等，
          // 必须依赖补丁级 marker + skipIfMarked；没有 marker 的补丁不允许这种写法。
          assert.ok((patch.markers || []).length > 0 || patch.markersAny, `补丁 #${id} 是追加式但缺少 patch 级 marker`);
        }
      }
    }
  });
}
