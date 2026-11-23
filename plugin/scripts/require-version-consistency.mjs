import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHANGELOG_FIRST = /^## \[(\d+\.\d+\.\d+(?:-[\w.]+)?)\]/m;
const VERSION_FIELD = /"version"\s*:\s*"(\d+\.\d+\.\d+(?:-[\w.]+)?)"/;
const README_CN_ALL = /^>\s*(?:\*\*[^*]+\*\*\s*[｜|]\s*)?版本\s*`([^`]+)`/gm;
const README_EN_ALL = /^>\s*(?:\*\*[^*]+\*\*\s*[｜|]\s*)?Version\s*`([^`]+)`/gm;

export const DECLARATION_POINTS = Object.freeze([
  "plugin/CHANGELOG.md",
  "plugin/package.json",
  "plugin/README.md",
  "README.md",
  "package.json",
]);

export const DERIVED_POINTS = Object.freeze(["plugin/README.en.md"]);

function readText(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function versionsIn(rel, text) {
  if (rel === "plugin/CHANGELOG.md") {
    const m = text.match(CHANGELOG_FIRST);
    return m ? [m[1]] : [];
  }
  if (rel.endsWith("package.json")) {
    const m = text.match(VERSION_FIELD);
    return m ? [m[1]] : [];
  }
  const re = rel.endsWith("README.en.md") ? README_EN_ALL : README_CN_ALL;
  return [...text.matchAll(re)].map((m) => m[1]);
}

function pointState(root, rel) {
  const text = readText(root, rel);
  return { rel, present: text !== null, versions: text === null ? [] : versionsIn(rel, text) };
}

export function detectMode(root) {
  const text = readText(root, "plugin/package.json");
  const m = text && text.match(VERSION_FIELD);
  return m && m[1].includes("-dev.") ? "dev" : "release";
}

export function inspectVersionDeclarations(root, modeOverride) {
  const mode = modeOverride ?? detectMode(root);
  const points = DECLARATION_POINTS.map((rel) => pointState(root, rel));
  const derived = DERIVED_POINTS.map((rel) => pointState(root, rel));

  const required = mode === "release"
    ? DECLARATION_POINTS
    : DECLARATION_POINTS.filter((rel) => rel !== "package.json");

  const problems = [];
  for (const p of points) {
    if (!required.includes(p.rel)) continue;
    if (!p.present) {
      problems.push(`${p.rel}: 不存在（${mode} 模式下此声明点必需）`);
    } else if (p.versions.length === 0) {
      problems.push(`${p.rel}: 在位但提取不到版本（格式不符）`);
    }
  }

  const values = [...new Set(points.flatMap((p) => p.versions))];
  if (values.length > 1) {
    problems.push(`版本不一致：${values.join(" / ")}`);
  }

  const warnings = [];
  for (const d of derived) {
    if (d.versions.length > 0 && !values.includes(d.versions[0])) {
      warnings.push(`${d.rel}: 版本 ${d.versions[0]} 与中文声明点不一致（英文衍生件，非阻断，以中文版为准）`);
    }
  }

  const checked = points.filter((p) => p.versions.length > 0).length;
  return {
    mode,
    points,
    derived,
    checked,
    values,
    warnings,
    problems,
    consistent: problems.length === 0 && values.length === 1,
  };
}

export function assertVersionConsistency(root, modeOverride) {
  const report = inspectVersionDeclarations(root, modeOverride);
  if (report.consistent) return report;
  const lines = [
    ...report.points.map((p) => `  ${p.rel}: ${p.versions.length ? p.versions.join(" / ") : (p.present ? "在位但未提取到版本" : "不存在")}`),
    ...report.derived.map((p) => `  ${p.rel}: ${p.versions.length ? p.versions.join(" / ") : "未提取到版本"}`),
    ...report.warnings.map((w) => `  [警告] ${w}`),
  ];
  throw new Error(`version gate（${report.mode} 模式）:\n${report.problems.map((p) => `  - ${p}`).join("\n")}\n${lines.join("\n")}`);
}

const self = resolve(fileURLToPath(import.meta.url));
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === self) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const explicit = process.argv.includes("--release") ? "release" : process.argv.includes("--dev") ? "dev" : undefined;
  try {
    const report = assertVersionConsistency(root, explicit);
    for (const w of report.warnings) console.error(`version gate 警告: ${w}`);
    console.error(`version gate（${report.mode}）: ${report.checked} 处一致 — ${report.values[0]}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
