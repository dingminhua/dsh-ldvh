#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMessage, checkKeyChangesAgainstDiff, checkNormDirectionUniqueness, isNormCarrierPath, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding } from "./commit-validation.js";

const execFileAsync = promisify(execFile);

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : void 0;
}

async function git(worktree, args, indexFile) {
  const env = cleanGitEnvironment(indexFile === void 0 ? {} : { GIT_INDEX_FILE: indexFile });
  const result = await execFileAsync("git", ["-C", worktree, ...args], { env, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
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
