import { test } from "node:test";
import assert from "node:assert/strict";

import { OPERATIONS, toolDescriptorFor } from "../lib/friction-tools.js";
import {
  CORRECT_REMOVABLE_FIELDS_FOR_TEST as CORRECT_REMOVABLE_FIELDS,
  FRICTION_REMOVABLE_FIELDS,
} from "../lib/friction-writer.js";

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

  for (const field of new Set([...FRICTION_REMOVABLE_FIELDS, ...CORRECT_REMOVABLE_FIELDS])) {
    assert.ok(description.includes(field), `description must mention ${field} (it is an accepted name)`);
  }
});
