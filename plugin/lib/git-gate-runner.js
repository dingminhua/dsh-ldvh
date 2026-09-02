#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMessage, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment } from "./commit-validation.js";

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
  if (diff.length === 0) issues.push("git/index_empty: candidate Index is empty");
  if (issues.length > 0) {
    process.stderr.write("LDVH Git Gate (commit-msg) failed:\n" + issues.map((issue) => `- ${issue}`).join("\n") + "\n");
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
