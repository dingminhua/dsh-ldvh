// 版本序比较单测 — lib/host-version.js（guide 区间筛选的底座）。
// 纯函数测试，零外部依赖。重点覆盖 DSH 实际用到的预发布序：alpha < rc、
// 同号段数字序、正式版 > 任何预发布、以及形态不符 fail-closed。
import assert from "node:assert/strict";
import test from "node:test";
import { parseVersion, compareVersions, tagVersion, inInterval } from "../lib/host-version.js";

test("parseVersion 解析正式版与预发布版", () => {
  assert.deepEqual(parseVersion("0.2.2"), { major: 0, minor: 2, patch: 2, prerelease: null });
  assert.deepEqual(parseVersion("0.2.1-rc.5"), { major: 0, minor: 2, patch: 1, prerelease: ["rc", "5"] });
  assert.deepEqual(parseVersion("0.2.1-alpha.1"), { major: 0, minor: 2, patch: 1, prerelease: ["alpha", "1"] });
});

test("parseVersion 对形态不符返回 null", () => {
  assert.equal(parseVersion("v1.2"), null);
  assert.equal(parseVersion("not-a-version"), null);
  assert.equal(parseVersion("0.2.1-"), null);
});

test("compareVersions 覆盖 DSH 实际版本序", () => {
  assert.ok(compareVersions("0.2.1-alpha.1", "0.2.1-alpha.2") < 0, "alpha.1 < alpha.2");
  assert.ok(compareVersions("0.2.1-alpha.5", "0.2.1-rc.1") < 0, "alpha < rc");
  assert.ok(compareVersions("0.2.1-rc.5", "0.2.2-alpha.1") < 0, "号段进位压过预发布");
  assert.ok(compareVersions("0.2.1", "0.2.1-rc.5") > 0, "正式版 > 同号预发布");
  assert.equal(compareVersions("0.2.1-rc.5", "0.2.1-rc.5"), 0);
  assert.ok(compareVersions("0.2.1-rc.9", "0.2.1-rc.10") < 0, "预发布数字按数值不按字典序");
});

test("compareVersions 对无法解析的版本号 fail-closed（抛错，不静默当相等）", () => {
  assert.throws(() => compareVersions("bogus", "0.2.1"), /无法解析/u);
  assert.throws(() => compareVersions("0.2.1", "bogus"), /无法解析/u);
});

test("tagVersion 从 tag 名与裸版本号提取", () => {
  assert.equal(tagVersion("dsh-v0.2.2-rc.1"), "0.2.2-rc.1");
  assert.equal(tagVersion("0.2.2-rc.1"), "0.2.2-rc.1");
  assert.throws(() => tagVersion("release-candidate"), /无法从 tag/u);
});

test("inInterval 是左开右闭 (base, target]", () => {
  assert.equal(inInterval("0.2.2-alpha.2", "0.2.1-rc.5", "0.2.2-rc.1"), true);
  assert.equal(inInterval("0.2.2-rc.1", "0.2.1-rc.5", "0.2.2-rc.1"), true, "target 本身在区间内");
  assert.equal(inInterval("0.2.1-rc.5", "0.2.1-rc.5", "0.2.2-rc.1"), false, "base 本身不在区间内");
  assert.equal(inInterval("0.2.1-alpha.1", "0.2.1-rc.5", "0.2.2-rc.1"), false, "早于 base 的回填目录不进区间");
});
