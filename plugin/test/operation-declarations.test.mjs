import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OPERATION_DECLARATIONS_VERSION,
  loadOperationDeclarationsBundle,
  operationDeclarationSourceLabel,
} from "../lib/spec-registry.js";

function validBundle(overrides = {}) {
  return {
    version: OPERATION_DECLARATIONS_VERSION,
    fingerprint: "f".repeat(64),
    generated_from: "specs/",
    declarations: {
      "demo-op": {
        operation_key: "demo-op",
        summary: "does one thing, declares no availability",
        effect: "read",
        arguments_contract: "demo-carrier::1. Inputs",
        result_contract: "demo-carrier::2. Results",
        source: "demo-carrier",
        source_path: "specs/05-Demo.md",
      },
    },
    ...overrides,
  };
}

async function writeTemp(payload) {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-operation-declarations-"));
  const file = join(dir, "operation-declarations.bundle.json");
  await writeFile(file, typeof payload === "string" ? payload : `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

test("a well-formed declaration bundle loads into the same row shape the spec tier produces", async () => {
  const file = await writeTemp(validBundle());
  const loaded = await loadOperationDeclarationsBundle(file);
  assert.equal(loaded.ok, true, loaded.reason);
  assert.equal(loaded.tier, "package-data");
  assert.equal(loaded.fingerprint, "f".repeat(64));
  assert.deepEqual([...loaded.declarations.keys()], ["demo-op"]);
  assert.deepEqual(loaded.declarations.get("demo-op"), {
    operation_key: "demo-op",
    summary: "does one thing, declares no availability",
    effect: "read",
    arguments_contract: "demo-carrier::1. Inputs",
    result_contract: "demo-carrier::2. Results",
    source: "demo-carrier",
    source_path: "specs/05-Demo.md",
    anchor_errors: [],
  });
});

test("a missing declaration bundle is unavailable and never falls back to a default table", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-operation-declarations-"));
  const loaded = await loadOperationDeclarationsBundle(join(dir, "absent.json"));
  assert.equal(loaded.ok, false);
  assert.equal(loaded.tier, "package-data");
  assert.equal(loaded.declarations.size, 0, "缺文件时不得凭空造出一份声明表");
  assert.match(loaded.reason, /不可读/);
});

test("an unrecognised version is refused as undeclared, not reinterpreted", async () => {
  const file = await writeTemp(validBundle({ version: "operation-declarations/v0" }));
  const loaded = await loadOperationDeclarationsBundle(file);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.declarations.size, 0);
  assert.match(loaded.reason, /版本标记不识别/);
});

test("a bundle without a fingerprint is refused", async () => {
  const file = await writeTemp(validBundle({ fingerprint: "" }));
  const loaded = await loadOperationDeclarationsBundle(file);
  assert.equal(loaded.ok, false);
  assert.match(loaded.reason, /缺指纹/);
});

test("a bundle with no declarations at all is refused", async () => {
  const file = await writeTemp(validBundle({ declarations: {} }));
  const loaded = await loadOperationDeclarationsBundle(file);
  assert.equal(loaded.ok, false);
  assert.match(loaded.reason, /没有登记任何公开操作/);
});

test("a malformed declaration row makes the whole file unusable (fail-closed, no partial table)", async () => {
  const bundle = validBundle();
  bundle.declarations["demo-op"].effect = "write";
  const file = await writeTemp(bundle);
  const loaded = await loadOperationDeclarationsBundle(file);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.declarations.size, 0, "一行不合格时不得只丢那一行、把其余当成可用声明");
  assert.match(loaded.reason, /effect/);
});

test("a declaration row without a mechanically locatable contract is refused", async () => {
  const bundle = validBundle();
  bundle.declarations["demo-op"].arguments_contract = "6. Inputs";
  const file = await writeTemp(bundle);
  const loaded = await loadOperationDeclarationsBundle(file);
  assert.equal(loaded.ok, false);
  assert.match(loaded.reason, /arguments_contract/);
});

test("an invalid JSON bundle is unavailable with a diagnostic", async () => {
  const file = await writeTemp("{ not json");
  const loaded = await loadOperationDeclarationsBundle(file);
  assert.equal(loaded.ok, false);
  assert.match(loaded.reason, /不是合法 JSON/);
});

test("the tier label discloses that the declaration file is packaged build data", () => {
  assert.match(operationDeclarationSourceLabel("package-data"), /包内数据文件/);
  assert.match(operationDeclarationSourceLabel("package-data"), /运行期不读规范源/);
  assert.match(operationDeclarationSourceLabel("specs"), /规范源/);
  assert.match(operationDeclarationSourceLabel("nonsense"), /包内数据文件/, "未登记的 tier 按包内数据文件披露，不得静默给出空标签");
});
