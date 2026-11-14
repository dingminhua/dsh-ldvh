// Carrier scanning — one classification path for every type's list.
//
// ## What this file guards, and why it exists
//
// `lib/carrier-scan.js` was created on 2026-11-04 to close two silent defects
// that five list implementations shared:
//
//   1. `if (!nameMatch) continue;` dropped files WITHOUT a finding. The writer's
//      pattern was v4-strict while the Web reader's (`localFactReader
//      isExpectedCarrierName`) also accepts any-version UUIDs and the v4-era
//      numeric/ULID names — so `spark-<uuid-not-v4>.md` was readable in the Web
//      and invisible to every tool. Measured before the fix: `items: 0,
//      invalid: []` — zero objects AND zero report.
//   2. The list took `uid = nameMatch[1]`, so the FILENAME was the identity
//      authority and the carrier's own `object_uid:` declaration was never
//      read (02 §7.1 says the declaration is the authority).
//
// ## Evidence boundary (specs/06 §5「守卫测试的证据边界」)
//
// These are BEHAVIOUR assertions: they call the scanner and the five list
// functions and check what comes back. They do not prove the carriers' content
// is valid — the per-field checks still do that. What they prove is that every
// file in a type directory is CLASSIFIED and that no classification disappears.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  declaredObjectUid,
  isExcludedCarrierName,
  readableCarrierNamePattern,
  scanCarrierDirectory,
} from "../lib/carrier-scan.js";
import { listSparkObjects, SPARK_DIRECTORY } from "../lib/spark-writer.js";
import { listAdrObjects, ADR_DIRECTORY } from "../lib/adr-writer.js";
import { listPitfallObjects, PITFALL_DIRECTORY } from "../lib/pitfall-writer.js";
import { listResearchObjects, REPORT_DIRECTORY } from "../lib/report-writer.js";
import { listFrictionObjects, FRICTION_DIRECTORY } from "../lib/friction-writer.js";

/** A canonical v4 uid (the shape writers mint). */
const V4 = "11111111-1111-4111-8111-111111111111";
/** A syntactically valid UUID whose version nibble is NOT 4 — the divergence probe. */
const NON_V4 = "22222222-2222-2222-2222-222222222222";
/** Another canonical v4 uid, used as a mismatching declaration. */
const V4_B = "33333333-3333-4333-8333-333333333333";

async function withDir(fn) {
  const root = await mkdtemp(join(tmpdir(), "carrier-scan."));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const frontmatter = (uid, status) => `---\ntitle: t\nstatus: ${status}\nobject_uid: ${uid}\nfact_type_key: spark\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n`;

test("a name the reader accepts is never silently dropped (the tool/Web split)", async () => {
  await withDir(async (root) => {
    const dir = join(root, "sparks");
    await mkdir(dir, { recursive: true });
    // The reader accepts this name (any-version UUID); the old writer regex did not.
    await writeFile(join(dir, `spark-${NON_V4}.md`), frontmatter(NON_V4, "open"), "utf8");
    assert.equal(readableCarrierNamePattern("spark").test(`spark-${NON_V4}.md`), true,
      "the reader pattern must accept it — narrowing this is the split itself");

    const listed = await listSparkObjects({ factSourceRoot: root, includeTerminal: true });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.items.length, 1,
      "a readable carrier must appear in the list, not vanish because its uuid is not v4");
    assert.deepEqual(listed.value.invalid, [],
      "nothing to report about a perfectly readable carrier");
  });
});

test("filename/declaration mismatch is REPORTED, and the declaration is the identity", async () => {
  await withDir(async (root) => {
    const dir = join(root, "sparks");
    await mkdir(dir, { recursive: true });
    // File says V4; the carrier declares V4_B (02 §7.1: the declaration wins).
    await writeFile(join(dir, `spark-${V4}.md`), frontmatter(V4_B, "open"), "utf8");

    const listed = await listSparkObjects({ factSourceRoot: root, includeTerminal: true });
    assert.ok(listed.ok, JSON.stringify(listed.error));

    // Identity follows the declaration, not the filename.
    assert.deepEqual(listed.value.items.map((i) => i.object_uid), [V4_B],
      "the listed identity must be the carrier's own declaration");

    // And the divergence is not swallowed.
    assert.equal(listed.value.invalid.length, 1, "the mismatch must produce exactly one finding");
    assert.equal(listed.value.invalid[0].file, `spark-${V4}.md`);
    assert.match(listed.value.invalid[0].reason, /does not match the filename/);
    // Both identities are named, so the reader can tell which two disagree.
    assert.match(listed.value.invalid[0].reason, new RegExp(V4_B));
    assert.match(listed.value.invalid[0].reason, new RegExp(V4));
  });
});

test("a .md file that cannot be a carrier is reported, not skipped", async () => {
  await withDir(async (root) => {
    const dir = join(root, "sparks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "spark-not-a-uid.md"), frontmatter(V4, "open"), "utf8");
    const scanned = await scanCarrierDirectory(dir, "spark");
    assert.equal(scanned.carriers.length, 0);
    assert.equal(scanned.invalid.length, 1);
    assert.match(scanned.invalid[0].reason, /does not match the carrier pattern/);
  });
});

test("a carrier with no object_uid declaration is reported as unidentifiable", async () => {
  await withDir(async (root) => {
    const dir = join(root, "sparks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `spark-${V4}.md`), "---\ntitle: t\nstatus: open\n---\n\nbody\n", "utf8");
    const scanned = await scanCarrierDirectory(dir, "spark");
    assert.equal(scanned.carriers.length, 0);
    assert.equal(scanned.invalid.length, 1);
    assert.match(scanned.invalid[0].reason, /no object_uid declared/);
  });
});

test("staging artifacts stay quiet — a writer's .tmp half-file is not a fact-source defect", async () => {
  await withDir(async (root) => {
    const dir = join(root, "sparks");
    await mkdir(dir, { recursive: true });
    // Both shapes a writer leaves behind (marker before and after the extension).
    await writeFile(join(dir, `spark-${V4}.md.abc12345.tmp`), "partial", "utf8");
    await writeFile(join(dir, `spark-${V4}.draft.md`), "partial", "utf8");
    await writeFile(join(dir, `spark-${V4}.md~`), "partial", "utf8");
    const scanned = await scanCarrierDirectory(dir, "spark");
    assert.deepEqual(scanned.invalid, [],
      "a transient staging file must not be reported as a fact-source defect");
    assert.equal(scanned.carriers.length, 0);
    // The exclusion predicate itself, both placements.
    assert.equal(isExcludedCarrierName(`spark-${V4}.md.abc12345.tmp`), true);
    assert.equal(isExcludedCarrierName(`spark-${V4}.draft.md`), true);
    assert.equal(isExcludedCarrierName(`spark-${V4}.md`), false);
  });
});

test("non-.md files in a type directory are neither carriers nor defects", async () => {
  await withDir(async (root) => {
    const dir = join(root, "sparks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "README.md"), "# notes\n", "utf8");
    // README.md IS a .md file, so it is reported — the point is that a stray
    // .md is visible rather than invisible. Non-md files are not.
    await writeFile(join(dir, "leftover.json"), "{}", "utf8");
    const scanned = await scanCarrierDirectory(dir, "spark");
    assert.equal(scanned.carriers.length, 0);
    assert.equal(scanned.invalid.length, 1, "only the .md file becomes a finding");
    assert.equal(scanned.invalid[0].file, "README.md");
  });
});

test("a missing type directory is a legitimate empty set, not an error", async () => {
  await withDir(async (root) => {
    const scanned = await scanCarrierDirectory(join(root, "does-not-exist"), "spark");
    assert.equal(scanned.missing, true);
    assert.deepEqual(scanned.carriers, []);
    assert.deepEqual(scanned.invalid, []);
  });
});

test("declaredObjectUid reads only the top-level declaration line", () => {
  assert.equal(declaredObjectUid(`---\nobject_uid: ${V4}\n---\n`), V4);
  assert.equal(declaredObjectUid(`---\nobject_uid: "${V4}"\n---\n`), V4);
  // Indented (nested) declarations are not the object's identity.
  assert.equal(declaredObjectUid(`---\nrelations:\n  - object_uid: ${V4}\n---\n`), null);
  assert.equal(declaredObjectUid("# no frontmatter\n"), null);
});

// ---------------------------------------------------------------------------
// The five lists share the classification — asserted per type so that a writer
// that quietly re-grows its own `if (!nameMatch) continue` fails here.
// ---------------------------------------------------------------------------

const LISTS = [
  ["spark", SPARK_DIRECTORY, listSparkObjects, { includeTerminal: true }],
  ["adr", ADR_DIRECTORY, listAdrObjects, { includeTerminal: true }],
  ["pitfall", PITFALL_DIRECTORY, listPitfallObjects, { includeTerminal: true }],
  ["report", REPORT_DIRECTORY, listResearchObjects, { includeTerminal: true }],
  ["friction", FRICTION_DIRECTORY, listFrictionObjects, { includeResolved: true }],
];

/** Minimal body per type so the carrier parses (structure checks run later). */
const BODIES = {
  spark: "## 当前理解\nx\n\n## 调查问题\ny\n\n## 调查边界\nz\n",
  adr: "## 决策背景\nx\n",
  pitfall: "## 症状\nx\n",
  report: "## 研究问题\nx\n",
  friction: "## 现象\nx\n",
};
const STATUS = { spark: "open", adr: "active", pitfall: "active", report: "active", friction: "open" };

for (const [type, directory, listFn, options] of LISTS) {
  test(`${type} list: a mismatched filename is reported, never dropped`, async () => {
    await withDir(async (root) => {
      const dir = join(root, directory);
      await mkdir(dir, { recursive: true });
      const fm = `---\ntitle: t\nstatus: ${STATUS[type]}\nobject_uid: ${V4_B}\nfact_type_key: ${type}\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n`;
      await writeFile(join(dir, `${type}-${V4}.md`), fm + BODIES[type], "utf8");

      const listed = await listFn({ factSourceRoot: root, ...options });
      assert.ok(listed.ok, JSON.stringify(listed.error));
      assert.deepEqual(listed.value.items.map((i) => i.object_uid), [V4_B],
        `${type}: identity must come from the declaration`);
      assert.equal(listed.value.invalid.length, 1,
        `${type}: the mismatch must be reported (a silent drop is the defect being fixed)`);
      assert.match(listed.value.invalid[0].reason, /does not match the filename/);
    });
  });

  test(`${type} list: a non-v4-named carrier is still listed (no reader/writer split)`, async () => {
    await withDir(async (root) => {
      const dir = join(root, directory);
      await mkdir(dir, { recursive: true });
      const fm = `---\ntitle: t\nstatus: ${STATUS[type]}\nobject_uid: ${NON_V4}\nfact_type_key: ${type}\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n`;
      await writeFile(join(dir, `${type}-${NON_V4}.md`), fm + BODIES[type], "utf8");

      const listed = await listFn({ factSourceRoot: root, ...options });
      assert.ok(listed.ok, JSON.stringify(listed.error));
      assert.equal(listed.value.items.length, 1,
        `${type}: the reader accepts this name, so the list must see it too`);
    });
  });
}
