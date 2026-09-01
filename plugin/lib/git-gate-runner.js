#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HEADER_PATTERN = /^(feat|fix|docs|refactor|test|chore|build|ci|perf|style)(?:\([a-z0-9-]+\))?: .+/;
const SIGNATURES = ["LDVH-Product-Name", "LDVH-Model-Name"];

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : void 0;
}

function cleanEnvironment(extra = {}) {
  const env = { ...process.env, ...extra, GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(env)) if (["GIT_COMMON_DIR", "GIT_CONFIG_COUNT", "GIT_DIR", "GIT_OBJECT_DIRECTORY", "GIT_WORK_TREE"].includes(key) || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
  return env;
}

async function git(worktree, args, indexFile) {
  const env = cleanEnvironment(indexFile === void 0 ? {} : { GIT_INDEX_FILE: indexFile });
  const result = await execFileAsync("git", ["-C", worktree, ...args], { env, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
}

function validateMessage(message) {
  const issues = [];
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  if (!HEADER_PATTERN.test(lines[0] ?? "")) issues.push("validation/header_invalid: first line must be a conventional commit header");
  const keyIndexes = lines.flatMap((line, index) => line === "关键变更:" ? [index] : []);
  if (keyIndexes.length !== 1 || !lines.slice(keyIndexes[0] + 1).some((line) => line.startsWith("- ") && line.slice(2).trim().length > 0)) issues.push("validation/key_changes_required: body must contain one 关键变更: section with a non-empty - item");
  for (const name of SIGNATURES) {
    const matches = lines.filter((line) => line.startsWith(`${name}:`) && line.slice(name.length + 1).trim().length > 0);
    if (matches.length !== 1) issues.push(`validation/signature_trailer_missing: footer requires exactly one ${name}:`);
  }
  return issues;
}

async function main(argv) {
  if (argv[0] !== "git-commit-msg") throw new Error("unsupported runner command");
  const workspaceRoot = valueAfter(argv, "--workspace-root");
  const worktree = valueAfter(argv, "--worktree");
  const messageFile = valueAfter(argv, "--message-file");
  const indexFile = valueAfter(argv, "--index-file");
  if (![workspaceRoot, worktree, messageFile].every((value) => typeof value === "string" && isAbsolute(value))) throw new Error("workspace-root, worktree, and message-file must be absolute paths");
  const root = resolve(worktree);
  const workspace = resolve(workspaceRoot);
  const rel = relative(root, workspace);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("workspace-root must be outside or above the governed Git root");
  const message = await readFile(messageFile, "utf8");
  const issues = validateMessage(message);
  const diff = await git(root, ["diff", "--cached", "--binary", "--no-ext-diff"], indexFile);
  if (diff.length === 0) issues.push("git/index_empty: candidate Index is empty");
  if (issues.length > 0) {
    process.stderr.write("LDVH Git Gate (commit-msg) failed:\n" + issues.map((issue) => `- ${issue}`).join("\n") + "\n");
    return 1;
  }
  const sourceFingerprint = createHash("sha256").update("dsh-ldvh-git-gate-v1", "utf8").digest("hex");
  const snapshotIdentity = createHash("sha256").update(diff, "utf8").update("\0").update(message, "utf8").digest("hex");
  process.stderr.write(`LDVH Git Gate (commit-msg) passed: source_fingerprint=${sourceFingerprint} snapshot_identity=${snapshotIdentity}\n`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`LDVH Git Gate (commit-msg) unavailable: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
}
