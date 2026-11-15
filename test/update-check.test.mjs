import test from "node:test";
import assert from "node:assert/strict";
import {
  GH_REPO,
  PKG_NAME,
  cachedUpdate,
  compareVersions,
  pickTarballAsset,
  releaseTarballUrl,
} from "../lib/update-check.js";

test("版本比较：正式版高于预发布", () => {
  assert.equal(compareVersions("1.5.3", "1.5.2"), 1);
  assert.equal(compareVersions("1.5.2", "1.5.2"), 0);
  assert.equal(compareVersions("1.5.2", "1.6.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.5.2", "1.5.2-rc.1"), 1);
  assert.equal(compareVersions("1.5.2-rc.2", "1.5.2-rc.1"), 1);
  assert.equal(compareVersions("1.5.2-rc.10", "1.5.2-rc.9"), 1);
  // 无法解析时按"不更新"处理，避免把人劝去装垃圾版本
  assert.equal(compareVersions("not-a-version", "1.5.2"), 0);
});

test("更新只走本仓库的 GitHub Release，不再有 npm registry", () => {
  assert.equal(GH_REPO, "panda11445/dsh-purge-go");
  assert.equal(
    releaseTarballUrl("1.0.0"),
    "https://github.com/panda11445/dsh-purge-go/releases/download/v1.0.0/panda11445go-dsh-purge-1.0.0.tgz",
  );
  assert.ok(releaseTarballUrl("1.0.0", "o/r").startsWith("https://github.com/o/r/releases/download/v1.0.0/"));
});

test("优先用 Release 里上传的 tgz 资产", () => {
  const asset = "https://github.com/panda11445/dsh-purge-go/releases/download/v1.0.0/p.tgz";
  const release = {
    tag_name: "v1.0.0",
    assets: [
      { name: "sha256.txt", browser_download_url: "https://example.com/sha256.txt" },
      { name: "p.tgz", browser_download_url: asset },
    ],
  };
  assert.equal(pickTarballAsset(release), asset);
  assert.equal(pickTarballAsset({ assets: [] }), "");
  assert.equal(pickTarballAsset(null), "");
});

test("cachedUpdate 只读缓存，不发请求", () => {
  const info = cachedUpdate();
  assert.equal(typeof info.checked, "boolean");
  assert.equal(typeof info.hasUpdate, "boolean");
  assert.equal(typeof info.current, "string");
  assert.ok(info.current.length > 0, "本地版本应可读");
  assert.equal(typeof PKG_NAME, "string");
});
