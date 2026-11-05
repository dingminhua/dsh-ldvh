// 对象标识解析的契约测试（workcase-410750b0 plan 第 4、5 步）。
//
// 钉住三件事：①四种书写形态各自解析到同一 canonical object_uid；②非法形态、
// 类型前缀不符、短标识碰撞各自有确定错误码（不得静默回退或自动裁决）；
// ③FACT_TYPE_DIRECTORIES 与九个 writer 的 *_DIRECTORY 常量逐项相等——否则本表
// 会漂移成第二权威。

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import {
  parseObjectIdentifier,
  resolveShortId,
  FACT_TYPE_DIRECTORIES,
  isRegisteredFactType,
  IDENTIFIER_ERRORS,
} from "../lib/object-identifier.js";

const UID = "71930c4a-f43f-439e-88bd-3aff7d07d37c";
const FACT_ROOT = new URL("../../ldvh-base/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// 1. 纯形态解析：四种书写形态
// ---------------------------------------------------------------------------

test("形态一：裸 canonical UUIDv4", () => {
  const r = parseObjectIdentifier(UID);
  assert.equal(r.ok, true);
  assert.equal(r.value.objectUid, UID);
  assert.equal(r.value.shortId, undefined);
  assert.equal(r.value.declaredType, undefined);
});

test("形态二：type-<完整uuid>", () => {
  const r = parseObjectIdentifier(`spark-${UID}`);
  assert.equal(r.ok, true);
  assert.equal(r.value.objectUid, UID);
  assert.equal(r.value.declaredType, "spark");
});

test("形态三：type-<8hex>（02 §9.3 规范形态）", () => {
  const r = parseObjectIdentifier("spark-71930c4a");
  assert.equal(r.ok, true);
  assert.equal(r.value.shortId, "71930c4a");
  assert.equal(r.value.declaredType, "spark");
  assert.equal(r.value.objectUid, undefined);
});

test("形态四：{projectId}@type-<uuid>（Web 复制按钮的现产物）", () => {
  const r = parseObjectIdentifier(`dsh-ldvh@spark-${UID}`);
  assert.equal(r.ok, true);
  assert.equal(r.value.objectUid, UID);
  assert.equal(r.value.declaredType, "spark");
  assert.equal(r.value.projectId, "dsh-ldvh");
});

test("形态四的变体：projectId 直接接 uuid / 短标识", () => {
  assert.equal(parseObjectIdentifier(`p@${UID}`).value.objectUid, UID);
  assert.equal(parseObjectIdentifier("p@spark-71930c4a").value.shortId, "71930c4a");
});

test("裸 8hex 也被接受（供反查，调用方再核类型）", () => {
  const r = parseObjectIdentifier("71930c4a");
  assert.equal(r.ok, true);
  assert.equal(r.value.shortId, "71930c4a");
  assert.equal(r.value.declaredType, undefined);
});

test("首尾空白被容忍（模型面常带空白）", () => {
  assert.equal(parseObjectIdentifier("  spark-71930c4a  ").value.shortId, "71930c4a");
});

// ---------------------------------------------------------------------------
// 2. 非法形态：每一种都有确定错误码，不静默回退
// ---------------------------------------------------------------------------

test("空串与非字符串 → malformed", () => {
  assert.equal(parseObjectIdentifier("").error.code, IDENTIFIER_ERRORS.MALFORMED);
  assert.equal(parseObjectIdentifier("   ").error.code, IDENTIFIER_ERRORS.MALFORMED);
  assert.equal(parseObjectIdentifier(null).error.code, IDENTIFIER_ERRORS.MALFORMED);
  assert.equal(parseObjectIdentifier(42).error.code, IDENTIFIER_ERRORS.MALFORMED);
});

test("未登记的类型前缀 → unknown_type（绝不猜造类型短名）", () => {
  const r = parseObjectIdentifier("notatype-71930c4a");
  assert.equal(r.ok, false);
  assert.equal(r.error.code, IDENTIFIER_ERRORS.UNKNOWN_TYPE);
  assert.equal(r.error.declared_type, "notatype");
});

test("短标识长度不足或超长 → malformed", () => {
  assert.equal(parseObjectIdentifier("spark-71930c4").error.code, IDENTIFIER_ERRORS.MALFORMED);
  assert.equal(parseObjectIdentifier("spark-71930c4ab").error.code, IDENTIFIER_ERRORS.MALFORMED);
});

test("多段 @ 不被逐层剥掉（只剥一层）", () => {
  assert.equal(parseObjectIdentifier("a@b@spark-71930c4a").error.code, IDENTIFIER_ERRORS.MALFORMED);
});

test("类型短名区分大小写（值域是小写闭集）", () => {
  assert.equal(parseObjectIdentifier("SPARK-71930c4a").error.code, IDENTIFIER_ERRORS.MALFORMED);
});

test("十六进制大写被归一为小写", () => {
  assert.equal(parseObjectIdentifier("spark-71930C4A").value.shortId, "71930c4a");
  assert.equal(parseObjectIdentifier(UID.toUpperCase()).value.objectUid, UID);
});

// ---------------------------------------------------------------------------
// 3. 载体反查：唯一命中、类型不符、不存在、碰撞
// ---------------------------------------------------------------------------

test("短标识反查到唯一 canonical uid", async () => {
  const r = await resolveShortId({ factSourceRoot: FACT_ROOT, shortId: "71930c4a" });
  assert.equal(r.ok, true);
  assert.equal(r.value.objectUid, UID);
  assert.equal(r.value.factTypeKey, "spark");
});

test("限定类型时只在那个类型目录内找", async () => {
  const hit = await resolveShortId({ factSourceRoot: FACT_ROOT, shortId: "71930c4a", declaredType: "spark" });
  assert.equal(hit.ok, true);
  const miss = await resolveShortId({ factSourceRoot: FACT_ROOT, shortId: "71930c4a", declaredType: "friction" });
  assert.equal(miss.ok, false);
  assert.equal(miss.error.code, IDENTIFIER_ERRORS.NOT_FOUND);
});

test("不存在的短标识 → not_found", async () => {
  const r = await resolveShortId({ factSourceRoot: FACT_ROOT, shortId: "ffffffff" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, IDENTIFIER_ERRORS.NOT_FOUND);
});

test("碰撞时拒绝并列出全部候选，不自动裁决", async () => {
  // 注入 readdir：让两个类型目录各返回一个前 8 位相同的载体。
  const collide = "aaaaaaaa-1111-4222-8333-444444444444";
  const injected = async (dir) => {
    if (dir.endsWith("/sparks")) return [`spark-${collide}.md`];
    if (dir.endsWith("/frictions")) return [`friction-${collide}.md`];
    return [];
  };
  const r = await resolveShortId({ factSourceRoot: "/nowhere", shortId: "aaaaaaaa" }, { readdir: injected });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, IDENTIFIER_ERRORS.AMBIGUOUS);
  assert.equal(r.error.candidates.length, 2);
});

test("目录缺失不算错误（该类型尚无对象）", async () => {
  const onlySparks = async (dir) => {
    if (dir.endsWith("/sparks")) return [`spark-${UID}.md`];
    const err = new Error("ENOENT"); err.code = "ENOENT"; throw err;
  };
  const r = await resolveShortId({ factSourceRoot: "/nowhere", shortId: "71930c4a" }, { readdir: onlySparks });
  assert.equal(r.ok, true);
  assert.equal(r.value.factTypeKey, "spark");
});

// ---------------------------------------------------------------------------
// 4. 类型目录表须与九个 writer 的常量逐项相等
// ---------------------------------------------------------------------------

test("FACT_TYPE_DIRECTORIES 与九个 writer 的 *_DIRECTORY 常量一致", async () => {
  const writers = {
    adr: ["adr-writer.js", "ADR_DIRECTORY"],
    devlog: ["devlog-writer.js", "DEVLOG_DIRECTORY"],
    friction: ["friction-writer.js", "FRICTION_DIRECTORY"],
    norm: ["norm-writer.js", "NORM_DIRECTORY"],
    pitfall: ["pitfall-writer.js", "PITFALL_DIRECTORY"],
    research: ["research-writer.js", "RESEARCH_DIRECTORY"],
    spark: ["spark-writer.js", "SPARK_DIRECTORY"],
    subgoal: ["subgoal-writer.js", "SUBGOAL_DIRECTORY"],
    workcase: ["workcase-writer.js", "WORKCASE_DIRECTORY"],
  };
  for (const [type, [file, constant]] of Object.entries(writers)) {
    const mod = await import(new URL(`../lib/${file}`, import.meta.url).href);
    assert.equal(
      FACT_TYPE_DIRECTORIES[type],
      mod[constant],
      `${type}: object-identifier 的目录表与 ${file} 的 ${constant} 漂移了`,
    );
  }
});

test("类型闭集与 object-reference 一致（同一事实不得有第二个来源）", () => {
  for (const type of Object.keys(FACT_TYPE_DIRECTORIES)) {
    assert.equal(isRegisteredFactType(type), true, `${type} 应已登记`);
  }
  assert.equal(isRegisteredFactType("goal"), true, "goal 是登记类型（单例，不在此目录表内）");
  assert.equal(isRegisteredFactType("nope"), false);
});

// ---------------------------------------------------------------------------
// 5. 项目前缀：本层可判（调用方传入当前项目 id），他项目须拒绝
// ---------------------------------------------------------------------------

test("项目前缀与当前项目不符时，解析器本身不判（它不知道当前项目）", () => {
  // 解析器只把声明的 projectId 原样带出，不做裁决——这是分层边界。
  const r = parseObjectIdentifier(`other-proj@spark-${UID}`);
  assert.equal(r.ok, true);
  assert.equal(r.value.projectId, "other-proj");
});

test("读取入口：本项目前缀放行、他项目前缀拒绝", async () => {
  const { readSparkObject } = await import("../lib/spark-writer.js");
  const own = await readSparkObject({ factSourceRoot: FACT_ROOT, objectUid: `dsh-ldvh@spark-${UID}`, currentProjectId: "dsh-ldvh" });
  assert.equal(own.ok, true, "本项目前缀应放行");

  const foreign = await readSparkObject({ factSourceRoot: FACT_ROOT, objectUid: `other-proj@spark-${UID}`, currentProjectId: "dsh-ldvh" });
  assert.equal(foreign.ok, false, "他项目前缀必须拒绝，不得静默忽略前缀");
  assert.match(foreign.error.message, /foreign_project/);
});

test("读取入口：调用方未提供当前项目时不因前缀拒绝（向后兼容）", async () => {
  const { readSparkObject } = await import("../lib/spark-writer.js");
  const r = await readSparkObject({ factSourceRoot: FACT_ROOT, objectUid: `any-proj@spark-${UID}` });
  assert.equal(r.ok, true);
});

test("读取入口：四种形态读到的正文逐字节一致", async () => {
  const { readSparkObject } = await import("../lib/spark-writer.js");
  const forms = [UID, `spark-${UID}`, "spark-71930c4a", `dsh-ldvh@spark-${UID}`];
  const bodies = [];
  for (const form of forms) {
    const r = await readSparkObject({ factSourceRoot: FACT_ROOT, objectUid: form, currentProjectId: "dsh-ldvh" });
    assert.equal(r.ok, true, `${form} 应可读`);
    bodies.push(r.value.body);
  }
  assert.equal(new Set(bodies).size, 1, "四种形态必须读到同一份正文");
});

test("读取入口：类型前缀与实际类型不符时给出 type_prefix_mismatch", async () => {
  const { readSparkObject } = await import("../lib/spark-writer.js");
  const r = await readSparkObject({ factSourceRoot: FACT_ROOT, objectUid: `friction-${UID}`, currentProjectId: "dsh-ldvh" });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /type_prefix_mismatch/);
});

// ---------------------------------------------------------------------------
// 6. 写路径不得随读路径放宽（scope 边界：写错对象的代价与读错不对等）
// ---------------------------------------------------------------------------

test("workcase 写路径的存续门仍是 canonical-only（不得被读入口的宽松解析连带放宽）", () => {
  // 这条用例的来源：独立复核发现 workcase-writer 的 assertValidUid 一度成为孤儿
  // （定义在 :550 但无调用点）——因为 12 条写流程都经 loadAndCheckFingerprint →
  // readWorkcaseObject，而后者已接宽松解析；于是写路径静默接受了四种书写形态，
  // 越过 scope「不改写路径的 uid 入参」这一条。此用例钉住「写路径另有 canonical 门」。
  const source = readFileSync(new URL("../lib/workcase-writer.js", import.meta.url), "utf8");
  const start = source.indexOf("async function loadAndCheckFingerprint");
  assert.notEqual(start, -1, "loadAndCheckFingerprint 应存在");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.match(
    body,
    /assertValidUid\(objectUid\)/,
    "写路径的 CAS 入口必须保留 canonical-only 门；缺了它，读入口的四形态放宽会连带上溯到写路径",
  );
});

test("其余八个 writer 的写路径仍各自持有 canonical-only 门", () => {
  const writers = ["adr", "devlog", "friction", "norm", "pitfall", "research", "spark", "subgoal"];
  for (const type of writers) {
    const source = readFileSync(new URL(`../lib/${type}-writer.js`, import.meta.url), "utf8");
    const uses = source.split("assertValidUid(").length - 1;
    assert.ok(uses >= 2, `${type}-writer 应至少有「定义 + 一处写路径调用」两处 assertValidUid，实际 ${uses}`);
  }
});
