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
    const entry = changed.get(path);
    const status = entry?.letter;
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
    // 基线按**载体血缘**取，不按路径取（09 §5.3 第 5 项「只阻止新增引用」）：
    // 重命名/复制的载体，其「存量引用」在旧路径的 HEAD 内容里，不在新路径
    // （新路径在 HEAD 中不存在）。取新路径必然失败 → baseline 为空 →
    // preexisting 豁免整体失效。
    const baselinePath = entry?.oldPath ?? path;
    let baseline;
    try {
      baseline = await git(worktree, ["show", `HEAD:${baselinePath}`], indexFile);
    } catch {
      // 取不到基线时**不得静默当成「全新文件」**（那会把存量引用全判成
      // 新增）。区分两种情形：
      //   · 纯新增（A）：HEAD 里本无此载体，其中每条引用确实都是新的；
      //   · 重命名/复制（R/C）但旧路径读不到：血缘不可判定 → fail-closed，
      //     该载体交给检查器按「不可判定」阻断，不豁免任何引用。
      baseline = status === "A" ? void 0 : null;
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
  // Map 的值由 `letter` 升级为 `{ letter, oldPath }`：重命名/复制的**旧路径**
  // 是 09 §5.3 第 5 项判定「是否本批新增引用」的唯一正确血缘依据（见
  // collectChangedCarriers 里 baseline 的取法）。旧实现只留新路径、丢弃旧
  // 路径，于是 R 行取 `HEAD:<新路径>` 必然失败、baseline 为空，preexisting
  // 豁免整体失效——把存量引用全判成新引入（2026-11-14 独立复核定位）。
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

/**
 * The checks both entrypoints converge on, run against the STAGED bytes.
 *
 * Extracted so pre-commit and commit-msg cannot drift: the point of putting a
 * check at the commit seam (rather than in the writer) is that EVERY write path
 * passes through it, and that guarantee evaporates the moment the two Hooks
 * run different check lists.
 *
 * `message` is `null` at the pre-commit entrypoint, and that is a POSITION, not
 * a missing argument: git invokes pre-commit with no arguments, so the message
 * does not exist yet at that point in the commit's life. The three message-shaped
 * checks below are therefore SKIPPED there, explicitly — see `hasMessage`. They
 * are not skipped because someone forgot to pass the value; they are skipped
 * because there is no value to pass.
 *
 * MEASURED FAILURE THIS FIXES (2026-11-03): mainPreCommit used to call this with
 * two arguments. Every check above read `message ?? ""`, so nothing crashed and
 * nothing looked wrong — but the load-bearing exemption set is built from
 * `collectDeclarationReferenceTokens(message ?? "")`, which returns `[]` for an
 * empty message, so the exemption set was ALWAYS empty. Result: pre-commit
 * refused EVERY commit that removed or stripped a declaration, no matter what
 * reference the message carried, while commit-msg accepted the very same commit.
 * 09 §5.3 item 6's only stated release condition was structurally unreachable at
 * the earlier Hook. Both directions of that seam were wrong at once, in
 * opposite senses: the declaration check was a false REFUSAL, and the docs
 * reference check below was a false PASS (its carrier list is derived from the
 * message, so an empty message scanned zero carriers). The empty string was
 * doing double duty as "no message available" and "a message that says nothing".
 */
async function runSharedChecks(root, indexFile, message) {
  // A `null` message means the entrypoint has no message to offer. An empty
  // string is a message that happens to be empty — it must still reach the
  // checks, because "the message failed to say what it had to say" is a
  // verdict only the checks can reach. Collapsing the two is what produced the
  // false refusal described above.
  const hasMessage = typeof message === "string";
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

  // 02 §7.1 + §5 item 6 (Human Gate 批准 2026-11-04, 09 §8.1 item 2 领域增量):
  // 事实载体的身份一致性。`object_uid` 是载体自己声明的身份，文件名只是位置
  // 约定；两侧不一致、或同一 uid 被多条载体声明时，提交被拒绝。
  //
  // 为什么在提交缝：writer 的校验覆盖不到 `git add` 直接落盘（2026-10-19 的
  // friction-ed844630 就是这样绕过 writer 进账的），而提交缝是所有写入路径的
  // 唯一汇聚点——与 27 §11 的 norm 唯一性检查同一层、同一理由。
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
        content = ""; // 不可读：交给检查按 fail-closed 判定，不在此处吞掉
      }
      factCarriers.push({ path, content });
    }
    if (factCarriers.length > 0) {
      const identity = checkFactCarrierIdentity(factCarriers);
      if (!identity.ok) issues.push(...identity.issues);
    }
  }

  // 09 §5.3 item 5 (Human 2026-10-12): docs/ is temporary-only, so a carrier
  // this commit adds or modifies must not reference a docs/ path that does not
  // exist. Only NEW dangling references block — pre-existing ones are cleaned
  // up gradually per the Human's instruction and must not stop commits.
  //
  // SKIPPED at pre-commit (no message ⇒ no carrier list). `collectChangedCarriers`
  // derives its paths from `checkKeyChangesAgainstDiff(message, diff)`, which
  // returns no `changedPaths` at all when the message has no usable 关键变更
  // section — so with a null message this block scanned zero carriers and
  // passed. That was a fail-OPEN accident (see the header). It stays skipped
  // here by DECISION, not by accident: wiring this check onto the message-free
  // path list would EXTEND a rule into a Hook that never enforced it, which is
  // a 00 §3.2 decision for the Human, not a repair. commit-msg still runs it.
  if (hasMessage) {
    const changedCarriers = await collectChangedCarriers(root, message, diff, indexFile);
    if (changedCarriers.length > 0) {
      const candidatePaths = await candidateTreePaths(root, indexFile);
      const docsRefs = checkDocsReferences(changedCarriers, { exists: (p) => candidatePaths.has(p) });
      if (!docsRefs.ok) issues.push(...docsRefs.issues);
    }
  }

  // 01 §7 末段 + 09 §5.3 item 6 (Human 2026-10-15): a load-bearing declaration
  // must not be removed — nor stripped of its 恢复条件 element — without the
  // commit carrying a resolvable independent-review reference. The rule exists
  // because a declaration was once withdrawn on the strength of "the examples I
  // named are done" while six further residues were still present.
  //
  // SKIPPED at pre-commit, and this skip is the whole point of the fix: the
  // check cannot form its exemption set without a message, and running it
  // anyway refuses everything. commit-msg runs it a moment later, so a
  // declaration removal is still blocked unless the message earns the release.
  const declarations = await collectLoadBearingDeclarations(root, correspondence.changedPaths ?? [], indexFile);
  if (hasMessage && (declarations.carriers.length > 0 || declarations.unreadable.length > 0)) {
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
  //
  // SKIPPED at pre-commit: the trigger IS a message declaration, so with no
  // message there is nothing to declare and nothing to verify. Narrow by
  // design (only self-declared bases are checked), so this skip loses nothing.
  if (hasMessage && collectRemovalBasisDeclarations(message).length > 0) {
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
  // 09 §5.5 content dispatch (Human 2026-11-05): the
  // controlled-commit contract applies only when the staged content touches a
  // managed carrier (`ldvh-base/`), a spec carrier (「规范源文件」/「规则源成员」
  // share specs/ as their member set), or the repository-root AGENTS.md. An
  // ordinary commit passes here directly — before ANY controlled-commit check,
  // because that is what 「直接放行」 means; running the checks and then
  // ignoring the result would still be a different contract.
  const dispatchDiff = await git(root, ["diff", "--cached", "--no-ext-diff"], indexFile);
  const stagedPaths = extractDiffPaths(dispatchDiff);
  // An EMPTY candidate Index still reaches the checks: "nothing staged" is not
  // "an ordinary commit", and the gate's own `git/index_empty` refusal must
  // keep firing (it is also what the Hook preflight relies on).
  if (stagedPaths.length > 0 && !touchesGovernedContent(stagedPaths)) {
    process.stderr.write("LDVH Git Gate (commit-msg) passed: ordinary commit (no managed carrier, spec carrier, repository-root README.md, or AGENTS.md touched) — controlled-commit checks skipped per 09 §5.5\n");
    return 0;
  }
  const shared = await runSharedChecks(root, indexFile, message);
  const correspondence = checkKeyChangesAgainstDiff(message, shared.diff);
  const issues = [...validateMessage(message), ...shared.issues];
  if (!correspondence.ok) issues.push(...correspondence.issues);
  // 09 §5.1 (「precheck 与 Git Gate 机械校验两行 trailer 的存在、取值来源和
  // 候选一致性」) + 09 §5.5 (同一 validator). The value source is the DSH
  // authoritative session log, read by the shell channel: a Hook is a child of
  // the Git process, so it inherits DSH_SESSION_ID/DSH_HOME from the DSH shell
  // that launched the commit (verified 2026-11-05) and reads the SAME record
  // the precheck reads through the host channel.
  //
  // An unavailable route is NOT a mismatch — it is "could not judge". 09 §5.5
  // 非 passed 即阻断 makes the commit seam refuse it by name rather than pass
  // an unverified value (rule registered in GATE_RULES; the 09 §8.1 item 2
  // decision covers exactly this semantic change).
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

/**
 * pre-commit entrypoint: lint, and nothing message-shaped.
 *
 * Runs BEFORE the message exists, so every check that needs a message
 * (key-change correspondence, load-bearing declarations, removal basis) is
 * absent here — not forgotten, structurally unavailable. commit-msg runs the
 * full list a moment later.
 *
 * `null` (not `""`) is what says so, and the difference is load-bearing: it is
 * the argument through which `runSharedChecks` decides to SKIP the message-shaped
 * checks rather than run them against a message that does not exist. Passing an
 * empty string instead does not "skip" them — it runs them on a message that
 * cannot carry anything, which turned the load-bearing check into an unconditional
 * refusal (see `runSharedChecks`).
 */
async function mainPreCommit(argv) {
  const workspaceRoot = valueAfter(argv, "--workspace-root");
  const worktree = valueAfter(argv, "--worktree");
  const indexFile = valueAfter(argv, "--index-file");
  if (![workspaceRoot, worktree].every((value) => typeof value === "string" && isAbsolute(value))) throw new Error("workspace-root and worktree must be absolute paths");
  const root = resolve(worktree);
  const issues = [...(await runSharedChecks(root, indexFile, null)).issues];
  // The lint surface is the PLUGIN's workspace (where eslint.config.js and
  // node_modules live), not the governed project — the same split commit-msg
  // already makes by receiving --workspace-root separately from --worktree.
  // LDVH_PREFLIGHT_INDEX overwrites it during the install preflight, whose
  // synthetic repository has no dependencies of its own.
  const lintRoot = process.env.LDVH_WORKSPACE_ROOT || workspaceRoot || root;
  const lintFiles = await stagedLintFiles(lintRoot, root, indexFile);
  const lint = await checkLint(lintRoot, lintFiles);
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
 * Run the workspace's lint over the files THIS COMMIT touches.
 *
 * ── 2026-11-04：面由「全仓」收窄到「本次提交触及的文件」──────────────
 *
 * 原注释给全仓写的理由是「逐文件会漏掉**跨文件规则**」。该理由在本仓配置下
 * **不成立**，实测而非推断：`plugin/eslint.config.js` 没有 `plugins` 字段，
 * `js.configs.recommended` 的 64 条规则全部是单文件作用域（逐条枚举过），
 * 不存在任何需要同时看两个文件才能判定的规则。理由不成立，代价却是真的：
 *
 *  - 成本：全仓 216 个文件 3.1s，本次提交的 2 个文件 1.0s；
 *  - 更要紧的是**阻塞归属错位**：多人/多会话共享同一工作树时，他人未提交的
 *    lint 错误会把任何人的提交一起挡下。实测 2026-11-04：本会话要提交的两个
 *    文件逐字干净（`eslint <两个文件>` 退出码 0），却被并行会话在
 *    `source-recall.js`／`recall-injection.js` 里的 7 处 error 挡了 4 分钟。
 *    那不是「本候选不合规」，是「别人的半成品把路封了」。
 *
 * **收窄的是作用域，不是强度**：既存错误仍会被发现——CI 的 `npm run lint`
 * 是全仓（`.github/workflows/ci.yml`，`git commit --no-verify` 也绕不过它），
 * 06 §5「提交前必须通过静态分析」因此在提交时仍有承载。差别只在于：本地这道
 * 门现在只回答「你要提交的这批东西合不合规」，不再替全仓背书。
 *
 * ── 空清单与已删除路径（两处实测出来的坑）────────────────────────────
 *
 * 1. **零个文件时绝不可调用 eslint**：实测 `eslint` 不带参数会**扫描当前目
 *    录**——即退化成全仓。若本次提交不含任何 lint 面内文件（纯规范/事实提交），
 *    正确处理是跳过（返回 ok 且注明原因），而不是传空数组。
 * 2. **已删除的文件不可传入**：实测 `eslint lib/nope.js` 退出码 2 并报
 *    `No files matching the pattern`，会被误读成「lint 工具坏了」。故按
 *    `git diff --cached --name-status` 的 D 状态剔除，且传入前用 `access`
 *    确认存在。
 * 3. **被 ignore 的文件**（如 `plugin/web/**`）会产出 warning 行而非错误；
 *    加 `--no-warn-ignored` 以免 warning 混进报告的判读。
 *
 * 退出码是判据——0 通过，其余拒绝。两类失败在**措辞**上区分（真实 lint 发现
 * 说清哪个文件哪一行；配置坏或二进制缺失则要修工具），因为修法完全不同。
 */
/**
 * 内容寻址的「lint 已通过」缓存（2026-10-30 加；2026-11-04 改为按本提交的文件）。
 *
 * WHY：`installHook` 的 preflight 会真的跑一遍 eslint 来证明 Hook 能挡住提交
 * （这是它存在的意义，不能省）。但每次安装都重跑一遍：单次约 1–3s，而测试里
 * 有 41 处安装，实测占全套 150s 中的约 120s。
 *
 * SAFETY——这份缓存直接支撑「装上去的 Hook 确实挡住了坏提交」这一断言，所以：
 *  1. **只缓存通过**。失败一律重跑：失败要给出当次真实的行号与原因，缓存它既
 *     无用又会掩盖修复后的结果。
 *  2. **键覆盖本次受检文件的内容**（2026-11-04 改）：键原先覆盖整个 lint 面，
 *     面收窄后那样算会把无关文件也算进键——他人改一个不参与本次提交的文件
 *     就会让缓存失效，重新退化成每次重跑。现在键 = eslint 版本 + 依赖锁 +
 *     eslint 配置 + **本次传入的文件清单及其内容**。
 *  3. **缓存不可用即重跑**（读不到、写不进、JSON 坏了都当未命中），fail-closed
 *     的方向是「多跑一次 lint」，不是「跳过 lint」。
 */
const LINT_CACHE_SCHEMA = 2;
const LINT_SURFACE_EXTENSIONS = [".js", ".mjs", ".cjs"];

async function hashFile(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 本次提交触及的、落在 lint 面内的文件（相对 workspaceRoot）。
 *
 * 取 `git diff --cached --name-status` 而不是遍历目录：面是「这次要提交什么」，
 * 不是「工作树上有什么」。**删除的路径不参与**——文件已不存在，传给 eslint 会
 * 得到 `No files matching the pattern`（实测退出码 2），那会被误读成工具故障。
 *
 * ── 路径基准必须换算（2026-11-04 实测出来的缺陷）────────────────────
 *
 * git 返回的路径**相对仓库根**（worktree），而 eslint 以 `workspaceRoot` 为
 * cwd 解析参数。生产形态里两者不是同一个目录：`workspaceRoot` 是本仓
 * `plugin/`，worktree 是仓库根——直接把 `lib/x.js` 传给以 plugin 为 cwd 的
 * eslint 会找不到文件，实测表现为 `No files matching the pattern`（exit 2），
 * 于是每个有 JS 改动的提交都被判成「工具故障」。故先算 workspaceRoot 相对
 * worktree 的前缀，再据此换算；**不在 workspaceRoot 之下的路径直接丢弃**
 * （仓库里 plugin/ 之外的 JS 不属这个 lint 面）。
 *
 * 只保留配置真正会检查的：扩展名在 `LINT_SURFACE_EXTENSIONS` 内，且**确实存在于
 * 工作树**（`access` 兜底：重命名的新路径、被并发删掉的路径都不该让 eslint 报
 * 模式不匹配）。被 `ignores` 排除的目录不必在此过滤——eslint 自己会跳过。
 */
async function stagedLintFiles(workspaceRoot, worktree, indexFile) {
  let raw = "";
  try {
    raw = await git(worktree, ["diff", "--cached", "--name-status", "--no-ext-diff", "-z"], indexFile);
  } catch {
    // 读不到暂存状态：返回空并在调用方按「无可检查文件」处理。**不可**退化成
    // 全仓扫描——那正是本函数要收窄的东西，且会把「读不到」变成「扫全部」。
    return [];
  }
  const repoPaths = [];
  const fields = raw.split("\0").filter(Boolean);
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    if (!/^[A-Z]/.test(status)) continue;
    const letter = status[0];
    if (letter === "R" || letter === "C") {
      // rename/copy：status、旧路径、新路径——只有新路径还要检查。
      const newPath = fields[index + 2];
      if (typeof newPath === "string") repoPaths.push(newPath);
      index += 2;
      continue;
    }
    const path = fields[index + 1];
    if (typeof path === "string") {
      // D（删除）不 lint：文件已不在，传给 eslint 会报模式不匹配。
      if (letter !== "D") repoPaths.push(path);
      index += 1;
    } else {
      index += 1;
    }
  }
  // lint 工作区相对仓库根的前缀：生产形态下是 "plugin"；同根时是 ""。
  // **不可**把前缀再拼回 repoPath——repoPath 已是仓库相对，两者相加会多套一层
  // （实测拼成 "plugin/plugin/lib/x.js"，随后 access 失败、整批被滤空，门于是
  // 静默放行；这正是第一版实现的缺陷）。
  const prefix = relative(worktree, workspaceRoot).split(sep).join("/");
  const kept = [];
  for (const repoPath of repoPaths) {
    if (!LINT_SURFACE_EXTENSIONS.some((ext) => repoPath.endsWith(ext))) continue;
    if (prefix.startsWith("..") || isAbsolute(prefix)) continue; // lint 面不在仓库内：无对应路径
    if (prefix !== "") {
      if (repoPath === prefix) continue; // 前缀本身是个目录，不是文件
      if (!repoPath.startsWith(`${prefix}/`)) continue; // 不在工作区之下
    }
    // 剥掉共同前缀，得到工作区相对路径（同根时原样）。
    const rel = prefix === "" ? repoPath : repoPath.slice(prefix.length + 1);
    try {
      await access(join(workspaceRoot, rel), constants.R_OK);
    } catch {
      continue; // 工作树里不存在（并发删除等）：不传给 eslint
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
  // eslint 版本与依赖锁：依赖换了，规则的实际含义就可能变。
  for (const meta of [join("node_modules", "eslint", "package.json"), "package-lock.json", "eslint.config.js"]) {
    try {
      hash.update(`${meta}\0${await hashFile(join(workspaceRoot, meta))}\0`);
    } catch {
      hash.update(`${meta}\0missing\0`);
    }
  }
  // 只把**本次受检的文件**算进键：面收窄后若仍按全仓算，他人改一个不参与本次
  // 提交的文件就会让缓存失效，等于每次都重跑。
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

/**
 * Lint the files this commit touches.
 *
 * `files` is the narrowed surface from `stagedLintFiles`. Three cases:
 *   - **eslint 不在**：拒绝（fail-closed），不因「没装」而跳过检查；
 *   - **本次提交没有 lint 面内文件**：跳过并注明。**绝不**以空参数调用 eslint
 *     ——实测不带参数会扫描当前目录，等于悄悄退回全仓；
 *   - **有文件**：只检查这些文件。
 *
 * 退出码是判据——0 通过，其余拒绝。两类失败在**措辞**上区分（真实 lint 发现
 * 说清哪个文件哪一行；配置坏或二进制缺失则要修工具），因为修法完全不同。
 */
async function checkLint(workspaceRoot, files) {
  const eslint = await resolveEslint(workspaceRoot);
  if (eslint === null) {
    return { ok: false, issues: [newFinding("validation/lint_failed", `eslint is not installed in ${workspaceRoot}/node_modules — run npm ci there before committing (the gate refuses rather than skipping lint)`, null)] };
  }
  // 空清单：本次提交不触碰任何 lint 面内文件（纯规范/事实/文档提交）。
  // 这不是「检查通过」，是「本次没有可查的东西」——如实区分，不冒充通过。
  if (files.length === 0) return { ok: true, issues: [], skipped: "no-lint-files" };
  const cacheKey = await lintCacheKey(workspaceRoot, eslint, files);
  if (await readLintCache(workspaceRoot, cacheKey)) return { ok: true, issues: [], cached: true };
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    // `--no-warn-ignored`：被 ignores 排除的文件（如 plugin/web/**）本不参与检查，
    // 却会产出「File ignored because of a matching ignore pattern」warning 行，
    // 混进报告会模糊「有没有真的错误」的判读。
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
  // eslint's "tool failed" exit path leads with this banner; a plain lint
  // failure prints per-file findings instead. The distinction only changes the
  // wording of the refusal — both refuse.
  const toolFault = /Oops! Something went wrong|ESLint couldn't find|SyntaxError:|No files matching the pattern/.test(report);
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
