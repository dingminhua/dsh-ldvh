// WorkCase tool-surface contract: the Gate 1 request elements that have NO
// object-field carrier must be supplied explicitly, and their omission must be
// rejected rather than passing silently (21 §10.1 提请必含).
//
// Background (2026-09-16): 21 §10.1 requires the Gate 1 request to carry
// 独立复核的安排 among other elements, but `gate_1` holds only
// {approved_at, approver, authorization_fingerprint, scope_snapshot} and the
// approve path validated only approver/controller/change_summary. An executor
// (this session's WC-D 99957f65) therefore omitted 独立复核的安排 with no
// mechanical resistance at all. This test pins the guard that closes that gap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { withTemp, sessionPersistenceWithRoutingLog } from "./helpers.mjs";
import { registerWorkcaseTools } from "../lib/workcase-tools.js";

/** Minimal ctx capturing registered tool descriptors. */
function collectorCtx() {
  const tools = new Map();
  return {
    ctx: { tools: { register: (descriptor) => { tools.set(descriptor.name, descriptor); return () => tools.delete(descriptor.name); } } },
    tools,
  };
}

/** Well-formed governed-projects carrier pointing at `projectPath`. */
async function writeCarrier(home, projectPath) {
  const dir = join(home, "ldvh");
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const file = join(dir, "governed-projects.yaml");
  await writeFile(file, [
    "schema_version: 1",
    "governance_instance_name: Test",
    "product_description: Test",
    "projects:",
    "  - id: p1",
    "    name: P1",
    `    path: ${projectPath}`,
    'default_project_id: "p1"',
    "",
  ].join("\n"));
  await chmod(file, 0o600);
  return file;
}

test("approve: missing gate1_request is rejected (21 §10.1 提请必含, no field carrier)", async () => {
  await withTemp("workcase-gate1-", async (base) => {
    const projectDir = join(base, "proj");
    await mkdir(projectDir, { recursive: true });
    await writeCarrier(base, projectDir);
    const { ctx, tools } = collectorCtx();
    registerWorkcaseTools(ctx, { dshHomePath: (...segments) => join(base, ...segments), sessionPersistence: sessionPersistenceWithRoutingLog(base) });
    const write = tools.get("ldvh_workcase_write");
    assert.ok(write, "write tool must be registered");

    const exec = { agent: { session: { header: { cwd: projectDir } } } };
    const result = await write.execute({
      action: "approve",
      object_uid: "00000000-0000-4000-8000-000000000000",
      expected_fingerprint: "0".repeat(64),
      approver: "Human",
      controller: "ctrl",
      change_summary: "Gate 1",
    }, exec);

    // Either the governance/governance-shaped rejection or the gate1_request
    // rejection is acceptable ONLY if the message names the missing element.
    const text = JSON.stringify(result);
    assert.match(text, /gate1_request/, `expected the guard to name gate1_request, got: ${text.slice(0, 400)}`);
  });
});

test("approve: gate1_request present but with an empty element is rejected", async () => {
  await withTemp("workcase-gate1b-", async (base) => {
    const projectDir = join(base, "proj");
    await mkdir(projectDir, { recursive: true });
    await writeCarrier(base, projectDir);
    const { ctx, tools } = collectorCtx();
    registerWorkcaseTools(ctx, { dshHomePath: (...segments) => join(base, ...segments), sessionPersistence: sessionPersistenceWithRoutingLog(base) });
    const write = tools.get("ldvh_workcase_write");
    const exec = { agent: { session: { header: { cwd: projectDir } } } };

    const result = await write.execute({
      action: "approve",
      object_uid: "00000000-0000-4000-8000-000000000000",
      expected_fingerprint: "0".repeat(64),
      approver: "Human",
      controller: "ctrl",
      change_summary: "Gate 1",
      gate1_request: {
        independent_review: "one isolated subagent",
        unauthorized_action_guard: "writer refuses out-of-scope writes",
        unverified_scope_and_risks: "host signature behavior unverified",
        approved_scope_and_next: "  ",
      },
    }, exec);

    const text = JSON.stringify(result);
    assert.match(text, /approved_scope_and_next/, `expected the guard to name the empty element, got: ${text.slice(0, 400)}`);
  });
});
