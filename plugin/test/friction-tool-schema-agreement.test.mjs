// Tool-surface schema must be DERIVED from the writer's allow-lists, not restated.
//
// ## The defect this guards (measured 2026-11-04)
//
// `friction-tools.js` carried a hand-written enum:
//
//     enum: ["serves", "attribution", "attribution_ref"]
//
// while the writer accepted two different sets:
//
//     FRICTION_REMOVABLE_FIELDS = { attribution, attribution_ref, impact }   // update
//     CORRECT_REMOVABLE_FIELDS  = { serves, occurrence, impact }             // correct
//
// The enum lacked `impact` (both paths accept it) and `occurrence` (correct
// accepts it). The schema is the ONLY surface the model reads before calling:
// an enum that is too small does not "block an over-reach" — the writer already
// fail-closes on unknown names. It teaches the model that a legal deletion
// does not exist, so the model does not perform the write it should perform.
// That is why this is a correctness defect, not a hardening gap.
//
// ## What is asserted
//
// The schema and the writer answer the same question, so the test asks BOTH and
// compares — it does not restate the expected names (that would just move the
// drift into the test file). Deleting a field from the writer's set and
// forgetting the schema fails here; so does narrowing the schema by hand.
//
// ## Boundary
//
// This proves the two lists agree TODAY. It does not prove the writer's set is
// semantically right for 26 §8 — that stays a spec-reading judgement.
import { test } from "node:test";
import assert from "node:assert/strict";

import { OPERATIONS, toolDescriptorFor } from "../lib/friction-tools.js";
import {
  CORRECT_REMOVABLE_FIELDS_FOR_TEST as CORRECT_REMOVABLE_FIELDS,
  FRICTION_REMOVABLE_FIELDS,
} from "../lib/friction-writer.js";

/** The enum the model actually receives. */
function removalsEnum() {
  const descriptor = toolDescriptorFor(
    "friction-write-object",
    OPERATIONS["friction-write-object"],
    async () => ({}),
  );
  return descriptor.parameters.properties.frontmatter_removals.items.enum;
}

test("the enum is computed from the writer's allow-lists, not restated", () => {
  const enumValues = new Set(removalsEnum());
  const fromWriter = new Set([...FRICTION_REMOVABLE_FIELDS, ...CORRECT_REMOVABLE_FIELDS]);

  for (const field of fromWriter) {
    assert.ok(
      enumValues.has(field),
      `"${field}" is accepted by the writer but absent from the tool schema — the model would never try it`,
    );
  }
  for (const field of enumValues) {
    assert.ok(
      fromWriter.has(field),
      `"${field}" is in the tool schema but no writer path accepts it — the model would be told to try a write that fails closed`,
    );
  }
  assert.deepEqual([...enumValues].sort(), [...fromWriter].sort(), "the two surfaces must answer identically");
});

test("the description names the real allow-lists instead of a frozen prose copy", () => {
  const description = toolDescriptorFor(
    "friction-write-object",
    OPERATIONS["friction-write-object"],
    async () => ({}),
  ).parameters.properties.frontmatter_removals.description;

  // The old prose said "only attribution/attribution_ref are accepted for update"
  // — true when written, false once `impact` joined the set. The description now
  // interpolates the sets, so it cannot describe a different world than the enum.
  for (const field of new Set([...FRICTION_REMOVABLE_FIELDS, ...CORRECT_REMOVABLE_FIELDS])) {
    assert.ok(description.includes(field), `description must mention ${field} (it is an accepted name)`);
  }
});
