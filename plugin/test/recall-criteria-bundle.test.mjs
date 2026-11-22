import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  FACTSOURCE_TYPE_KEYS,
  RECALL_CRITERIA_VERSION,
  loadRecallCriteria,
  loadRecallCriteriaBundle,
  parseRecallCriteriaTable,
} from "../lib/recall-criteria.js";
import { recallStatusPolicyOf } from "../lib/source-recall.js";
import { buildRecallCriteriaBundle } from "../scripts/specs-bundle.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const SPECS_DIR = join(ROOT, "specs");

async function withBundleDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-criteria-bundle-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeBundle(dir, data) {
  const file = join(dir, "recall-criteria.bundle.json");
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return file;
}

test("包内判据表数据文件：读取结果与规范源解析值逐字段一致，tier 为 package-data", async () => {
  await withBundleDir(async (dir) => {
    const data = await buildRecallCriteriaBundle(SPECS_DIR);
    const file = await writeBundle(dir, data);
    const loaded = await loadRecallCriteriaBundle(file);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.equal(loaded.version, RECALL_CRITERIA_VERSION);
    assert.equal(loaded.tier, "package-data");
    assert.equal(loaded.unreadable, false);
    assert.equal(loaded.fingerprint, data.fingerprint);
    assert.deepEqual([...loaded.byType.keys()].sort(), [...FACTSOURCE_TYPE_KEYS].sort());

    const fromSpecs = await loadRecallCriteria(SPECS_DIR);
    assert.equal(loaded.fingerprint, fromSpecs.fingerprint, "指纹须与规范源同法计算");
    for (const [type, table] of fromSpecs.byType) {
      assert.deepEqual(loaded.byType.get(type).values, table.values, `逐字段不一致：${type}`);
      assert.deepEqual(Object.keys(loaded.byType.get(type).values).sort(), [
        "coreFields",
        "defaultStatuses",
        "notApplicable",
        "relations",
        "typeAliases",
      ]);
    }
    const goal = loaded.byType.get("goal");
    assert.equal(goal.values.notApplicable["默认候选状态"], true);
    assert.equal(recallStatusPolicyOf(loaded, "goal").kind, "non-candidate");
    assert.deepEqual(recallStatusPolicyOf(loaded, "pitfall").statuses, ["active"]);
  });
});

test("数据文件缺失：如实标记 unreadable，不冒充任何表值", async () => {
  await withBundleDir(async (dir) => {
    const loaded = await loadRecallCriteriaBundle(join(dir, "absent.json"));
    assert.equal(loaded.ok, false);
    assert.equal(loaded.unreadable, true);
    assert.equal(loaded.tier, "package-data");
    assert.equal(loaded.byType.size, 0);
    assert.deepEqual(loaded.tables, []);
    assert.equal(loaded.fingerprint, "");
    assert.ok(loaded.errors.some((item) => item.code === "recall-criteria/bundle_unreadable"));
  });
});

test("版本标记不符：全部类型停用，不得回落到任何兜底状态表", async () => {
  await withBundleDir(async (dir) => {
    const data = await buildRecallCriteriaBundle(SPECS_DIR);
    const file = await writeBundle(dir, { ...data, version: "recall-criteria/v0" });
    const loaded = await loadRecallCriteriaBundle(file);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.unreadable, false);
    assert.equal(loaded.byType.size, 0);
    assert.ok(loaded.errors.some((item) => item.code === "recall-criteria/unknown_version"));
    for (const type of FACTSOURCE_TYPE_KEYS) {
      assert.ok(loaded.errors.some((item) => item.type === type), `类型 ${type} 须被点名停用`);
      assert.notEqual(recallStatusPolicyOf(loaded, type).kind, "fallback", `${type} 不得回落具名兜底`);
      assert.notEqual(recallStatusPolicyOf(loaded, type).kind, "table", `${type} 不得有表值`);
    }
  });
});

test("非法 JSON 或错误顶层形状：全部类型停用并给出结构化错误", async () => {
  await withBundleDir(async (dir) => {
    const broken = join(dir, "broken.json");
    await writeFile(broken, "{not json", "utf8");
    const loaded = await loadRecallCriteriaBundle(broken);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.byType.size, 0);
    assert.ok(loaded.errors.some((item) => item.code === "recall-criteria/bad_bundle_json"));
    assert.equal(recallStatusPolicyOf(loaded, "pitfall").kind, "disabled");

    const arrayShaped = await writeBundle(dir, []);
    const loadedArray = await loadRecallCriteriaBundle(arrayShaped);
    assert.equal(loadedArray.ok, false);
    assert.equal(loadedArray.byType.size, 0);
    assert.ok(loadedArray.errors.some((item) => item.code === "recall-criteria/bad_bundle_shape"));
  });
});

test("单类型机械值非法：只停用该类型，其余类型仍按表值生效", async () => {
  await withBundleDir(async (dir) => {
    const data = await buildRecallCriteriaBundle(SPECS_DIR);
    const tampered = structuredClone(data);
    tampered.types.spark.defaultStatuses = ["Open State"];
    tampered.types.pitfall.defaultStatuses = ["active", "active"];
    const file = await writeBundle(dir, tampered);
    const loaded = await loadRecallCriteriaBundle(file);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.byType.has("spark"), false);
    assert.equal(loaded.byType.has("pitfall"), false);
    assert.equal(loaded.byType.has("friction"), true);
    const disabled = recallStatusPolicyOf(loaded, "spark");
    assert.equal(disabled.kind, "disabled");
    assert.ok(loaded.errors.some((item) => item.type === "spark" && item.code === "recall-criteria/bad_bundle_values"));
    assert.ok(loaded.errors.some((item) => item.type === "pitfall" && item.code === "recall-criteria/bad_bundle_values"));
  });
});

test("「不采用」与机械值同时出现：该类型停用，不得把两种语义混读", async () => {
  await withBundleDir(async (dir) => {
    const data = await buildRecallCriteriaBundle(SPECS_DIR);
    const tampered = structuredClone(data);
    tampered.types.goal.notApplicable["关系展开"] = true;
    tampered.types.goal.relations = [{ relationKey: "informs", targets: ["spark"] }];
    const file = await writeBundle(dir, tampered);
    const loaded = await loadRecallCriteriaBundle(file);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.byType.has("goal"), false);
    assert.ok(loaded.errors.some((item) => item.type === "goal" && item.code === "recall-criteria/bad_bundle_values"));
  });
});

test("生成物覆盖 20–26 七个类型规范，且 specId 归属正确", async () => {
  const data = await buildRecallCriteriaBundle(SPECS_DIR);
  assert.equal(data.version, RECALL_CRITERIA_VERSION);
  const bySpecId = new Map(Object.entries(data.types).map(([type, entry]) => [entry.specId, type]));
  assert.deepEqual([...bySpecId.keys()].sort(), ["20", "21", "22", "23", "24", "25", "26"]);
  assert.equal(bySpecId.get("20"), "goal");
  assert.equal(bySpecId.get("26"), "friction");
  for (const [type, entry] of Object.entries(data.types)) {
    assert.equal(typeof entry.notApplicable["默认候选状态"], "boolean", type);
    assert.ok(Array.isArray(entry.defaultStatuses), type);
    assert.ok(Array.isArray(entry.coreFields), type);
    assert.ok(Array.isArray(entry.typeAliases), type);
    assert.ok(Array.isArray(entry.relations), type);
  }
});
