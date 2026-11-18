import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(PLUGIN, "lib");

const manifest = JSON.parse(await readFile(join(LIB, "host-consumption.json"), "utf8"));

const NON_HOST_LITERAL_GETS = new Set(["cwd", "sessionId"]);

async function readLibSources() {
  const files = (await readdir(LIB)).filter((f) => f.endsWith(".js"));
  const sources = new Map();
  for (const f of files) sources.set(`lib/${f}`, await readFile(join(LIB, f), "utf8"));
  return sources;
}

function extractConsumption(src) {
  const services = new Set();
  const events = new Set();
  const slots = new Set();
  const anchors = new Set();
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
  for (const m of src.matchAll(/(?:\?\.|\.)on\??\.?\(\s*["']([a-zA-Z0-9_/-]+)["']/gu)) {
    if (m[1].includes("/")) events.add(m[1]);
  }
  for (const m of src.matchAll(/slots\.(?:inject|register)\(\s*["']([a-z][a-zA-Z0-9_.]+)["']/gu)) slots.add(m[1]);
  for (const key of ["plugins.bundle.config", "plugins.row.config", "conversation.view", "conversation.chat.node"]) {
    if (src.includes(`"${key}"`)) slots.add(key);
  }
  for (const a of ["data-question-key", "optionSelected", "descriptionToggle", "cardMinimized"]) {
    if (src.includes(a)) anchors.add(a);
  }
  return { services, events, slots, anchors };
}

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
