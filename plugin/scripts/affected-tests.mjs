#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "acorn";

const execFileAsync = promisify(execFile);
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const SURFACE_DIRS = ["lib", "test", "scripts"];
const SURFACE_EXTENSIONS = [".js", ".mjs", ".cjs"];
const TEST_SUFFIX = ".test.mjs";

const FULL_SUITE_TRIGGERS = [
  { test: (p) => p.startsWith("specs/"), why: "规范源是所有事实类型契约的依据" },
  { test: (p) => p.startsWith("ldvh-base/"), why: "事实源内容被多个用例直接读取" },
  { test: (p) => p.startsWith("web/"), why: "Web 构建输入影响着所有 web 相关用例" },
  { test: (p) => p === "package.json", why: "依赖与入口变化影响整个套件" },
  { test: (p) => p === "package-lock.json" || p === "pnpm-lock.yaml", why: "依赖锁变化影响整个套件" },
  { test: (p) => p.startsWith("eslint.config"), why: "lint 配置是 preflight 的输入" },
  { test: (p) => p === "test/helpers.mjs", why: "测试基础设施被大多数用例依赖" },
];

async function listSurfaceFiles(root, dir, acc = []) {
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "fixtures") continue;
      await listSurfaceFiles(root, rel, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SURFACE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    acc.push(rel.split(sep).join("/"));
  }
  return acc;
}

const REFERENCE_PATTERN = /(?:^|\/)((?:lib|scripts|test)\/[A-Za-z0-9._-]+\.(?:m?js|cjs))$/;

function collectRefs(ast, opaque) {
  const refs = new Set();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") {
      if (node.source?.type === "Literal" && typeof node.source.value === "string") refs.add(node.source.value);
    }
    if (node.type === "ImportExpression") {
      if (node.source?.type === "Literal" && typeof node.source.value === "string") {
        refs.add(node.source.value);
      } else {
        opaque.push("动态 import 的参数不是字面量");
      }
    }
    if (node.type === "Literal" && typeof node.value === "string") {
      const match = REFERENCE_PATTERN.exec(node.value);
      if (match !== null) refs.add(`@@path:${match[1]}`);
    }
    if (node.type === "TemplateLiteral") {
      const text = node.quasis.map((quasi) => quasi.value.raw).join("${}");
      if (/(?:lib|scripts|test)\//.test(text)) opaque.push("模板字面量里疑似有路径引用");
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      walk(node[key]);
    }
  };
  walk(ast);
  return refs;
}

export async function buildGraph(root) {
  const files = [];
  for (const dir of SURFACE_DIRS) await listSurfaceFiles(root, dir, files);
  files.sort();
  const known = new Set(files);

  const edges = new Map();
  const warnings = [];
  const opaqueFiles = new Set();
  for (const rel of files) {
    const abs = join(root, rel);
    const source = await readFile(abs, "utf8");
    const opaque = [];
    const refs = collectRefs(parse(source, { ecmaVersion: "latest", sourceType: "module" }), opaque);
    for (const reason of opaque) warnings.push(`${rel}: ${reason}（该依赖无法静态确定）`);
    if (opaque.length > 0) opaqueFiles.add(abs);

    const out = new Set();
    for (const spec of refs) {
      if (spec.startsWith("@@path:")) {
        const target = spec.slice("@@path:".length);
        if (target === rel) continue;
        if (known.has(target)) out.add(resolve(join(root, target)));
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const resolved = resolve(dirname(abs), spec);
      const relTarget = relative(root, resolved).split(sep).join("/");
      if (known.has(relTarget)) out.add(resolved);
    }
    edges.set(abs, out);
  }
  return { files: files.map((f) => join(root, f)), edges, warnings, opaqueFiles };
}

function reverseIndex(edges) {
  const reverse = new Map();
  for (const [from, tos] of edges) {
    for (const to of tos) {
      if (!reverse.has(to)) reverse.set(to, new Set());
      reverse.get(to).add(from);
    }
  }
  return reverse;
}

export async function computeAffectedTests({ root = pluginRoot, changedPaths }) {
  const changed = changedPaths.map((p) => p.split(sep).join("/"));
  const trigger = changed.find((p) => FULL_SUITE_TRIGGERS.some((entry) => entry.test(p)));
  if (trigger !== undefined) {
    const why = FULL_SUITE_TRIGGERS.find((entry) => entry.test(trigger)).why;
    return { mode: "full", reason: `改动 ${trigger} 需全量：${why}`, tests: [], uncovered: [], warnings: [] };
  }

  const graph = await buildGraph(root);
  const reverse = reverseIndex(graph.edges);
  const warnings = [...graph.warnings];
  const opaqueTests = [...graph.opaqueFiles].filter((file) => file.endsWith(TEST_SUFFIX));

  const known = new Set(graph.files);
  const unknown = changed.filter((p) => !known.has(resolve(root, p)));
  if (unknown.length > 0) {
    return {
      mode: "full",
      reason: `改动 ${unknown[0]} 不在已知面内（无法判定影响面），保守跑全量`,
      tests: [],
      uncovered: [],
      warnings,
    };
  }

  const tests = new Set();
  const uncovered = [];
  for (const abs of changed.map((p) => resolve(root, p))) {
    if (abs.endsWith(TEST_SUFFIX)) {
      tests.add(relative(root, abs).split(sep).join("/"));
      continue;
    }
    const seen = new Set();
    const queue = [abs];
    let hits = 0;
    while (queue.length > 0) {
      const file = queue.pop();
      for (const dependent of reverse.get(file) ?? []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        if (dependent.endsWith(TEST_SUFFIX)) {
          tests.add(relative(root, dependent).split(sep).join("/"));
          hits += 1;
        }
        queue.push(dependent);
      }
    }
    for (const file of opaqueTests) {
      if (!seen.has(file)) tests.add(relative(root, file).split(sep).join("/"));
    }
    if (hits === 0 && opaqueTests.length === 0) uncovered.push(relative(root, abs).split(sep).join("/"));
  }
  const selected = [...tests].sort();

  if (selected.length === 0 && opaqueTests.length === 0) {
    return {
      mode: "uncovered",
      reason: `改动 ${changed.join(", ")} 没有任何测试可达——空集不等于通过`,
      tests: [],
      uncovered: uncovered.length > 0 ? uncovered : changed,
      warnings,
    };
  }

  return {
    mode: "partial",
    reason: `${changed.length} 个改动文件 → ${selected.length} 个测试文件`,
    tests: selected,
    uncovered,
    warnings,
  };
}

async function gitChangedPaths(root, base) {
  const args = base
    ? ["diff", "--name-only", base]
    : ["diff", "--name-only", "HEAD"];
  const out = await execFileAsync("git", args, { cwd: root, encoding: "utf8" });
  const untracked = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  const lines = `${out.stdout}\n${untracked.stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const repoRoot = (await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" })).stdout.trim();
  return lines.map((line) => {
    const abs = resolve(repoRoot, line);
    return relative(root, abs).split(sep).join("/");
  }).filter((p) => !p.startsWith(".."));
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "用法：node scripts/affected-tests.mjs [--run] [--base <ref>] [--files <a> <b> ...]",
        "  默认只打印计划；--run 才真的跑。",
        "",
      ].join("\n"),
    );
    return;
  }

  let changed;
  const filesFlag = argv.indexOf("--files");
  if (filesFlag !== -1) {
    changed = argv.slice(filesFlag + 1).filter((arg) => !arg.startsWith("--"));
    if (changed.length === 0) {
      process.stderr.write("--files 需要至少一个路径\n");
      process.exitCode = 2;
      return;
    }
  } else {
    changed = await gitChangedPaths(pluginRoot, valueAfter(argv, "--base"));
  }

  if (changed.length === 0) {
    process.stdout.write("没有检测到改动——无需跑测试（并不表示套件通过）。\n");
    return;
  }

  const plan = await computeAffectedTests({ root: pluginRoot, changedPaths: changed });

  process.stdout.write(`判定：${plan.mode}\n理由：${plan.reason}\n`);
  if (plan.warnings.length > 0) {
    process.stdout.write(`\n警告（影响面无法完全静态确定，结论不完整）：\n`);
    for (const warning of plan.warnings) process.stdout.write(`  - ${warning}\n`);
  }
  if (plan.uncovered.length > 0) {
    process.stdout.write(`\n无测试覆盖的改动：\n`);
    for (const file of plan.uncovered) process.stdout.write(`  - ${file}\n`);
  }
  if (plan.mode === "full") {
    process.stdout.write("\n→ 跑全量\n");
    if (!argv.includes("--run")) return;
    await runTests([]);
    return;
  }
  if (plan.mode === "uncovered") {
    process.stderr.write("\n没有任何测试覆盖这些改动——不声明通过，需人工判断。\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n选中的测试文件（${plan.tests.length}）：\n`);
  for (const file of plan.tests) process.stdout.write(`  - ${file}\n`);
  if (!argv.includes("--run")) return;
  await runTests(plan.tests);
}

async function countDeclaredIn(relTests) {
  const { countTestBlocks } = await import("../lib/test-run-report.js");
  let files = relTests;
  if (files.length === 0) {
    files = (await readdir(join(pluginRoot, "test")))
      .filter((name) => name.endsWith(".test.mjs"))
      .map((name) => join("test", name));
  }
  let total = 0;
  for (const file of files) {
    const text = await readFile(join(pluginRoot, file), "utf8");
    total += countTestBlocks(text);
  }
  return total;
}

async function runTests(relTests) {
  const { spawn } = await import("node:child_process");
  const { observedTestCount, observedSkippedCount, reconcileTestCount } = await import("../lib/test-run-report.js");
  const args = ["--test"];
  if (process.platform !== "win32") args.push("--test-force-exit");
  args.push(...(relTests.length > 0 ? relTests : ["test/*.test.mjs"]));
  let declared = null;
  try {
    declared = await countDeclaredIn(relTests);
  } catch (error) {
    process.stderr.write(`test-count guard: could not count declared tests (${error?.message ?? error})\n`);
  }
  await new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, { cwd: pluginRoot, stdio: ["inherit", "pipe", "inherit"] });
    let tail = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      tail = (tail + chunk.toString()).slice(-131072);
    });
    child.on("close", (code, signal) => {
      if (signal !== null) {
        process.stderr.write(`test runner terminated by signal ${signal}\n`);
        process.exitCode = 1;
      } else {
        process.exitCode = code ?? 1;
      }
      if (process.exitCode === 0) {
        const check = reconcileTestCount({
          observed: observedTestCount({ stdout: tail }),
          declared,
          baseline: null,
          skipped: observedSkippedCount({ stdout: tail }),
          skippedBaseline: null,
        });
        if (!check.ok) {
          process.stderr.write(`test-count guard(affected): ${check.verdict}（${check.evidence}）\n`);
          process.exitCode = 1;
        }
      }
      resolveRun();
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
