// Fact-carrier filename scanning — ONE implementation for every type's list.
//
// ## Why this module exists
//
// Five list implementations (spark / adr / pitfall / research / friction) each
// carried this pair of lines:
//
//     const nameMatch = entry.name.match(/^<type>-<UUIDv4>\.md$/i);
//     if (!nameMatch) continue;  // non-carrier files (e.g. tmp staging)
//
// Two defects lived in that `continue`, and both were silent:
//
//   1. **A carrier the reader accepts is discarded without a word.** The Web
//      reader's pattern is deliberately looser than the writer's (it also
//      accepts a bare UUID and v4-era numeric/ULID names, localFactReader
//      `isExpectedCarrierName`). A file shaped `spark-<uuid-not-v4>.md` is
//      therefore *readable in the Web and invisible to the tools* — the split
//      this module closes. Measured 2026-11-04: the writer's v4-strict regex
//      rejects it, the reader's accepts it, and `listSparkObjects` returned
//      `items: 0, invalid: []` — zero objects AND zero report, so the caller
//      cannot tell "no objects" from "one object I refused to look at".
//
//   2. **Nothing ever compared the filename to the carrier's own
//      `object_uid:` declaration.** The list projections took
//      `uid = nameMatch[1]` and never read the declaration, so the FILENAME was
//      the identity authority while the declaration — the actual authority
//      (02 §7.1) — went unread. A carrier renamed or hand-copied would be
//      reported under the wrong identity with no signal.
//
// ## What this module decides, and what it does not
//
// It reports; it does not judge. A file is a defect the caller must see, not
// something to drop. Every non-conforming file lands in `invalid[]` with a
// reason the reader can act on, and every conforming carrier reports the
// `object_uid` its own frontmatter declares.
//
// The `invalid[]` shape here is the one the four existing lists already return
// (`{ file, reason }`) and the one the tool layer already turns into envelope
// gaps (`invalid carrier <file>: <reason>`). Reusing it keeps this a report-side
// fix: no new field, no new response shape.
//
// ## The exclusion that keeps tmp staging quiet
//
// Writers stage with `${filePath}.<8hex>.tmp` and rename into place (spark
// writer F8 note), so transient files genuinely exist in these directories.
// `EXCLUDED_NAME_MARKER` (below, the same convention `ldvh-tools.js` uses for
// spec carriers) marks them, and those are skipped WITHOUT a finding — a
// staging artifact that is gone in milliseconds is not a defect in the fact
// source. Anything else that fails to parse is reported.
//
// Boundary, stated plainly: this proves "every file in the directory was
// classified and every classification is reported". It does NOT prove the
// carriers' content is valid — the existing per-field checks still do that.

import { readdir } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { join } from "node:path";

/**
 * Draft / temp / backup markers — the same convention as `ldvh-tools.js`
 * (specs/01 §9.1 defense 1), matched on the whole name so both
 * `x.draft.md` (marker before the extension) and `x.md.draft` (after it) are
 * caught.
 */
export const EXCLUDED_NAME_MARKER =
  /\.(draft|tmp|temp|bak|backup|orig|swp|swo)$|~$|\.draft\.|\.tmp\.|\.temp\.|\.bak\.|\.orig\./;

/** True when a name carries a staging/backup marker and is not a real carrier. */
export function isExcludedCarrierName(name) {
  const withoutExtension = name.endsWith(".md") ? name.slice(0, -3) : name;
  return EXCLUDED_NAME_MARKER.test(name) || EXCLUDED_NAME_MARKER.test(withoutExtension);
}

/**
 * The identity segment every reader accepts (localFactReader
 * `isExpectedCarrierName`): canonical UUID — any version — plus the v4-era
 * numeric and ULID25 forms that are still readable in existing fact sources.
 *
 * Deliberately NOT v4-strict: narrowing it here would recreate exactly the
 * divergence this module exists to remove. Whether an identity is *canonical
 * v4* is a separate question answered by the writers' create path and by
 * `shared/factIdentity.ts`; a reader that refuses to classify a file because
 * its identity is non-canonical trades a visible defect for an invisible one.
 */
const READABLE_ID_SEGMENT =
  "(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})";

/** Name pattern a reader accepts for `type` (`.md` carrier). */
export function readableCarrierNamePattern(type) {
  return new RegExp(`^${type}-${READABLE_ID_SEGMENT}\\.md$`, "i");
}

/** Extract the identity segment from a name that already passed the pattern. */
function identitySegmentOf(type, name) {
  return name.slice(type.length + 1, name.length - ".md".length);
}

/** Read the top-level `object_uid:` declaration from a carrier's frontmatter text. */
export function declaredObjectUid(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  const line = fm[1].match(/^object_uid:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m);
  return line ? line[1] : null;
}

/**
 * Enumerate one type directory and classify every regular file.
 *
 * Returns `{ carriers, invalid }`:
 *   - `carriers[]` — `{ file, uid, content, nameUid }`, where `uid` is the
 *     DECLARED identity (authority) and `nameUid` is what the filename
 *     encodes (kept for the mismatch finding, never used as identity).
 *   - `invalid[]`  — `{ file, reason }`, one entry per file that could not be
 *     used AND was not a staging artifact.
 *
 * `read` may be injected so callers that already normalized paths (or tests
 * that must simulate unreadable files) can supply it; default is `readFile`.
 */
export async function scanCarrierDirectory(typeDir, type, { read } = {}) {
  const readFileImpl = read ?? (await import("node:fs/promises")).readFile;
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { carriers: [], invalid: [], missing: true };
    throw error;
  }

  const pattern = readableCarrierNamePattern(type);
  const carriers = [];
  const invalid = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Staging/backup artifacts are not fact objects and are not defects.
    if (isExcludedCarrierName(entry.name)) continue;
    // Only `.md` files are carrier candidates; anything else (a README, a
    // leftover .json) is not a fact-source defect either.
    if (!entry.name.endsWith(".md")) continue;

    const nameUid = pattern.test(entry.name) ? identitySegmentOf(type, entry.name) : null;
    let content;
    try {
      content = await readFileImpl(join(typeDir, entry.name), "utf8");
    } catch (error) {
      invalid.push({ file: entry.name, reason: `unreadable: ${error.message}` });
      continue;
    }

    if (nameUid === null) {
      // A `.md` file in the type directory that the reader would also refuse.
      // It stays a finding: someone put it here, and "I can't read it" must be
      // distinguishable from "it isn't there" (00 §4.6).
      invalid.push({
        file: entry.name,
        reason: `filename does not match the carrier pattern for ${type} (expected ${type}-<uuid>.md)`,
      });
      continue;
    }

    // Identity comes from the DECLARATION (02 §7.1), never from the filename.
    //
    // Diagnosis ordering matters here (2026-11-04, caught by an existing test):
    // a missing declaration is only THIS module's finding when the frontmatter
    // actually parsed into a key/value mapping — i.e. when "there is no
    // object_uid key" is a true statement about an otherwise readable carrier.
    // When the block is absent, unparseable, or parses to a non-mapping (a bare
    // string, a list), the callers already own that diagnosis with their own
    // wording ("no YAML frontmatter block", "frontmatter parse error: …",
    // "status … outside the closed set"). Reporting "no object_uid declared"
    // there would replace an accurate message with a misleading one — the same
    // file, a different (and wrong) reason.
    const uid = declaredObjectUid(content);
    if (uid === null) {
      const fmBlock = content.match(/^---\n([\s\S]*?)\n---\n/);
      let parsedMapping = null;
      if (fmBlock) {
        try {
          const value = parseYaml(fmBlock[1]);
          if (value !== null && typeof value === "object" && !Array.isArray(value)) parsedMapping = value;
        } catch {
          parsedMapping = null; // the caller reports the parse failure
        }
      }
      if (parsedMapping !== null) {
        invalid.push({
          file: entry.name,
          reason: "no object_uid declared in frontmatter (the carrier cannot be identified)",
        });
        continue;
      }
      // Not a readable mapping: hand it to the caller with the filename-derived
      // identity so its own field checks produce the accurate diagnosis. The
      // carrier still travels, because "cannot identify" here would be a claim
      // this module cannot support.
      carriers.push({ file: entry.name, uid: nameUid, nameUid, content, identityUnverified: true });
      continue;
    }

    if (uid.toLowerCase() !== nameUid.toLowerCase()) {
      // A mismatch means one of the two is wrong and the reader cannot tell
      // which: the object is listed under its declared identity, and the
      // divergence is named rather than resolved.
      //
      // Note the common cause (found by an existing friction test, 2026-11-04):
      // a carrier COPIED under a new filename keeps the source's declaration,
      // so the same uid then appears on two carriers. That is a duplicate
      // identity (02 §5 item 6), which the identity-index pass below detects
      // and reports with a sharper reason; this finding still fires because the
      // filename/declaration divergence is independently true and is what a
      // reader sees first when opening the file.
      invalid.push({
        file: entry.name,
        reason:
          `object_uid ${JSON.stringify(uid)} does not match the filename's identity segment ${JSON.stringify(nameUid)} `
          + "— one of the two is wrong; listed under the declared identity",
      });
    }

    carriers.push({ file: entry.name, uid, nameUid, content });
  }

  return { carriers, invalid, missing: false };
}
