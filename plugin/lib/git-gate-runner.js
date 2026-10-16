#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMessage, checkKeyChangesAgainstDiff, checkNormDirectionUniqueness, isNormCarrierPath, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding, checkDocsReferences, isSpecOrFactCarrierPath, checkLoadBearingDeclarations, collectDeclarationReferenceTokens, isSpecCarrierPath, LOAD_BEARING_MARKER, checkRemovalBasisDeclarations, collectRemovalBasisDeclarations, extractSectionText } from "./commit-validation.js";

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

/** 当次候选树里 `specs/01-*.md` 的路径（§7.2 的载体）。取不到返回 null。 */
async function findSpecCarrierOne(worktree, indexFile) {
  try {
    // `-z` is mandatory, not stylistic: with the default `core.quotepath=true`
    // Git C-quotes a non-ASCII path (`"specs/01-\350\247\204..."`), and that
    // escaped spelling is NOT addressable — the follow-up `git show :<path>`
    // dies with "path does not exist" even though the file is right there.
    // Observed on Windows against this repository's own Chinese spec
    // filenames; the effect was a false §7.2 unverifiable/unreadable verdict.
    // NUL separation returns the path verbatim on every platform.
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
 * Carriers for the load-bearing declaration check (01 §7 末段, 09 §5.3 item 6).
 *
 * Scope is the CHANGED spec paths: a declaration can only disappear from a
 * carrier this commit touches, so scanning every spec file would be cost
 * without a finding. Deletions are included on purpose — deleting a spec file
 * removes every declaration in it, which is exactly what the rule governs.
 *
 * A read that fails for a path its own tree listing DOES name is reported as
 * unreadable rather than silently read as "no declarations": the check has to
 * fail closed there (09 §5.3 item 6), and "I could not read the baseline" is
 * not the same fact as "the baseline had no declarations".
 */
async function collectLoadBearingDeclarations(worktree, changedPaths, indexFile) {
  const carriers = [];
  const unreadable = [];
  // Both listings are consumed as a set MEMBERSHIP test against `changedPaths`,
  // which comes from a `-z` diff and is therefore verbatim. A `ls-tree` left at
  // the default `core.quotepath=true` C-quotes non-ASCII paths, so `has(path)`
  // could never match and a real HEAD path would be misreported as absent
  // (which the caller turns into "baseline had no declarations"). `-z`/NUL
  // keeps both sides in the same spelling on every platform.
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
    // Nothing to compare and nothing at risk: skip without reading further.
    if (!baseline.includes(LOAD_BEARING_MARKER)) continue;
    carriers.push({ path, content, baseline });
  }
  return { carriers, unreadable, knownPaths };
}

/** Path listing for one Git query; an unreadable tree yields an empty set. */
async function treePaths(worktree, args, indexFile, separator) {
  try {
    return new Set((await git(worktree, args, indexFile)).split(separator).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Fact carriers the repository already holds at HEAD or in the Index. */
async function allFactPaths(worktree, indexFile) {
  const head = await treePaths(worktree, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "ldvh-base"], indexFile, "\0");
  const staged = await treePaths(worktree, ["ls-files", "--cached", "-z", "--", "ldvh-base"], indexFile, "\0");
  return [...head, ...staged];
}

/**
 * Can a 关键变更 reference token be resolved? Two forms are accepted (09 §5.3
 * item 6): a commit hash reachable in this repository, or a fact object_uid
 * that names a fact carrier the repository holds. Resolution is deliberately
 * about EXISTENCE, not about content: whether the referenced conclusion really
 * says what the committer implies stays a review/human question (the rule's
 * stated boundary), and the check must not pretend otherwise.
 */
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

/**
 * Does the repository hold a fact carrier that DECLARES this object_uid?
 *
 * Resolving a fact reference by file name alone would tie the check to a
 * naming convention no mechanism enforces: a carrier named without its uid
 * (or a future singleton carrier) would be refused even though the object it
 * names exists. The carrier's own `object_uid` line is the declaration that
 * counts, so both sources are consulted — the HEAD tree and the Index, since a
 * reference may point at an object this very commit is landing.
 */
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
      // git grep exits 1 on "no match"; an unreadable tree lands here too.
      // Neither is evidence of absence, so the next source decides.
    }
  }
  return false;
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

  // 01 §7 末段 + 09 §5.3 item 6 (Human 2026-10-15): a load-bearing declaration
  // must not be removed — nor stripped of its 恢复条件 element — without the
  // commit carrying a resolvable independent-review reference. The rule exists
  // because a declaration was once withdrawn on the strength of "the examples I
  // named are done" while six further residues were still present.
  const declarations = await collectLoadBearingDeclarations(root, correspondence.changedPaths ?? [], indexFile);
  if (declarations.carriers.length > 0 || declarations.unreadable.length > 0) {
    const resolvable = new Set();
    for (const token of collectDeclarationReferenceTokens(message)) {
      if (await referenceResolvable(root, indexFile, token, declarations.knownPaths)) resolvable.add(token);
    }
    const outcome = checkLoadBearingDeclarations(declarations.carriers, { message, resolvable, unreadable: declarations.unreadable });
    if (!outcome.ok) issues.push(...outcome.issues);
  }

  // 09 §5.3 item 7 (Human 决定 2026-10-15): 以「§7.2 违规」为由删除规范内容时，消息
  // 须携带逐字引用 §7.2 原文的声明，且该引用须在当次 §7.2 文本中逐字存在。来历见
  // commit-validation.js 的说明；强度边界为「只在自愿申报时生效」。
  if (collectRemovalBasisDeclarations(message).length > 0) {
    // HEAD 与候选两版并集：本次提交可能正是要删掉被引的那句（那样它不在候选里），
    // 而本项抓的是**编造判据**——两版都没有即引用不成立。
    const sections = [];
    try {
      const specOne = await findSpecCarrierOne(root, indexFile);
      if (specOne !== null) {
        sections.push(extractSectionText(await git(root, ["show", `:${specOne}`], indexFile)));
        sections.push(extractSectionText(await git(root, ["show", `HEAD:${specOne}`], indexFile)));
      }
    } catch {
      sections.push(null); // fail-closed: a declared basis that cannot be verified blocks
    }
    const basis = checkRemovalBasisDeclarations({ message, sectionTexts: sections });
    if (!basis.ok) issues.push(...basis.issues);
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
