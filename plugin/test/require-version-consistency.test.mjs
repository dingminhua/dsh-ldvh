import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectVersionDeclarations, assertVersionConsistency, DECLARATION_POINTS } from "../scripts/require-version-consistency.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "version-gate-"));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const V = "1.1.3";

function releaseFiles(version = V) {
  return {
    "plugin/CHANGELOG.md": `## [Unreleased]\n\n## [${version}] — 2026-11-23\n`,
    "plugin/package.json": `{"name":"dsh-ldvh","version":"${version}"}`,
    "plugin/README.md": `> 版本 \`${version}\` · MIT License · 面向 DSH Desktop \`0.2.2-rc.5\`\n`,
    "README.md": `> 版本 \`${version}\` ｜ MIT License\n`,
    "package.json": `{"name":"dsh-ldvh","version":"${version}"}`,
  };
}

function devFiles(version = "1.0.0-dev.1") {
  return {
    "plugin/CHANGELOG.md": `## [${version}] — 2026-09-25\n`,
    "plugin/package.json": `{"name":"dsh-ldvh","version":"${version}"}`,
    "plugin/README.md": `> 版本 \`${version}\`（开发预览）· 面向 DSH Desktop \`0.2.2-rc.5\`\n`,
    "README.md": `> **开发预览** ｜ 版本 \`${version}\` ｜ MIT License\n`,
  };
}

test("release 五处齐全且一致时通过，DSH 版本 0.2.2-rc.5 不被误抓", () => {
  const { root, cleanup } = fixture(releaseFiles());
  try {
    const r = inspectVersionDeclarations(root, "release");
    assert.equal(r.mode, "release");
    assert.deepEqual(r.values, [V]);
    assert.equal(r.consistent, true);
    assert.equal(assertVersionConsistency(root).consistent, true);
  } finally { cleanup(); }
});

test("release 态缺根 manifest 必须失败", () => {
  const files = releaseFiles();
  delete files["package.json"];
  const { root, cleanup } = fixture(files);
  try {
    assert.throws(() => assertVersionConsistency(root, "release"), (e) => {
      assert.match(e.message, /package\.json: 不存在/);
      return true;
    });
  } finally { cleanup(); }
});

test("release 态缺根 README 必须失败", () => {
  const files = releaseFiles();
  delete files["README.md"];
  const { root, cleanup } = fixture(files);
  try {
    assert.throws(() => assertVersionConsistency(root, "release"), /README\.md: 不存在/);
  } finally { cleanup(); }
});

test("声明点在位但版本行格式不符必须失败（不归入 skipped）", () => {
  const files = releaseFiles();
  files["README.md"] = "# 项目\n\n<a href=\"#版本号双轨\">版本</a>\n";
  const { root, cleanup } = fixture(files);
  try {
    assert.throws(() => assertVersionConsistency(root, "release"), /README\.md: 在位但提取不到版本/);
  } finally { cleanup(); }
});

test("真实 dev 根 README 形态（带 **开发预览** 前缀）必须被选中", () => {
  const { root, cleanup } = fixture(devFiles());
  try {
    const r = inspectVersionDeclarations(root);
    assert.equal(r.mode, "dev");
    assert.deepEqual(r.values, ["1.0.0-dev.1"]);
    assert.equal(r.checked, 4, "CHANGELOG + plugin/package + plugin/README + 根 README");
    assert.equal(r.consistent, true, "dev 允许根 package 缺失");
  } finally { cleanup(); }
});

test("同一 README 两行版本，第二行漂移必须失败", () => {
  const files = releaseFiles();
  files["README.md"] = `> 版本 \`${V}\` ｜ MIT\n> 版本 \`1.0.4\` 的发布树\n`;
  const { root, cleanup } = fixture(files);
  try {
    assert.throws(() => assertVersionConsistency(root, "release"), /版本不一致/);
  } finally { cleanup(); }
});

test("任一声明点版本漂移必须失败并列出取值", () => {
  const files = releaseFiles();
  files["package.json"] = `{"version":"1.0.4"}`;
  const { root, cleanup } = fixture(files);
  try {
    assert.throws(() => assertVersionConsistency(root, "release"), (e) => {
      assert.match(e.message, /版本不一致：1\.1\.3 \/ 1\.0\.4/);
      return true;
    });
  } finally { cleanup(); }
});

test("CHANGELOG 跳过 Unreleased，只取最新正式条目", () => {
  const files = releaseFiles();
  files["plugin/CHANGELOG.md"] = "## [Unreleased]\n\n## [1.1.2] — latest\n\n## [9.9.9] — old\n";
  files["plugin/package.json"] = `{"version":"1.1.2"}`;
  files["plugin/README.md"] = "> 版本 `1.1.2`\n";
  files["README.md"] = "> 版本 `1.1.2`\n";
  files["package.json"] = `{"version":"1.1.2"}`;
  const { root, cleanup } = fixture(files);
  try {
    assert.deepEqual(inspectVersionDeclarations(root, "release").values, ["1.1.2"]);
  } finally { cleanup(); }
});

test("英文衍生件版本漂移只警告、不阻断（以中文版为准）", () => {
  const files = releaseFiles();
  files["plugin/README.en.md"] = "> Version `1.0.4` · MIT\n";
  const { root, cleanup } = fixture(files);
  try {
    const r = inspectVersionDeclarations(root, "release");
    assert.equal(r.consistent, true);
    assert.match(r.warnings[0], /README\.en\.md: 版本 1\.0\.4 与中文声明点不一致/);
  } finally { cleanup(); }
});

test("可核对声明点不足两处时不声称一致（防假绿）", () => {
  const { root, cleanup } = fixture({ "plugin/package.json": `{"version":"1.1.3"}` });
  try {
    assert.throws(() => assertVersionConsistency(root, "dev"), /不存在|在位但提取不到|版本不一致/);
  } finally { cleanup(); }
});

test("必需声明点清单固定为五处（README.en 是衍生件不计入）", () => {
  assert.deepEqual([...DECLARATION_POINTS], [
    "plugin/CHANGELOG.md",
    "plugin/package.json",
    "plugin/README.md",
    "README.md",
    "package.json",
  ]);
});
