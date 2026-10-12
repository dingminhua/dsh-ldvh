#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMessage, checkKeyChangesAgainstDiff, checkNormDirectionUniqueness, isNormCarrierPath, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding, checkDocsReferences, isSpecOrFactCarrierPath } from "./commit-validation.js";

const execFileAsync = promisify(execFile);

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : void 0;
}

async function git(worktree, args, indexFile) {
  const env = cleanGitEnvironment(indexFile === void 0 ? {} : { GIT_INDEX_FILE: indexFile });
  // maxBuffer must hold the WHOLE staged diff: a bulk commit (e.g. deleting a
  // large directory) legitimately produces a multi-megabyte diff, and hitting
  // the ceiling surfaces as "unavailable" — the gate refuses a commit over a
  // carrier-size limit, not a contract violation. 4MB was measured too small
  // (a 214-file deletion produced 4.59MiB) and it also disagreed with the
  // precheck entrypoint, whose limit is 8MB; 09 §5.1 requires both entries of
  // the same check to agree. Kept identical to ldvh-tools.js's precheck bound.
  const result = await execFileAsync("git", ["-C", worktree, ...args], { env, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
}

/**
 * Gather the Norm carriers a commit would introduce, as { path, content }.
 *
 * Sources, unioned by path (the Index entry wins when both exist):
 *   - every carrier STAGED in the candidate Index (authoritative for the commit);
 *   - every carrier already committed or present in the working tree, so a
 *     collision between a new carrier and an existing one is caught too. A gate
 *     that only looked at the staged set would miss "add a second active Norm
 *     for a direction that already has one".
 *
 * Fail-closed (27 §11): when a path cannot be read, it is returned with empty
 * content so the uniqueness checker reports it as unparseable rather than
 * silently dropping it.
 */
async function collectNormCarriers(worktree, changedPaths, indexFile) {
  const carry = new Map();

  // 1. Carriers present in the candidate Index (staged content, not the
  //    possibly-newer working-tree copy).
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

  // 2. Carriers on disk (committed or untracked) that this commit does not
  //    remove — a collision against an existing active Norm still blocks.
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
      // Deleted or unreadable: if it is also not in the Index this commit
      // removes it, which cannot create a collision.
      if (tracked.has(path)) carry.set(path, "");
    }
  }

  return [...carry.entries()].map(([path, content]) => ({ path, content }));
}

/**
 * Gather the carriers this commit ADDS or MODIFIES, as { path, content },
 * for the docs/-reference check (09 §5.3 item 5).
 *
 * Only added/modified paths are collected — the spec blocks NEW references
 * and explicitly does not chase pre-existing ones, so a file the commit
 * merely deletes (or leaves untouched) is out of scope. Paths outside the
 * governed class (specs/**, ldvh-base/**, root README.md) are skipped here
 * and by the checker alike.
 *
 * Content comes from the Index (`git show :path`), which is what the commit
 * would actually land — not the possibly-newer working-tree copy. The baseline
 * comes from HEAD (`git show HEAD:path`), so the checker can tell a reference
 * this commit newly introduces from one that was already there (09 §5.3 item 5
 * blocks only the former). An added file has no HEAD text: baseline stays
 * undefined, which correctly treats every reference in it as new.
 */
async function collectChangedCarriers(worktree, message, diff, indexFile) {
  const paths = (checkKeyChangesAgainstDiff(message, diff).changedPaths ?? []);
  const changed = await changedPathStatuses(worktree, indexFile);
  const carriers = [];
  for (const path of paths) {
    // Only spec/fact carriers are governed by 09 §5.3 item 5; the checker
    // applies the same filter, so skip early to avoid pointless Git reads.
    if (!isSpecOrFactCarrierPath(path)) continue;
    const status = changed.get(path);
    // A (added), M (modified), and their staged rename/copy forms only.
    if (status !== undefined && !["A", "M", "R", "C", "T"].includes(status)) continue;
    let content;
    try {
      content = await git(worktree, ["show", `:${path}`], indexFile);
    } catch {
      // Not in the Index: a working-tree-only path cannot land in this commit,
      // so it carries no reference obligation. Skip rather than fail.
      continue;
    }
    let baseline;
    try {
      baseline = await git(worktree, ["show", `HEAD:${path}`], indexFile);
    } catch {
      baseline = void 0; // newly added: every reference in it is new
    }
    carriers.push({ path, content, baseline });
  }
  return carriers;
}

/**
 * Every path the candidate tree would contain: the staged Index plus
 * working-tree files this commit does not remove. Used as the existence
 * oracle for docs/ references (09 §5.3 item 5) — a reference is dangling
 * only when its target is absent from what the commit would land.
 */
async function candidateTreePaths(worktree, indexFile) {
  const paths = new Set();
  const add = (raw) => {
    for (const path of raw.split("\0")) if (path) paths.add(path);
  };
  try {
    add(await git(worktree, ["ls-files", "--cached", "-z"], indexFile));
  } catch {
    // Unreadable Index: stay empty; the caller's findings fail closed anyway.
  }
  try {
    add(await git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"], indexFile));
  } catch {
    // Untracked listing is best-effort: Index entries remain authoritative.
  }
  try {
    add(await git(worktree, ["ls-files", "--deleted", "-z"], indexFile));
  } catch {
    // Deleted-in-worktree entries are already covered by the Index listing.
  }
  return paths;
}

/** Map of repo-relative path → staged status letter (from `--name-status`). */
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
      // rename/copy: status, old path, new path
      const newPath = fields[index + 2];
      if (typeof newPath === "string") statuses.set(newPath, letter);
      index += 2;
      continue;
    }
    const path = fields[index + 1];
    if (typeof path === "string") statuses.set(path, letter);
    index += 1;
  }
  return statuses;
}

async function main(argv) {
  if (argv[0] !== "git-commit-msg") throw new Error("unsupported runner command");
  const workspaceRoot = valueAfter(argv, "--workspace-root");
  const worktree = valueAfter(argv, "--worktree");
  const messageFile = valueAfter(argv, "--message-file");
  const indexFile = valueAfter(argv, "--index-file");
  if (![workspaceRoot, worktree, messageFile].every((value) => typeof value === "string" && isAbsolute(value))) throw new Error("workspace-root, worktree, and message-file must be absolute paths");
  // The workspace root may legitimately live inside the governed repo: link
  // installs and self-governing (dogfood) repos ship the plugin runtime under
  // the very tree the gate protects, so only absolute-path validation applies.
  // The v5 gate is anchored by the user-config registration, not by a v4-style
  // external workspace layout.
  const root = resolve(worktree);
  const message = await readFile(messageFile, "utf8");
  const issues = validateMessage(message);
  const diff = await git(root, ["diff", "--cached", "--binary", "--no-ext-diff"], indexFile);
  if (diff.length === 0) issues.push(newFinding("git/index_empty", "candidate Index is empty"));
  const correspondence = checkKeyChangesAgainstDiff(message, diff);
  if (!correspondence.ok) issues.push(...correspondence.issues);

  // 27 §11 uniqueness, second layer: assert Count(direction_key=d ∧
  // status="active") ≤ 1 across the carriers this commit would contain.
  // The writer refuses such a write up front (layer 1) and consumption fails
  // closed (layer 3), but neither covers a hand-edited or shell-written
  // carrier — that is exactly the bypass this layer exists to catch.
  const normCarriers = await collectNormCarriers(root, correspondence.changedPaths ?? [], indexFile);
  if (normCarriers.length > 0) {
    const uniqueness = checkNormDirectionUniqueness(normCarriers);
    if (!uniqueness.ok) issues.push(...uniqueness.issues);
  }

  // 09 §5.3 item 5 (Human 2026-10-12): docs/ is temporary-only, so a carrier
  // this commit adds or modifies must not reference a docs/ path that does not
  // exist. Only NEW dangling references block — pre-existing ones are cleaned
  // up gradually per the Human's instruction and must not stop commits.
  const changedCarriers = await collectChangedCarriers(root, message, diff, indexFile);
  if (changedCarriers.length > 0) {
    const candidatePaths = await candidateTreePaths(root, indexFile);
    const docsRefs = checkDocsReferences(changedCarriers, { exists: (p) => candidatePaths.has(p) });
    if (!docsRefs.ok) issues.push(...docsRefs.issues);
  }

  if (issues.length > 0) {
    // Structured findings (K1): human-readable stderr keeps the rule ID so the
    // failing check is referenceable; line stays null for diff-level findings.
    process.stderr.write("LDVH Git Gate (commit-msg) failed:\n" + issues.map((issue) => `- ${issue.rule}: ${issue.message}`).join("\n") + "\n");
    return 1;
  }
  const snapshot = snapshotIdentity(diff, message);
  process.stderr.write(`LDVH Git Gate (commit-msg) passed: source_fingerprint=${SOURCE_FINGERPRINT} snapshot_identity=${snapshot}\n`);
  return 0;
}

// CLI entry guard: this module is imported as a library by the plugin's
// tool layer (idempotent helper functions), so the commit-msg entrypoint
// must run ONLY when the file is the process entrypoint — otherwise any
// import would execute main() with the importer's argv and set a nonzero
// exit code inside a running host process.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`LDVH Git Gate (commit-msg) unavailable: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
