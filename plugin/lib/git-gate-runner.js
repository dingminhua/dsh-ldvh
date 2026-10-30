#!/usr/bin/env node
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMessage, checkKeyChangesAgainstDiff, checkNormDirectionUniqueness, isNormCarrierPath, snapshotIdentity, SOURCE_FINGERPRINT, cleanGitEnvironment, newFinding, checkDocsReferences, isSpecOrFactCarrierPath, extractDiffPaths, checkLoadBearingDeclarations, collectDeclarationReferenceTokens, isSpecCarrierPath, LOAD_BEARING_MARKER, checkRemovalBasisDeclarations, collectRemovalBasisDeclarations, extractSectionText, isFrictionCarrierPath, checkFrictionCommitTargets } from "./commit-validation.js";

const execFileAsync = promisify(execFile);

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : void 0;
}

/**
 * Per-run memo for READ-ONLY git queries.
 *
 * WHY: one gate run asks the same question several times. `ls-files --cached
 * -z` is issued by `runSharedChecks` (the empty-Index check), by the friction
 * scan, and by `candidateTreePaths` — three spawns per run for one answer, and
 * each spawn costs ~18ms. Measured on a full `installHook` (4 gate runs): 12
 * spawns of that one command out of 60 total.
 *
 * SAFETY: only read-only queries are memoized, and the map is cleared at the
 * start of every run (`runSharedChecks`), so nothing survives into a state
 * where the Index or HEAD could have moved. Writes (`hash-object -w`,
 * `update-index`, `read-tree`) never go through here — they are issued by
 * `hook-manager.js` with its own `runGit`.
 */
let GIT_READ_CACHE = new Map();

function gitReadCacheKey(worktree, args, indexFile) {
  return `${worktree}\0${indexFile ?? ""}\0${args.join("\0")}`;
}

async function git(worktree, args, indexFile) {
  const cacheKey = gitReadCacheKey(worktree, args, indexFile);
  const memo = GIT_READ_CACHE.get(cacheKey);
  if (memo !== undefined) return memo;
  const env = cleanGitEnvironment(indexFile === void 0 ? {} : { GIT_INDEX_FILE: indexFile });
  // maxBuffer must hold the WHOLE staged diff: a bulk commit (e.g. deleting a
  // large directory) legitimately produces a multi-megabyte diff, and hitting
  // the ceiling surfaces as "unavailable" — the gate refuses a commit over a
  // carrier-size limit, not a contract violation. 4MB was measured too small
  // (a 214-file deletion produced 4.59MiB) and it also disagreed with the
  // precheck entrypoint, whose limit is 8MB; 09 §5.1 requires both entries of
  // the same check to agree. Kept identical to ldvh-tools.js's precheck bound.
  const result = await execFileAsync("git", ["-C", worktree, ...args], { env, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  GIT_READ_CACHE.set(cacheKey, result.stdout);
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

/**
 * The checks both entrypoints converge on, run against the STAGED bytes.
 *
 * Extracted so pre-commit and commit-msg cannot drift: the point of putting a
 * check at the commit seam (rather than in the writer) is that EVERY write path
 * passes through it, and that guarantee evaporates the moment the two Hooks
 * run different check lists.
 */
async function runSharedChecks(root, indexFile, message) {
  // Drop the read memo first: this is the only entry point into the checks, so
  // a fresh Map per run guarantees no answer outlives the Index/HEAD state it
  // was read from.
  GIT_READ_CACHE = new Map();
  const issues = [];
  // "Empty Index" means it HOLDS NO ENTRIES, not "the diff renders as zero
  // bytes": measuring the rendered diff misses an index whose entries are all
  // deletions (the diff is non-empty but nothing remains), and `git diff
  // --cached` can emit bytes for an index that tracks nothing. ls-files is the
  // question actually being asked, and it is what makes the pre-commit
  // preflight's "refuses an empty Index" assertion mean something.
  const tracked = (await git(root, ["ls-files", "--cached", "-z"], indexFile)).split("\0").filter(Boolean);
  if (tracked.length === 0) issues.push(newFinding("git/index_empty", "candidate Index is empty"));
  const diff = await git(root, ["diff", "--cached", "--binary", "--no-ext-diff"], indexFile);
  // The changed-path list must NOT come from checkKeyChangesAgainstDiff: that
  // helper returns no `changedPaths` at all when the message lacks a usable
  // 关键变更 section, and every check that feeds on it (norm uniqueness, docs
  // references, load-bearing declarations, removal basis) then silently scans
  // nothing. That is exactly the fail-OPEN shape this seam exists to close —
  // a commit with a malformed message used to skip the load-bearing rules
  // entirely (measured: stripping a 恢复条件 element passed the gate). Paths are
  // taken from the diff itself so they are available regardless of message.
  const changedPaths = extractDiffPaths(diff);
  const correspondence = { changedPaths };

  // 27 §11 uniqueness, second layer: assert Count(direction_key=d ∧
  // status="active") ≤ 1 across the carriers this commit would contain.
  // The writer refuses such a write up front (layer 1) and consumption fails
  // closed (layer 3), but neither covers a hand-edited or shell-written
  // carrier — that is exactly the bypass this layer exists to catch.
  // 26 §11: a friction's `informs` target must exist and resolve — including the
  // commit-exception form. The writer enforces this on create/update/correct,
  // but a carrier written straight to disk and committed never passes through
  // the writer (measured: friction-ed844630 entered the ledger that way, carrying
  // two commit ids that never existed in this repository and rendered as dead
  // links in the Web UI). The commit seam is the only point every write path
  // converges on, so the same rule is re-asserted here against the STAGED bytes.
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
        // Unreadable staged bytes cannot be verified: fail closed with a finding
        // rather than letting an unverified carrier through.
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

  // 09 §5.3 item 5 (Human 2026-10-12): docs/ is temporary-only, so a carrier
  // this commit adds or modifies must not reference a docs/ path that does not
  // exist. Only NEW dangling references block — pre-existing ones are cleaned
  // up gradually per the Human's instruction and must not stop commits.
  const changedCarriers = await collectChangedCarriers(root, message ?? "", diff, indexFile);
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
    for (const token of collectDeclarationReferenceTokens(message ?? "")) {
      if (await referenceResolvable(root, indexFile, token, declarations.knownPaths)) resolvable.add(token);
    }
    const outcome = checkLoadBearingDeclarations(declarations.carriers, { message: message ?? "", resolvable, unreadable: declarations.unreadable });
    if (!outcome.ok) issues.push(...outcome.issues);
  }

  // 09 §5.3 item 7 (Human 决定 2026-10-15): 以「§7.2 违规」为由删除规范内容时，消息
  // 须携带逐字引用 §7.2 原文的声明，且该引用须在当次 §7.2 文本中逐字存在。来历见
  // commit-validation.js 的说明；强度边界为「只在自愿申报时生效」。
  if (collectRemovalBasisDeclarations(message ?? "").length > 0) {
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
    const basis = checkRemovalBasisDeclarations({ message: message ?? "", sectionTexts: sections });
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

/**
 * Report findings the way both entrypoints must: the rule ID stays on stderr
 * so a failing check is referenceable (K1), and the Hook name is named so an
 * interrupted commit says which stage refused it.
 */
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
  // The workspace root may legitimately live inside the governed repo: link
  // installs and self-governing (dogfood) repos ship the plugin runtime under
  // the very tree the gate protects, so only absolute-path validation applies.
  // The v5 gate is anchored by the user-config registration, not by a v4-style
  // external workspace layout.
  const root = resolve(worktree);
  const message = await readFile(messageFile, "utf8");
  const shared = await runSharedChecks(root, indexFile, message);
  const correspondence = checkKeyChangesAgainstDiff(message, shared.diff);
  const issues = [...validateMessage(message), ...shared.issues];
  if (!correspondence.ok) issues.push(...correspondence.issues);
  if (issues.length > 0) return report("commit-msg", issues);
  const snapshot = snapshotIdentity(shared.diff, message);
  process.stderr.write(`LDVH Git Gate (commit-msg) passed: source_fingerprint=${SOURCE_FINGERPRINT} snapshot_identity=${snapshot}\n`);
  return 0;
}

/**
 * pre-commit entrypoint: lint, and nothing message-shaped.
 *
 * Runs BEFORE the message exists, so every check that needs a message
 * (key-change correspondence, load-bearing declarations, removal basis) is
 * absent here — not forgotten, structurally unavailable. commit-msg runs the
 * full list a moment later.
 */
async function mainPreCommit(argv) {
  const workspaceRoot = valueAfter(argv, "--workspace-root");
  const worktree = valueAfter(argv, "--worktree");
  const indexFile = valueAfter(argv, "--index-file");
  if (![workspaceRoot, worktree].every((value) => typeof value === "string" && isAbsolute(value))) throw new Error("workspace-root and worktree must be absolute paths");
  const root = resolve(worktree);
  const issues = [...(await runSharedChecks(root, indexFile)).issues];
  // The lint surface is the PLUGIN's workspace (where eslint.config.js and
  // node_modules live), not the governed project — the same split commit-msg
  // already makes by receiving --workspace-root separately from --worktree.
  // LDVH_PREFLIGHT_INDEX overwrites it during the install preflight, whose
  // synthetic repository has no dependencies of its own.
  const lintRoot = process.env.LDVH_WORKSPACE_ROOT || workspaceRoot || root;
  const lint = await checkLint(lintRoot);
  if (!lint.ok) issues.push(...lint.issues);
  if (issues.length > 0) return report("pre-commit", issues);
  process.stderr.write("LDVH Git Gate (pre-commit) passed\n");
  return 0;
}

/**
 * Locate the eslint binary this workspace installed — never `npx`.
 *
 * Measured: `npx --no-install eslint --version` succeeds from an unrelated
 * directory (it falls back to a global/cached install), so a gate written on
 * npx would silently validate against a version nobody chose and that the
 * lockfile does not describe. An absent binary is therefore a REFUSAL, not a
 * pass: fail-closed, with an instruction, rather than a quiet downgrade.
 */
async function resolveEslint(workspaceRoot) {
  const candidate = join(workspaceRoot, "node_modules", "eslint", "bin", "eslint.js");
  try {
    await access(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Run the workspace's lint over its whole configured surface.
 *
 * Whole-surface, not the staged subset: strictness was the stated priority,
 * and a per-file run misses cross-file rules and lets a pre-existing error sit
 * untouched behind a stream of small commits. The measured cost is 2.3-3.4s
 * cold, against a test suite that already takes 40s.
 *
 * The exit code is the verdict — 0 pass, anything else refuse. The two
 * failures are then told apart in the MESSAGE, because they need different
 * fixes: real lint findings say which file and line to change, while a broken
 * config or a missing binary means the tool itself must be repaired.
 */
/**
 * 内容寻址的「lint 已通过」缓存（2026-10-30 加）。
 *
 * WHY：`installHook` 的 preflight 会真的跑一遍全仓 eslint 来证明 Hook 能挡住
 * 提交（这是它存在的意义，不能省）。但每次安装都重跑一遍：单次约 3s，而测试
 * 里有 41 处安装，实测占全套 150s 中的约 120s。
 *
 * SAFETY——这份缓存直接支撑「装上去的 Hook 确实挡住了坏提交」这一断言，所以：
 *  1. **只缓存通过**。失败一律重跑：失败要给出当次真实的行号与原因，缓存它既
 *     无用又会掩盖修复后的结果。
 *  2. **键覆盖整个 lint 面**：每个受检文件的内容、eslint 配置、eslint 版本、
 *     依赖锁。任一处变化即换键。用内容哈希而非 mtime/size——mtime 在 checkout
 *     与并行写入下不可靠，而这个判定一旦出错就等于装了个没验过的 Hook。
 *  3. **缓存不可用即重跑**（读不到、写不进、JSON 坏了都当未命中），fail-closed
 *     的方向是「多跑一次 lint」，不是「跳过 lint」。
 */
const LINT_CACHE_SCHEMA = 1;
const LINT_SURFACE_DIRS = ["lib", "test", "scripts"];
const LINT_SURFACE_EXTENSIONS = [".js", ".mjs", ".cjs"];

async function hashFile(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

/** 收集 lint 面内的全部文件（相对 workspaceRoot，已排序）。fixtures 不在面内。 */
async function collectLintSurface(workspaceRoot, dir, acc) {
  let entries;
  try {
    entries = await readdir(join(workspaceRoot, dir), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "fixtures") continue;
      await collectLintSurface(workspaceRoot, rel, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!LINT_SURFACE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    acc.push(rel);
  }
  return acc;
}

async function lintCacheKey(workspaceRoot, eslint) {
  const hash = createHash("sha256");
  hash.update(`schema:${LINT_CACHE_SCHEMA}\0`);
  hash.update(`eslint:${eslint}\0`);
  // eslint 版本与依赖锁：依赖换了，规则的实际含义就可能变。
  for (const meta of [join("node_modules", "eslint", "package.json"), "package-lock.json", "eslint.config.js"]) {
    try {
      hash.update(`${meta}\0${await hashFile(join(workspaceRoot, meta))}\0`);
    } catch {
      hash.update(`${meta}\0missing\0`);
    }
  }
  const files = [];
  for (const dir of LINT_SURFACE_DIRS) await collectLintSurface(workspaceRoot, dir, files);
  files.sort();
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
    // 写不进缓存不影响正确性——下次重跑而已。
  }
}

async function checkLint(workspaceRoot) {
  const eslint = await resolveEslint(workspaceRoot);
  if (eslint === null) {
    return { ok: false, issues: [newFinding("validation/lint_failed", `eslint is not installed in ${workspaceRoot}/node_modules — run npm ci there before committing (the gate refuses rather than skipping lint)`, null)] };
  }
  const cacheKey = await lintCacheKey(workspaceRoot, eslint);
  if (await readLintCache(workspaceRoot, cacheKey)) return { ok: true, issues: [], cached: true };
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(process.execPath, [eslint, ".", "--no-cache"], { cwd: workspaceRoot, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
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
  // eslint's "tool failed" exit path leads with this banner; a plain lint
  // failure prints per-file findings instead. The distinction only changes the
  // wording of the refusal — both refuse.
  const toolFault = /Oops! Something went wrong|ESLint couldn't find|SyntaxError:/.test(report);
  const detail = report.split("\n").slice(0, 40).join("\n");
  return { ok: false, issues: [newFinding("validation/lint_failed", toolFault ? `eslint could not analyze the workspace (repair the lint configuration or reinstall dependencies):\n${detail}` : `eslint reported findings:\n${detail}`, null)] };
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
