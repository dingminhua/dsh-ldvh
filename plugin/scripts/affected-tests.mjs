#!/usr/bin/env node
/**
 * 按改动影响面选跑测试（2026-10-30）。
 *
 * WHY
 * 全量套件约 122s，而绝大多数改动只碰一两个模块。改一处就跑全量，把时间花在
 * 与被改代码无关的文件上；全量的价值在发布/推送这种「要一个完整结论」的时刻。
 *
 * HOW
 * 用 acorn 解析 `lib/`、`test/`、`scripts/` 里的每个文件，抽出三类引用：
 *   1. 静态 `import ... from "./x.js"`；
 *   2. 动态 `import("./x.js")`（lib 里有 12 处，正则扫字符串会漏掉上下文）；
 *   3. 源码里出现的 `lib/<name>.js` 路径字面量——子进程 spawn 与「按路径读文件
 *      当文本比对」都不产生 import 边，静态图看不见它们。
 * 然后反向可达：改动文件 → 依赖它的文件 → …… → 测试文件。
 *
 * DESIGN CONSTRAINT——漏判会给出假通过，所以一律朝「多跑」失败：
 *   - 依赖图里的任何相对引用解析不到（文件不存在 / 非字面量 / `..` 越界）都记
 *     warning；warning 存在时本脚本**不声明局部结论成立**，只在退出码与输出里
 *     如实标注，由调用方决定。
 *   - 认不出的路径（`specs/`、`ldvh-base/`、`web/`、`package.json`、锁文件、
 *     eslint 配置、以及任何不在已知面内的文件）→ 直接判全量。这些要么是全局
 *     契约源，要么会影响所有用例的语义。
 *   - 改动文件完全没有任何测试可达 → 不返回「无测试可跑所以通过」，而是列入
 *     `uncovered` 并以非零退出码报告。空集不等于绿。
 *
 * 与 specs/06 的关系：`specs/06-Code 实践与测试规范.md` §4 规定全量入口；本脚本
 * 是开发期的局部入口，**不改变发布/推送必须全量的要求**。
 *
 * 用法：
 *   node scripts/affected-tests.mjs --run                 # 与工作区/暂存区比较后跑局部
 *   node scripts/affected-tests.mjs --run --base HEAD~1   # 与某个提交比较
 *   node scripts/affected-tests.mjs --files lib/a.js ...  # 显式给出改动文件
 *   node scripts/affected-tests.mjs                       # 只打印计划，不跑
 */
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

/**
 * 一改动就必须全量的路径。判据不是「文件很大」，而是「它的影响面在静态图里
 * 不可枚举」：契约源、依赖锁、lint 配置、Web 构建输入，以及测试基础设施本身
 * （helpers 被谁用是可达的，但它同时是很多用例的语义前提）。
 */
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

/**
 * 从一颗 AST 里抽出所有字面量形式的引用。非字面量（模板/变量）记入 opaque。
 *
 * WHY 走 AST 而不是正则扫源码：路径字面量里**混在注释中的提及**会被正则当成
 * 依赖。实测本仓 `lib|scripts|test/<name>.js` 形态的匹配有 369 处，其中 126 处
 * 在注释里（「参见 lib/source-recall.js」这类说明），它们把所有模块连成一片，
 * 使任一改动都能反向到达 58–62 个测试文件，局部测试失去意义。AST 的字符串
 * 字面量节点天然不含注释，实测降到 252 处真实引用。
 *
 * 覆盖三类边：
 *   1. 静态 `import ... from`（含 re-export 的 `from`）；
 *   2. 动态 `import(...)`；参数非字面量时记 opaque（方向朝「多跑」）；
 *   3. 任意字符串字面量里出现的 `lib/<name>.js` 形态——子进程 spawn 与「按路径
 *      读文件当文本比对」都不产生 import 边，静态 import 图看不见它们。
 */
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

/**
 * 构建依赖图。
 * 返回 { files, edges: Map<绝对路径, Set<绝对路径>>, warnings }。
 */
export async function buildGraph(root) {
  const files = [];
  for (const dir of SURFACE_DIRS) await listSurfaceFiles(root, dir, files);
  files.sort();
  const known = new Set(files);

  const edges = new Map();
  const warnings = [];
  /** 依赖无法静态确定的文件——它们可能依赖任何东西，必须当通配依赖方处理。 */
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
        // 自引用（文件在自己的字符串里出现自己的路径）不是依赖边。
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

/** 反向图：被依赖 -> 依赖它的文件集合。 */
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

/**
 * 计算改动影响面。
 *
 * 三种输出，**没有一种叫「无事可做」**：
 *   - "full"      —— 改动落在影响面不可静态枚举的路径上，或不在已知面内；
 *   - "partial"   —— 得出确定的测试集合；
 *   - "uncovered" —— 改动没有任何测试可达。空集不等于通过，调用方须据此失败。
 *
 * @returns {{ mode: "full"|"partial"|"uncovered", reason: string, tests: string[], uncovered: string[], warnings: string[] }}
 */
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

  /**
   * 逐个改动文件各做一次反向 BFS——不能把所有起点混在一起跑一次：
   * 反向图从起点出发只会收集「依赖起点的文件」，起点自身永不进入结果集，
   * 混跑就分不清「这个改动没有任何测试依赖它」与「另一个改动有」。
   * 直接改到的测试文件本身算作它自己的测试（它当然要跑）。
   */
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
    // 有依赖无法静态确定的测试文件时，任何改动都可能牵动它们——一律纳入，
    // 并因而不宣称「无测试覆盖」。
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
  // 未提交改动 + 已暂存改动；--base 时改为与某提交比较。
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
  // 仓库根的 specs/、ldvh-base/ 等在 plugin/ 之上；用仓库根为基准换算。
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

async function runTests(relTests) {
  const { spawn } = await import("node:child_process");
  const args = ["--test"];
  if (process.platform !== "win32") args.push("--test-force-exit");
  args.push(...(relTests.length > 0 ? relTests : ["test/*.test.mjs"]));
  await new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, { cwd: pluginRoot, stdio: "inherit" });
    child.on("exit", (code, signal) => {
      if (signal !== null) {
        process.stderr.write(`test runner terminated by signal ${signal}\n`);
        process.exitCode = 1;
      } else {
        process.exitCode = code ?? 1;
      }
      resolveRun();
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
