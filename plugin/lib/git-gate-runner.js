#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMessage, checkKeyChangesAgainstDiff, checkNormDirectionUniqueness, isNormCarrierPath, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding, checkDocsReferences, isSpecOrFactCarrierPath, extractDiffPaths, checkLoadBearingDeclarations, collectDeclarationReferenceTokens, isSpecCarrierPath, LOAD_BEARING_MARKER, checkRemovalBasisDeclarations, collectRemovalBasisDeclarations, extractSectionText, isFrictionCarrierPath, checkFrictionCommitTargets, checkFactCarrierIdentity, factCarrierType, checkSignatureAgainstRoute, touchesGovernedContent } from "./commit-validation.js";
import { currentRouteValuesFromShellEnvironment } from "./session-signature.js";

const execFileAsync = promisify(execFile);

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : void 0;
}

let GIT_READ_CACHE = new Map();

function gitReadCacheKey(worktree, args, indexFile) {
  return `${worktree}\0${indexFile ?? ""}\0${args.join("\0")}`;
}

async function git(worktree, args, indexFile) {
  const cacheKey = gitReadCacheKey(worktree, args, indexFile);
  const memo = GIT_READ_CACHE.get(cacheKey);
  if (memo !== undefined) return memo;
  const env = cleanGitEnvironment(indexFile === void 0 ? {} : { GIT_INDEX_FILE: indexFile });
  const result = await execFileAsync("git", ["-C", worktree, ...args], { env, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  GIT_READ_CACHE.set(cacheKey, result.stdout);
  return result.stdout;
}

async function collectNormCarriers(worktree, changedPaths, indexFile) {
  const carry = new Map();

  let staged = [];
  try {
    staged = (await git(worktree, ["ls-files", "--cached", "-z"], indexFile)).split("\0").filter(Boolean);
  } catch {
    staged = [];
  }
  for (const path of staged) {
    if (!isNormCarrierPath(path)) continue;
    try {
      carry.set(path, await git(worktree, ["show", `:${path}`], indexFile));
    } catch {
      carry.set(path, "");
    }
  }

  const tracked = new Set(staged);
  let onDisk = [];
  try {
    onDisk = (await git(worktree, ["ls-files", "--others", "--cached", "--exclude-standard", "-z"], indexFile)).split("\0").filter(Boolean);
  } catch {
    onDisk = [];
  }
  for (const path of new Set([...onDisk, ...changedPaths])) {
    if (!isNormCarrierPath(path) || carry.has(path)) continue;
    try {
      carry.set(path, await readFile(resolve(worktree, path), "utf8"));
    } catch {
      if (tracked.has(path)) carry.set(path, "");
    }
  }

  return [...carry.entries()].map(([path, content]) => ({ path, content }));
}


async function findSpecCarrierOne(worktree, indexFile) {
  try {
    const listed = await git(worktree, ["ls-files", "--cached", "-z", "--", "specs/01-*.md"], indexFile);
    const first = String(listed ?? "").split("\0").find((line) => line.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

async function collectChangedCarriers(worktree, message, diff, indexFile) {
  const paths = (checkKeyChangesAgainstDiff(message, diff).changedPaths ?? []);
  const changed = await changedPathStatuses(worktree, indexFile);
  const carriers = [];
  for (const path of paths) {
    if (!isSpecOrFactCarrierPath(path)) continue;
    const entry = changed.get(path);
    const status = entry?.letter;
    if (status !== undefined && !["A", "M", "R", "C", "T"].includes(status)) continue;
    let content;
    try {
      content = await git(worktree, ["show", `:${path}`], indexFile);
    } catch {
      continue;
    }
    const baselinePath = entry?.oldPath ?? path;
    let baseline;
    try {
      baseline = await git(worktree, ["show", `HEAD:${baselinePath}`], indexFile);
    } catch {
      baseline = status === "A" ? void 0 : null;
    }
    carriers.push({ path, content, baseline });
  }
  return carriers;
}

async function collectLoadBearingDeclarations(worktree, changedPaths, indexFile) {
  const carriers = [];
  const unreadable = [];
  const headPaths = await treePaths(worktree, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "specs"], indexFile, "\0");
  const indexPaths = await treePaths(worktree, ["ls-files", "--cached", "-z", "--", "specs"], indexFile, "\0");
  const knownPaths = new Set([...headPaths, ...indexPaths, ...(await allFactPaths(worktree, indexFile))]);
  for (const path of changedPaths) {
    if (!isSpecCarrierPath(path)) continue;
    let baseline = "";
    try {
      baseline = await git(worktree, ["show", `HEAD:${path}`], indexFile);
    } catch {
      if (headPaths.has(path)) unreadable.push(path);
    }
    let content = "";
    try {
      content = await git(worktree, ["show", `:${path}`], indexFile);
    } catch {
      if (indexPaths.has(path)) unreadable.push(path);
    }
    if (!baseline.includes(LOAD_BEARING_MARKER)) continue;
    carriers.push({ path, content, baseline });
  }
  return { carriers, unreadable, knownPaths };
}

async function treePaths(worktree, args, indexFile, separator) {
  try {
    return new Set((await git(worktree, args, indexFile)).split(separator).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function allFactPaths(worktree, indexFile) {
  const head = await treePaths(worktree, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "ldvh-base"], indexFile, "\0");
  const staged = await treePaths(worktree, ["ls-files", "--cached", "-z", "--", "ldvh-base"], indexFile, "\0");
  return [...head, ...staged];
}

async function referenceResolvable(worktree, indexFile, token, knownPaths) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) {
    if ([...knownPaths].some((path) => path.startsWith("ldvh-base/") && path.includes(token))) return true;
    return await declaresObjectUid(worktree, indexFile, token);
  }
  try {
    await git(worktree, ["rev-parse", "--verify", "--quiet", `${token}^{commit}`], indexFile);
    return true;
  } catch {
    return false;
  }
}

async function declaresObjectUid(worktree, indexFile, token) {
  const pattern = `^object_uid: ${token}$`;
  const queries = [
    ["grep", "-l", "-E", pattern, "HEAD", "--", "ldvh-base"],
    ["grep", "--cached", "-l", "-E", pattern, "--", "ldvh-base"]
  ];
  for (const args of queries) {
    try {
      const out = await git(worktree, args, indexFile);
      if (out.trim().length > 0) return true;
    } catch {
    }
  }
  return false;
}

async function candidateTreePaths(worktree, indexFile) {
  const paths = new Set();
  const add = (raw) => {
    for (const path of raw.split("\0")) if (path) paths.add(path);
  };
  try {
    add(await git(worktree, ["ls-files", "--cached", "-z"], indexFile));
  } catch {
  }
  try {
    add(await git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"], indexFile));
  } catch {
  }
  try {
    add(await git(worktree, ["ls-files", "--deleted", "-z"], indexFile));
  } catch {
  }
  return paths;
}

async function changedPathStatuses(worktree, indexFile) {
  const statuses = new Map();
  let raw = "";
  try {
    raw = await git(worktree, ["diff", "--cached", "--name-status", "--no-ext-diff", "-z"], indexFile);
  } catch {
    return statuses;
  }
  const fields = raw.split("\0").filter(Boolean);
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    if (!/^[A-Z]/.test(status)) continue;
    const letter = status[0];
    if (letter === "R" || letter === "C") {
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (typeof newPath === "string") {
        statuses.set(newPath, { letter, oldPath: typeof oldPath === "string" ? oldPath : null });
      }
      index += 2;
      continue;
    }
    const path = fields[index + 1];
    if (typeof path === "string") statuses.set(path, { letter, oldPath: null });
    index += 1;
  }
  return statuses;
}

async function runSharedChecks(root, indexFile, message) {
  const hasMessage = typeof message === "string";
  GIT_READ_CACHE = new Map();
  const issues = [];
  const tracked = (await git(root, ["ls-files", "--cached", "-z"], indexFile)).split("\0").filter(Boolean);
  if (tracked.length === 0) issues.push(newFinding("git/index_empty", "candidate Index is empty"));
  const diff = await git(root, ["diff", "--cached", "--binary", "--no-ext-diff"], indexFile);
  const changedPaths = extractDiffPaths(diff);
  const correspondence = { changedPaths };

  {
    let staged = [];
    try {
      staged = (await git(root, ["ls-files", "--cached", "-z"], indexFile)).split("\0").filter(Boolean);
    } catch {
      staged = [];
    }
    const frictionCarriers = [];
    for (const path of staged) {
      if (!isFrictionCarrierPath(path)) continue;
      try {
        frictionCarriers.push({ path, content: await git(root, ["show", `:${path}`], indexFile) });
      } catch {
        frictionCarriers.push({ path, content: "" });
      }
    }
    if (frictionCarriers.length > 0) {
      const frictionCommits = await checkFrictionCommitTargets(frictionCarriers, {
        resolves: async (hash) => {
          try {
            await git(root, ["cat-file", "-e", `${hash}^{commit}`], indexFile);
            return true;
          } catch {
            return false;
          }
        },
      });
      if (!frictionCommits.ok) issues.push(...frictionCommits.issues);
    }
  }

  const normCarriers = await collectNormCarriers(root, correspondence.changedPaths ?? [], indexFile);
  if (normCarriers.length > 0) {
    const uniqueness = checkNormDirectionUniqueness(normCarriers);
    if (!uniqueness.ok) issues.push(...uniqueness.issues);
  }

  {
    const factCarriers = [];
    let stagedPaths = [];
    try {
      stagedPaths = (await git(root, ["ls-files", "--cached", "-z"], indexFile)).split("\0").filter(Boolean);
    } catch {
      stagedPaths = [];
    }
    for (const path of stagedPaths) {
      if (factCarrierType(path) === null) continue;
      let content = "";
      try {
        content = await git(root, ["show", `:${path}`], indexFile);
      } catch {
        content = "";
      }
      factCarriers.push({ path, content });
    }
    if (factCarriers.length > 0) {
      const identity = checkFactCarrierIdentity(factCarriers);
      if (!identity.ok) issues.push(...identity.issues);
    }
  }

  if (hasMessage) {
    const changedCarriers = await collectChangedCarriers(root, message, diff, indexFile);
    if (changedCarriers.length > 0) {
      const candidatePaths = await candidateTreePaths(root, indexFile);
      const docsRefs = checkDocsReferences(changedCarriers, { exists: (p) => candidatePaths.has(p) });
      if (!docsRefs.ok) issues.push(...docsRefs.issues);
    }
  }


  const declarations = await collectLoadBearingDeclarations(root, correspondence.changedPaths ?? [], indexFile);
  if (hasMessage && (declarations.carriers.length > 0 || declarations.unreadable.length > 0)) {
    const resolvable = new Set();
    for (const token of collectDeclarationReferenceTokens(message)) {
      if (await referenceResolvable(root, indexFile, token, declarations.knownPaths)) resolvable.add(token);
    }
    const outcome = checkLoadBearingDeclarations(declarations.carriers, { message, resolvable, unreadable: declarations.unreadable });
    if (!outcome.ok) issues.push(...outcome.issues);
  }

  if (hasMessage && collectRemovalBasisDeclarations(message).length > 0) {
    const sections = [];
    try {
      const specOne = await findSpecCarrierOne(root, indexFile);
      if (specOne !== null) {
        sections.push(extractSectionText(await git(root, ["show", `:${specOne}`], indexFile)));
        sections.push(extractSectionText(await git(root, ["show", `HEAD:${specOne}`], indexFile)));
      }
    } catch {
      sections.push(null);
    }
    const basis = checkRemovalBasisDeclarations({ message, sectionTexts: sections });
    if (!basis.ok) issues.push(...basis.issues);
  }

  return { root, indexFile, issues, diff, correspondence };
}

async function main(argv) {
  const command = argv[0];
  if (command === "git-pre-commit") return mainPreCommit(argv);
  if (command !== "git-commit-msg") throw new Error("unsupported runner command");
  return runCommitMsgChecks(argv);
}

function report(hookName, issues) {
  if (issues.length === 0) return 0;
  process.stderr.write(`LDVH Git Gate (${hookName}) failed:\n` + issues.map((issue) => `- ${issue.rule}: ${issue.message}`).join("\n") + "\n");
  return 1;
}

async function runCommitMsgChecks(argv) {
  const workspaceRoot = valueAfter(argv, "--workspace-root");
  const worktree = valueAfter(argv, "--worktree");
  const messageFile = valueAfter(argv, "--message-file");
  const indexFile = valueAfter(argv, "--index-file");
  if (![workspaceRoot, worktree, messageFile].every((value) => typeof value === "string" && isAbsolute(value))) throw new Error("workspace-root, worktree, and message-file must be absolute paths");
  const root = resolve(worktree);
  const message = await readFile(messageFile, "utf8");
  const dispatchDiff = await git(root, ["diff", "--cached", "--no-ext-diff"], indexFile);
  const stagedPaths = extractDiffPaths(dispatchDiff);
  if (stagedPaths.length > 0 && !touchesGovernedContent(stagedPaths)) {
    process.stderr.write("LDVH Git Gate (commit-msg) passed: ordinary commit (no managed carrier, spec carrier, repository-root README.md touched) — controlled-commit checks skipped per 09 §5.5\n");
    return 0;
  }
  const shared = await runSharedChecks(root, indexFile, message);
  const correspondence = checkKeyChangesAgainstDiff(message, shared.diff);
  const issues = [...validateMessage(message), ...shared.issues];
  if (!correspondence.ok) issues.push(...correspondence.issues);
  const route = await currentRouteValuesFromShellEnvironment();
  if (!route.ok) {
    issues.push(newFinding("validation/signature_source_unverifiable", `the authoritative session route could not be resolved in this Hook: ${route.reason}`));
  } else {
    issues.push(...checkSignatureAgainstRoute(message, route).issues);
  }
  if (issues.length > 0) return report("commit-msg", issues);
  const snapshot = snapshotIdentity(shared.diff, message);
  process.stderr.write(`LDVH Git Gate (commit-msg) passed: source_fingerprint=${SOURCE_FINGERPRINT} snapshot_identity=${snapshot}\n`);
  return 0;
}

async function mainPreCommit(argv) {
  const workspaceRoot = valueAfter(argv, "--workspace-root");
  const worktree = valueAfter(argv, "--worktree");
  const indexFile = valueAfter(argv, "--index-file");
  if (![workspaceRoot, worktree].every((value) => typeof value === "string" && isAbsolute(value))) throw new Error("workspace-root and worktree must be absolute paths");
  const root = resolve(worktree);
  const issues = [...(await runSharedChecks(root, indexFile, null)).issues];
  const lintRoot = process.env.LDVH_WORKSPACE_ROOT || workspaceRoot || root;
  const lintFiles = await stagedLintFiles(lintRoot, root, indexFile);
  const lint = await checkLint(lintRoot, lintFiles);
  if (!lint.ok) issues.push(...lint.issues);
  if (issues.length > 0) return report("pre-commit", issues);
  process.stderr.write("LDVH Git Gate (pre-commit) passed\n");
  return 0;
}

async function resolveEslint(workspaceRoot) {
  const candidate = join(workspaceRoot, "node_modules", "eslint", "bin", "eslint.js");
  try {
    await access(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

const LINT_CACHE_SCHEMA = 2;
const LINT_SURFACE_EXTENSIONS = [".js", ".mjs", ".cjs"];

async function hashFile(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

async function stagedLintFiles(workspaceRoot, worktree, indexFile) {
  let raw = "";
  try {
    raw = await git(worktree, ["diff", "--cached", "--name-status", "--no-ext-diff", "-z"], indexFile);
  } catch {
    return [];
  }
  const repoPaths = [];
  const fields = raw.split("\0").filter(Boolean);
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    if (!/^[A-Z]/.test(status)) continue;
    const letter = status[0];
    if (letter === "R" || letter === "C") {
      const newPath = fields[index + 2];
      if (typeof newPath === "string") repoPaths.push(newPath);
      index += 2;
      continue;
    }
    const path = fields[index + 1];
    if (typeof path === "string") {
      if (letter !== "D") repoPaths.push(path);
      index += 1;
    } else {
      index += 1;
    }
  }
  const prefix = relative(worktree, workspaceRoot).split(sep).join("/");
  const kept = [];
  for (const repoPath of repoPaths) {
    if (!LINT_SURFACE_EXTENSIONS.some((ext) => repoPath.endsWith(ext))) continue;
    if (prefix.startsWith("..") || isAbsolute(prefix)) continue;
    if (prefix !== "") {
      if (repoPath === prefix) continue;
      if (!repoPath.startsWith(`${prefix}/`)) continue;
    }
    const rel = prefix === "" ? repoPath : repoPath.slice(prefix.length + 1);
    try {
      await access(join(workspaceRoot, rel), constants.R_OK);
    } catch {
      continue;
    }
    kept.push(rel);
  }
  kept.sort();
  return kept;
}

async function lintCacheKey(workspaceRoot, eslint, files) {
  const hash = createHash("sha256");
  hash.update(`schema:${LINT_CACHE_SCHEMA}\0`);
  hash.update(`eslint:${eslint}\0`);
  for (const meta of [join("node_modules", "eslint", "package.json"), "package-lock.json", "eslint.config.js"]) {
    try {
      hash.update(`${meta}\0${await hashFile(join(workspaceRoot, meta))}\0`);
    } catch {
      hash.update(`${meta}\0missing\0`);
    }
  }
  for (const rel of files) {
    try {
      hash.update(`${rel}\0${await hashFile(join(workspaceRoot, rel))}\0`);
    } catch {
      hash.update(`${rel}\0unreadable\0`);
    }
  }
  return hash.digest("hex");
}

function lintCachePath(workspaceRoot, key) {
  return join(workspaceRoot, "node_modules", ".cache", "ldvh-lint", `${key}.json`);
}

async function readLintCache(workspaceRoot, key) {
  try {
    const raw = await readFile(lintCachePath(workspaceRoot, key), "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.key === key && parsed?.ok === true;
  } catch {
    return false;
  }
}

async function writeLintCache(workspaceRoot, key) {
  try {
    const path = lintCachePath(workspaceRoot, key);
    await mkdir(join(workspaceRoot, "node_modules", ".cache", "ldvh-lint"), { recursive: true });
    await writeFile(path, JSON.stringify({ key, ok: true, at: new Date().toISOString() }), "utf8");
  } catch {
  }
}

async function checkLint(workspaceRoot, files) {
  const eslint = await resolveEslint(workspaceRoot);
  if (eslint === null) {
    return { ok: false, issues: [newFinding("validation/lint_failed", `eslint is not installed in ${workspaceRoot}/node_modules — run npm ci there before committing (the gate refuses rather than skipping lint)`, null)] };
  }
  if (files.length === 0) return { ok: true, issues: [], skipped: "no-lint-files" };
  const cacheKey = await lintCacheKey(workspaceRoot, eslint, files);
  if (await readLintCache(workspaceRoot, cacheKey)) return { ok: true, issues: [], cached: true };
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(process.execPath, [eslint, ...files, "--no-cache", "--no-warn-ignored"], { cwd: workspaceRoot, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    ({ stdout, stderr } = result);
  } catch (error) {
    if (typeof error?.code !== "number") {
      return { ok: false, issues: [newFinding("validation/lint_failed", `eslint could not run: ${String(error?.message || error)}`, null)] };
    }
    code = error.code;
    stdout = error?.stdout ?? "";
    stderr = error?.stderr ?? "";
  }
  if (code === 0) {
    await writeLintCache(workspaceRoot, cacheKey);
    return { ok: true, issues: [] };
  }
  const report = `${stdout}${stderr}`.trim();
  const toolFault = /Oops! Something went wrong|ESLint couldn't find|SyntaxError:|No files matching the pattern/.test(report);
  const detail = report.split("\n").slice(0, 40).join("\n");
  return { ok: false, issues: [newFinding("validation/lint_failed", toolFault ? `eslint could not analyze the workspace (repair the lint configuration or reinstall dependencies):\n${detail}` : `eslint reported findings:\n${detail}`, null)] };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`LDVH Git Gate (commit-msg) unavailable: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
