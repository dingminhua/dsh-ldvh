// 消费面清单一致性 — Norm host-upgrade-followup「约束与反模式」的机械守卫。
//
// 清单 lib/host-consumption.json 是三态判定的比对基准。它与插件**实际消费点**
// （lib/*.js 里的 ctx.get / inject / .on / slots.register 调用）必须双向一致：
//   · 代码消费了一个键而清单没登记 → 三态判定会对它漏判（升级破坏看不到）
//   · 清单登记了一个键而代码已不消费 → 清单漂移，破坏/须审会误报到已死的面
// 两个方向都必须被抓，否则清单会静默失真（corpus.test 同款「skip 不得掩盖」纪律：
// 这里不做 skip，代码与清单都在本仓，无外部依赖）。
//
// 提取规则刻意用**保守判据**：宿主事件名恒含 `/`，Node/子进程事件（close/data/
// end/error/exit/open/timeout）不含 `/`——以「是否含 /」区分宿主契约面与本地事件，
// 不把子进程 on("data") 误当宿主事件。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(PLUGIN, "lib");

const manifest = JSON.parse(await readFile(join(LIB, "host-consumption.json"), "utf8"));

/**
 * `.get("字面量")` 调用里**不是宿主服务**的键（receiver-agnostic 提取的超集会
 * 带进它们）。仅 URLSearchParams 的参数名——`new URL(...).searchParams.get("cwd")`
 * 是取 URL 查询参，不是 ctx.get 服务。这是一个**小而稳定**的排除表；若将来代码
 * 引入新的非宿主 `.get("字面量")`（如 Map.get），在此登记并写明 receiver。
 * 排除表键不得与清单任何键相撞（下方用例守卫）。
 */
const NON_HOST_LITERAL_GETS = new Set(["cwd", "sessionId"]);

/** 读全部 lib/*.js 源码（排除本清单自身与解析库——它们不含宿主消费点）。 */
async function readLibSources() {
  const files = (await readdir(LIB)).filter((f) => f.endsWith(".js"));
  const sources = new Map();
  for (const f of files) sources.set(`lib/${f}`, await readFile(join(LIB, f), "utf8"));
  return sources;
}

/**
 * 从一份源码提取它消费的宿主键。返回 { services:Set, events:Set, slots:Set,
 * anchors:Set }——判据与清单的四个分区一一对应。
 *
 * **receiver-agnostic 提取**：`ctx.get("k")` 在真实代码里有多种 receiver 与可选链
 * 形态——`ctx.get(` / `ctx?.get?.(` / `agent?.ctx?.get?.(` / `questionContext?.get(`
 * / `connectionCtx.get?.(`（后两者是 ctx 的别名变量）。若按 receiver 名匹配，
 * `agent?.ctx?.get?.("subagents")` 这类会漏（这正是本清单曾漏登 subagents 服务的
 * 成因）。故这里匹配 `.get`/`?.get` 全形态、不看 receiver，再用 NON_HOST_LITERAL_GETS
 * 减去已知的非宿主字面量键。提取是**超集**：宁可多抓待清单解释，不可漏抓。
 */
function extractConsumption(src) {
  const services = new Set();
  const events = new Set();
  const slots = new Set();
  const anchors = new Set();
  // 服务：.get("k") / .get?.("k") / ?.get?.("k")（receiver 无关）+ inject 清单
  const GET_CALL = /(?:\?\.|\.)get\??\.?\(\s*["']([\w.]+)["']/gu;
  for (const m of src.matchAll(GET_CALL)) {
    if (!NON_HOST_LITERAL_GETS.has(m[1])) services.add(m[1]);
  }
  for (const m of src.matchAll(/inject\s*=\s*\[([^\]]+)\]/gu)) {
    for (const part of m[1].split(",")) {
      const k = part.trim().replace(/["']/gu, "");
      if (k) services.add(k);
    }
  }
  for (const m of src.matchAll(/ctx\.inject\(\s*\[\s*["']([a-zA-Z0-9_.]+)["']/gu)) services.add(m[1]);
  // 事件：.on("name")，仅取含 `/` 者（宿主契约面；排除 Node/子进程本地事件）
  for (const m of src.matchAll(/(?:\?\.|\.)on\??\.?\(\s*["']([a-zA-Z0-9_/-]+)["']/gu)) {
    if (m[1].includes("/")) events.add(m[1]);
  }
  // 槽位：slots.inject/register("key") 与显式配置槽位键
  for (const m of src.matchAll(/slots\.(?:inject|register)\(\s*["']([a-z][a-zA-Z0-9_.]+)["']/gu)) slots.add(m[1]);
  for (const key of ["plugins.bundle.config", "plugins.row.config", "conversation.view", "conversation.chat.node"]) {
    if (src.includes(`"${key}"`)) slots.add(key);
  }
  // 非契约锚点：CSS/DOM 字面量
  for (const a of ["data-question-key", "optionSelected", "descriptionToggle", "cardMinimized"]) {
    if (src.includes(a)) anchors.add(a);
  }
  return { services, events, slots, anchors };
}

/** 汇总全 lib 的消费点（并集），另存每个键出现在哪些文件，供 callSites 核对。 */
async function aggregateConsumption() {
  const sources = await readLibSources();
  const all = { services: new Set(), events: new Set(), slots: new Set(), anchors: new Set() };
  const files = { services: new Map(), events: new Map(), slots: new Map(), anchors: new Map() };
  for (const [file, src] of sources) {
    const c = extractConsumption(src);
    for (const plane of ["services", "events", "slots", "anchors"]) {
      for (const k of c[plane]) {
        all[plane].add(k);
        if (!files[plane].has(k)) files[plane].set(k, []);
        files[plane].get(k).push(file);
      }
    }
  }
  return { all, files };
}

const { all, files } = await aggregateConsumption();

const manifestServices = new Set(manifest.hostServices.map((s) => s.key));
const manifestEvents = new Set(manifest.hostEvents.map((e) => e.name));
const manifestSlots = new Set(manifest.clientSlots.map((s) => s.key));
const manifestAnchors = new Set(manifest.nonContract.map((n) => n.anchor));
// 值服务/客户端服务也是服务面消费点（ctx.get/inject 抓得到），并入服务清单核对
for (const v of manifest.valueServices) manifestServices.add(v.key);
for (const v of manifest.clientServices) manifestServices.add(v.key);

test("服务面双向一致：代码消费的每个服务键都在清单，清单每个服务键都被代码消费", () => {
  const inCodeNotManifest = [...all.services].filter((k) => !manifestServices.has(k));
  const inManifestNotCode = [...manifestServices].filter((k) => !all.services.has(k));
  assert.deepEqual(inCodeNotManifest, [], `代码消费但清单未登记的服务（三态会漏判）：${inCodeNotManifest}`);
  assert.deepEqual(inManifestNotCode, [], `清单登记但代码已不消费的服务（清单漂移）：${inManifestNotCode}`);
});

test("事件面双向一致：仅含 `/` 的宿主事件参与核对", () => {
  const inCodeNotManifest = [...all.events].filter((k) => !manifestEvents.has(k));
  const inManifestNotCode = [...manifestEvents].filter((k) => !all.events.has(k));
  assert.deepEqual(inCodeNotManifest, [], `代码监听但清单未登记的宿主事件：${inCodeNotManifest}`);
  assert.deepEqual(inManifestNotCode, [], `清单登记但代码已不监听的宿主事件：${inManifestNotCode}`);
});

test("槽位面双向一致", () => {
  const inCodeNotManifest = [...all.slots].filter((k) => !manifestSlots.has(k));
  const inManifestNotCode = [...manifestSlots].filter((k) => !all.slots.has(k));
  assert.deepEqual(inCodeNotManifest, [], `代码注册但清单未登记的槽位：${inCodeNotManifest}`);
  assert.deepEqual(inManifestNotCode, [], `清单登记但代码已不注册的槽位：${inManifestNotCode}`);
});

test("非契约锚点双向一致", () => {
  const inCodeNotManifest = [...all.anchors].filter((k) => !manifestAnchors.has(k));
  const inManifestNotCode = [...manifestAnchors].filter((k) => !all.anchors.has(k));
  assert.deepEqual(inCodeNotManifest, [], `代码使用但清单未登记的锚点：${inCodeNotManifest}`);
  assert.deepEqual(inManifestNotCode, [], `清单登记但代码已不使用的锚点：${inManifestNotCode}`);
});

test("callSites 精确：清单每个条目的 callSites 都是真实引用该键的文件（不多列不漏列）", () => {
  const problems = [];
  const checkPlane = (entries, keyField, fileMap) => {
    for (const e of entries) {
      const key = e[keyField];
      const actual = (fileMap.get(key) ?? []).slice().sort();
      const declared = (e.callSites ?? []).slice().sort();
      if (JSON.stringify(actual) !== JSON.stringify(declared)) {
        problems.push(`${key}: 清单 callSites=${JSON.stringify(declared)}，实测=${JSON.stringify(actual)}`);
      }
    }
  };
  checkPlane(manifest.hostServices, "key", files.services);
  checkPlane(manifest.valueServices, "key", files.services);
  checkPlane(manifest.clientServices, "key", files.services);
  checkPlane(manifest.hostEvents, "name", files.events);
  checkPlane(manifest.clientSlots, "key", files.slots);
  checkPlane(manifest.nonContract, "anchor", files.anchors);
  assert.deepEqual(problems, [], `callSites 与实测消费文件不符：\n${problems.join("\n")}`);
});

test("清单结构自洽：version 存在、每条目有 callSites 与说明、无重复键", () => {
  assert.equal(typeof manifest.version, "number", "version 必须是数字");
  const allKeys = [];
  const requireFields = (arr, keyField, label) => {
    for (const e of arr) {
      assert.ok(e[keyField], `${label} 条目缺 ${keyField}`);
      assert.ok(Array.isArray(e.callSites) && e.callSites.length > 0, `${label} ${e[keyField]} 缺 callSites`);
      allKeys.push(`${label}:${e[keyField]}`);
    }
  };
  requireFields(manifest.hostServices, "key", "hostServices");
  requireFields(manifest.hostEvents, "name", "hostEvents");
  requireFields(manifest.clientSlots, "key", "clientSlots");
  requireFields(manifest.valueServices, "key", "valueServices");
  requireFields(manifest.clientServices, "key", "clientServices");
  requireFields(manifest.nonContract, "anchor", "nonContract");
  const dup = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);
  assert.deepEqual(dup, [], `清单有重复键：${dup}`);
});
