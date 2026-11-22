import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RUNTIME_CARRIER_DIR,
  loadRuntimeCarrierIndex,
  matchRuntimeCarriers,
  parseRuntimeCarrier,
  readRuntimeCarrier,
  resolveRuntimeCarrierRoot,
  routeRuntimeCarriers,
  tokenizeScene,
} from "../lib/runtime-carrier-reader.js";
import {
  RUNTIME_CARRIER_INJECTION_BYTES,
  RUNTIME_CARRIER_INJECTION_MAX,
  renderRecallRow,
} from "../lib/recall-injection.js";
import { recallForAction } from "../lib/source-recall.js";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");

const KNOWN_KEY = "rule-compliance-recall";
const KNOWN_PATH = "plugin-specs/rule-compliance-recall.yaml";
const KNOWN_BODY_MARKER = "候选须带可直达的稳定引用";

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "runtime-carrier-reader."));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function yamlCarrier({ specKey, title, positioning, scope, role = null, requirements }) {
  const lines = [
    "ldvh_spec:",
    `  spec_key: ${specKey}`,
    "  spec_kind: spec",
    `  title: ${title}`,
    `  canonical_path: ${RUNTIME_CARRIER_DIR}/${specKey}.yaml`,
    `  positioning: ${positioning}`,
    `  scope: ${scope}`,
  ];
  if (role !== null) lines.push(`  role: ${role}`);
  lines.push("  requirements:");
  for (const entry of requirements) {
    lines.push(`    - id: ${entry.id}`);
    lines.push(`      title: ${entry.title}`);
    lines.push("      text: |");
    for (const line of entry.text.split("\n")) lines.push(`        ${line}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function writeCarrier(root, spec) {
  const dir = join(root, RUNTIME_CARRIER_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${spec.specKey}.yaml`), yamlCarrier(spec), "utf8");
  return dir;
}

const SPARK = {
  specKey: "spark-fact-type",
  title: "火花",
  positioning: "管火花记录这一事实对象的形态与写入条件",
  scope: "要新建或修改火花记录时查阅本文件",
  requirements: [
    {
      id: "carrier-shell",
      title: "载体外壳",
      text: "火花记录须有唯一标识、创建时间和正文；正文从二级标题起。",
    },
    {
      id: "merge",
      title: "合并",
      text: "两条火花谈同一件事时可以合并，合并须保留两条的来源。",
    },
  ],
};

const PITFALL = {
  specKey: "pitfall-fact-type",
  title: "踩坑经验",
  positioning: "管踩坑经验这一事实对象的形态与写入条件",
  scope: "要留下一条踩坑经验时查阅本文件",
  requirements: [
    {
      id: "what-is",
      title: "这是什么",
      text: "踩坑经验记的是一个失败机制，以及避免它所需的规避方式。",
    },
  ],
};

test("索引给出全部载体的定位字段，且不含任何条目正文", async () => {
  const dir = join(PROJECT_ROOT, RUNTIME_CARRIER_DIR);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".yaml"));
  const index = await loadRuntimeCarrierIndex({ root: PROJECT_ROOT });

  assert.equal(index.ok, true);
  assert.equal(index.available, true);
  assert.equal(index.missing, false);
  assert.deepEqual(index.invalid, [], "现行语料不应有解析失败");
  assert.equal(index.count, files.length, "索引必须列出目录中的每一份载体，少一份即红");

  for (const carrier of index.carriers) {
    assert.equal(Object.hasOwn(carrier, "requirements"), false, "索引不得携带条目数组");
    assert.equal(carrier.requirementCount, carrier.requirementIds.length);
    assert.match(carrier.canonicalPath, /^plugin-specs\/[a-z0-9-]+\.yaml$/);
    assert.ok(carrier.positioning.length > 0);
    assert.ok(carrier.scope.length > 0);
  }

  const known = index.carriers.find((carrier) => carrier.specKey === KNOWN_KEY);
  assert.ok(known !== undefined, "已知载体须出现在索引中");
  assert.equal(known.canonicalPath, KNOWN_PATH);
  assert.equal(
    JSON.stringify(index).includes(KNOWN_BODY_MARKER),
    false,
    "索引一旦带上条目正文即红：注入面只允许定位信息",
  );
});

test("按 canonical_path 与按 spec_key 都能读到同一份全文，含条目", async () => {
  const byPath = await readRuntimeCarrier({ root: PROJECT_ROOT, canonicalPath: KNOWN_PATH });
  const byKey = await readRuntimeCarrier({ root: PROJECT_ROOT, specKey: KNOWN_KEY });

  assert.equal(byPath.ok, true, JSON.stringify(byPath.error));
  assert.equal(byKey.ok, true, JSON.stringify(byKey.error));
  assert.equal(byPath.carrier.canonicalPath, byKey.carrier.canonicalPath);
  assert.equal(byPath.carrier.specKey, KNOWN_KEY);
  assert.ok(byPath.carrier.requirements.length > 0, "全文必须带条目；只有定位字段即红");
  for (const entry of byPath.carrier.requirements) {
    assert.equal(typeof entry.id, "string");
    assert.ok(entry.id.length > 0);
    assert.ok(entry.title.length > 0);
    assert.ok(entry.text.length > 0);
  }
  assert.equal(
    byPath.carrier.requirements.some((entry) => entry.text.includes(KNOWN_BODY_MARKER)),
    true,
    "全文须真的包含条目正文，否则读全文与读索引无法区分",
  );
});

test("读入口拒绝缺参、双参，并如实报告不存在与解析失败", async () => {
  await withTempRoot(async (root) => {
    const dir = await writeCarrier(root, SPARK);
    await writeFile(join(dir, "broken.yaml"), "ldvh_spec: [unclosed\n", "utf8");

    const missingArg = await readRuntimeCarrier({ root });
    assert.equal(missingArg.ok, false);
    assert.equal(missingArg.error.code, "carrier/request_invalid");

    const both = await readRuntimeCarrier({ root, specKey: SPARK.specKey, canonicalPath: `${RUNTIME_CARRIER_DIR}/${SPARK.specKey}.yaml` });
    assert.equal(both.ok, false);
    assert.equal(both.error.code, "carrier/request_invalid");

    const absent = await readRuntimeCarrier({ root, specKey: "no-such-carrier" });
    assert.equal(absent.ok, false);
    assert.equal(absent.error.code, "carrier/not_found");

    const index = await loadRuntimeCarrierIndex({ root });
    assert.equal(index.count, 1);
    assert.equal(index.invalid.length, 1, "解析失败的载体须被报告，不得静默跳过");
    assert.equal(index.invalid[0].file, "broken.yaml");
    assert.equal(index.invalid[0].code, "carrier/parse_failed");

    const broken = await readRuntimeCarrier({ root, canonicalPath: "plugin-specs/broken.yaml" });
    assert.equal(broken.ok, false, "坏载体不得被当作不存在而静默略过");
    assert.equal(broken.error.code, "carrier/parse_failed");
    assert.match(broken.error.message, /./);
  });
});

test("载体源缺失时索引与读取都如实报告，而不是返回空集合冒充成功", async () => {
  await withTempRoot(async (root) => {
    const index = await loadRuntimeCarrierIndex({ root });
    assert.equal(index.available, false);
    assert.equal(index.missing, true);
    assert.equal(index.count, 0);
    assert.match(index.note, /未找到/);

    const read = await readRuntimeCarrier({ root, specKey: "spark-fact-type" });
    assert.equal(read.ok, false);
    assert.equal(read.error.code, "carrier/source_missing");
  });
});

test("场景定位：无 role: router 时走启发式并明确声明它不是权威路由", async () => {
  const routed = await routeRuntimeCarriers({ root: PROJECT_ROOT, scene: "要写一条踩坑经验，怎么记录" });

  assert.equal(routed.method, "heuristic", "语料中无场景路由表时必须如实标为启发式");
  assert.equal(routed.heuristic, true);
  assert.equal(routed.router, null);
  assert.match(routed.note, /启发式/);
  assert.ok(routed.candidates.length > 0, "启发式须给出候选");
  assert.ok(
    routed.candidates.some((carrier) => carrier.specKey === "pitfall-fact-type"),
    "「踩坑经验」场景须能定位到 Pitfall 载体",
  );
  for (const carrier of routed.candidates) {
    assert.match(carrier.canonicalPath, /^plugin-specs\/[a-z0-9-]+\.yaml$/);
    assert.ok(carrier.reason.length > 0);
    assert.equal(carrier.heuristic, true);
  }
});

test("场景定位：存在 role: router 时按路由表的条目路径定位，而不退回启发式", async () => {
  await withTempRoot(async (root) => {
    await writeCarrier(root, SPARK);
    await writeCarrier(root, PITFALL);
    await writeCarrier(root, {
      specKey: "scene-router",
      title: "场景路由",
      positioning: "把场景指向该读的那一份载体",
      scope: "要判断某个场景该读哪份载体时查阅本文件",
      role: "router",
      requirements: [
        {
          id: "spark-scene",
          title: "火花场景",
          text: "要写一条火花记录时，读 plugin-specs/spark-fact-type.yaml",
        },
        {
          id: "pitfall-scene",
          title: "踩坑场景",
          text: "要写一条踩坑经验时，读 plugin-specs/pitfall-fact-type.yaml",
        },
      ],
    });

    const routed = await routeRuntimeCarriers({ root, scene: "要写一条踩坑经验" });
    assert.equal(routed.method, "router", "识别到 role: router 后不得再标启发式");
    assert.equal(routed.heuristic, false);
    assert.equal(routed.router, "scene-router");
    assert.equal(routed.candidates.length, 1, "路由条目须指向唯一目标");
    assert.equal(routed.candidates[0].specKey, "pitfall-fact-type");
    assert.equal(routed.candidates[0].canonicalPath, "plugin-specs/pitfall-fact-type.yaml");
    assert.match(routed.candidates[0].reason, /pitfall-scene/);
  });
});

test("解析器拒绝缺身份字段、错路径与坏条目的载体，不把部分字段当成功", () => {
  const missing = parseRuntimeCarrier(
    "ldvh_spec:\n  spec_key: spark-fact-type\n  spec_kind: spec\n",
    { file: "x.yaml" },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "carrier/identity_missing");

  const wrongPath = parseRuntimeCarrier(yamlCarrier(SPARK).replace(
    "canonical_path: plugin-specs/spark-fact-type.yaml",
    "canonical_path: plugin-specs/other.yaml",
  ), { file: "spark-fact-type.yaml" });
  assert.equal(wrongPath.ok, false);
  assert.equal(wrongPath.error.code, "carrier/path_mismatch");

  const badEntries = parseRuntimeCarrier(
    yamlCarrier({ ...SPARK, requirements: [{ id: "x", title: "t", text: "body" }, { id: "x", title: "u", text: "body" }] }),
    { file: "spark-fact-type.yaml" },
  );
  assert.equal(badEntries.ok, false);
  assert.equal(badEntries.error.code, "carrier/requirements_invalid");
  assert.match(badEntries.error.message, /more than once/);
});

test("载体侧召回只给可定位引用：canonical_path 与条目 id，且带「载体条目」标注", async () => {
  const matched = await matchRuntimeCarriers({ root: PROJECT_ROOT, query: "写一条火花记录" });

  assert.equal(matched.ok, true);
  assert.equal(matched.available, true);
  assert.ok(matched.carriers.length > 0, "该查询须召回到载体侧候选");
  assert.ok(matched.carriers.length <= matched.counts.hits);
  for (const carrier of matched.carriers) {
    assert.equal(carrier.kind, "runtime-carrier");
    assert.equal(carrier.label, "载体条目");
    assert.match(carrier.canonicalPath, /^plugin-specs\/[a-z0-9-]+\.yaml$/);
    assert.ok(Array.isArray(carrier.entryIds) && carrier.entryIds.length > 0,
      "候选没有条目 id 就不是可定位引用，只有载体名即红");
    assert.equal(carrier.entryIds.length, carrier.entries.length);
    for (const id of carrier.entryIds) assert.equal(typeof id, "string");
    assert.ok(carrier.hitReason.length > 0);
    assert.equal(carrier.provesApplicability, false);
    assert.equal(Object.hasOwn(carrier, "text"), false, "候选不得携带条目正文");
  }
  assert.ok(
    matched.carriers.some((carrier) => carrier.specKey === "spark-fact-type"),
    "「火花记录」须命中 Spark 载体",
  );
});

test("召回结果并入载体侧通道：事实源不可读但有载体候选时仍报 partial，不报 unavailable", async () => {
  await withTempRoot(async (root) => {
    await writeCarrier(root, SPARK);
    const result = await recallForAction({
      action: "写一条火花记录",
      root,
      includeSpecs: false,
      limit: 3,
      budgetBytes: 8000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.runtimeCarriers.read, true);
    assert.equal(result.runtimeCarriers.available, true);
    assert.ok(result.runtimeCarriers.candidates.length > 0);
    const candidate = result.runtimeCarriers.candidates[0];
    assert.equal(candidate.canonicalPath, `${RUNTIME_CARRIER_DIR}/${SPARK.specKey}.yaml`);
    assert.ok(candidate.entryIds.length > 0);
    assert.equal(result.recallCompleteness, "partial",
      "规范源与事实源不可读但有载体候选时，报 unavailable 即抹掉了已取得的候选");
    assert.ok(
      result.uncheckedRange.sourceNotRead.some((line) => line.includes("specs/")),
      "specs/ 不作为运行期召回源的事实仍须披露",
    );
    assert.ok(
      result.gaps.some((line) => line.includes("事实源不可读")),
      "事实源不可读的事实不因载体侧有命中而消失",
    );
  });
});

test("注入文本含载体定位且不含条目正文；体积受预算与条数上限约束", () => {
  const secretBody = "SECRET-ENTRY-BODY-MUST-NOT-BE-INJECTED";
  const positioning = "管火花记录这一事实对象的形态与写入条件";
  const scope = "要新建或修改火花记录时查阅本文件";
  const result = {
    ok: true,
    specs: [],
    facts: [],
    runtimeCarriers: {
      available: true,
      candidates: [
        {
          specKey: "spark-fact-type",
          title: "火花",
          canonicalPath: "plugin-specs/spark-fact-type.yaml",
          positioning,
          scope,
          entries: [{ id: "carrier-shell", title: "载体外壳", text: secretBody }],
          entryIds: ["carrier-shell"],
        },
      ],
      counts: { scanned: 1, hits: 1, returned: 1 },
      truncated: false,
    },
    unchecked: { specs: [], facts: [], runtimeCarriers: [] },
    budget: { limitBytes: 12000, usedBytes: 0, limit: 3 },
    partial: false,
    truncated: false,
    provesApplicability: false,
  };

  const text = renderRecallRow(result);
  assert.match(text, /^运行时机制：$/m, "载体侧须以「运行时机制：」开头成段");
  assert.match(text, /spec_key=spark-fact-type/);
  assert.match(text, /plugin-specs\/spark-fact-type\.yaml/);
  assert.ok(text.includes(positioning), "注入须带 positioning");
  assert.ok(text.includes(scope), "注入须带 scope");
  assert.match(text, /- 载体条目：火花/);
  assert.equal(text.includes(secretBody), false, "注入一旦带条目正文即红：正文只能按需读取");
  const carrierRows = text.split("\n").filter((line) => line.startsWith("- 载体条目："));
  assert.ok(carrierRows.length >= 1 && carrierRows.length <= RUNTIME_CARRIER_INJECTION_MAX);
  assert.ok(Buffer.byteLength(text, "utf8") <= 12000);
  assert.ok(Buffer.byteLength(carrierRows.join("\n"), "utf8") <= RUNTIME_CARRIER_INJECTION_BYTES + 400);
});

test("注入不再接收载体候选时不产「本次未命中」或空段", () => {
  const result = {
    ok: true,
    specs: [],
    facts: [],
    runtimeCarriers: { available: false, candidates: [], counts: { scanned: 0, hits: 0, returned: 0 } },
    unchecked: { specs: [], facts: [], runtimeCarriers: [] },
    budget: { limitBytes: 8000, usedBytes: 0, limit: 3 },
    partial: false,
    truncated: false,
  };
  const text = renderRecallRow(result);
  assert.equal(text.includes("运行时机制："), false);
  assert.match(text, /本次未命中候选/);
});

test("切词确定：同一场景两次切出同一 token 集，且虚字不进入", () => {
  const a = tokenizeScene("要写一条踩坑经验，怎么记录");
  const b = tokenizeScene("要写一条踩坑经验，怎么记录");
  assert.deepEqual(a, b);
  assert.equal(a.includes("我的"), false);
  assert.ok(a.includes("踩坑"), "实义词须保留，否则载体匹配全落空");
  assert.deepEqual(tokenizeScene(""), []);
});

test("根目录解析：项目内 plugin-specs 优先，且 tier 可复算", async () => {
  await withTempRoot(async (root) => {
    assert.equal(await resolveRuntimeCarrierRoot(root), null);
    await writeCarrier(root, SPARK);
    const resolved = await resolveRuntimeCarrierRoot(root);
    assert.notEqual(resolved, null);
    assert.equal(resolved.tier, "project");
    assert.equal(resolved.dir, join(root, RUNTIME_CARRIER_DIR));
  });
});
