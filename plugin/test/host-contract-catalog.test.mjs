import assert from "node:assert/strict";
import test from "node:test";
import {
  extractArrayBody, splitTopLevelEntries, readEntryId,
  parseCatalogArray, parseEntryFields, API_ARRAYS, SLOT_ARRAY, CATALOG_PATHS, FIELD_LAYERS,
} from "../lib/host-contract-catalog.js";

const API_FIXTURE = `
export const SERVICE_API: readonly ServiceApiEntry[] = [
  {
    key: 'tools',
    summary: 'Register and guard tools.',
    methods: [
      { signature: 'register(d: Tool): () => void', description: 'a {b} in a string' },
      { signature: 'guard(g: Guard): void', description: 'quote\\'s and (paren)' },
    ],
  },
  {
    // a comment line with a stray ] bracket and { brace
    key: 'fs',
    summary: 'File system.',
    methods: [{ signature: 'read(p: string): void' }],
  },
]
export const EVENT_API: readonly EventApiEntry[] = [
  { name: 'agent/created', mode: 'serial', signature: '\\'agent/created\\'(p: P): void', parameters: [] },
  { name: 'session/event', mode: 'emit', signature: '\\'session/event\\'(s: S): void', parameters: [] },
]
`;

const SLOT_FIXTURE = `
export const CLIENT_SLOT_API: readonly ClientSlotEntry[] = [
  {
    key: 'conversation.view',
    kind: 'list',
    scope: 'session',
    registerOptions: [],
    ownerProps: [ 'interface X {\\n  readonly a: string;\\n}' ],
    occupants: [ 'shipped-view' ],
    source: 'packages/x/y.ts:12',
  },
  {
    key: 'plugins.row.config',
    kind: 'keyed',
    scope: 'root',
    registerOptions: [ { name: 'key', requirement: 'required', type: 'string', doc: 'd' } ],
    ownerProps: [],
    occupants: [],
    source: 'packages/x/z.ts:34',
  },
]
`;

test("extractArrayBody 取到 SERVICE_API 且字符串/注释内的括号不移动边界", () => {
  const body = extractArrayBody(API_FIXTURE, "SERVICE_API");
  assert.ok(body.includes("key: 'tools'"), "body 应含 tools 条目");
  assert.ok(body.includes("stray ] bracket"), "注释内的 ] 不得截断 body");
  assert.ok(!body.includes("EVENT_API"), "body 应在 SERVICE_API 的闭合 ] 处停住");
});

test("splitTopLevelEntries 只切出顶层两条，字符串内的 { } 不产生幻影条目", () => {
  const body = extractArrayBody(API_FIXTURE, "SERVICE_API");
  const entries = splitTopLevelEntries(body);
  assert.equal(entries.length, 2, "SERVICE_API 有且仅有 tools、fs 两条顶层条目");
  assert.ok(entries[0].includes("a {b} in a string"), "第一条含字符串内花括号原文");
});

test("readEntryId 取 key 字段，还原转义引号", () => {
  const body = extractArrayBody(API_FIXTURE, "SERVICE_API");
  const entries = splitTopLevelEntries(body);
  assert.equal(readEntryId(entries[0], "key"), "tools");
  assert.equal(readEntryId(entries[1], "key"), "fs");
});

test("parseCatalogArray 对三张表分别给出有序 id 与去重校验", () => {
  const svc = parseCatalogArray(API_FIXTURE, API_ARRAYS[0]);
  assert.deepEqual(svc.ids, ["tools", "fs"]);
  const evt = parseCatalogArray(API_FIXTURE, API_ARRAYS[1]);
  assert.deepEqual(evt.ids, ["agent/created", "session/event"]);
  const slot = parseCatalogArray(SLOT_FIXTURE, SLOT_ARRAY);
  assert.deepEqual(slot.ids, ["conversation.view", "plugins.row.config"]);
});

test("parseCatalogArray 对重复 id fail-closed（不静默取其一）", () => {
  const dup = `export const SERVICE_API: readonly X[] = [\n  { key: 'a' },\n  { key: 'a' },\n]`;
  assert.throws(() => parseCatalogArray(dup, API_ARRAYS[0]), /duplicate/u);
});

test("extractArrayBody 对缺失声明与不平衡数组 fail-closed", () => {
  assert.throws(() => extractArrayBody("nothing here", "SERVICE_API"), /not found/u);
  assert.throws(() => extractArrayBody("export const SERVICE_API = [ { key: 'a' ", "SERVICE_API"), /unbalanced/u);
});

test("readEntryId 对缺 id 字段的条目 fail-closed（不返回空 id）", () => {
  assert.throws(() => readEntryId("{ summary: 'no key here' }", "key"), /no key field/u);
});

test("parseEntryFields 逐字段拆分，含嵌套与转义 \\n 的多行值不串行", () => {
  const slot = parseCatalogArray(SLOT_FIXTURE, SLOT_ARRAY);
  const fields = parseEntryFields(slot.entries.get("conversation.view"));
  assert.equal(fields.get("key"), "'conversation.view'");
  assert.equal(fields.get("kind"), "'list'");
  assert.equal(fields.get("scope"), "'session'");
  assert.equal(fields.get("source"), "'packages/x/y.ts:12'");
  const op = fields.get("ownerProps");
  assert.ok(op.includes("interface X"), "ownerProps 含其嵌套声明");
  assert.ok(op.includes("readonly a: string"), "ownerProps 的转义 \\n 内容完整保留");
});

test("parseEntryFields 对无可解析字段的条目 fail-closed", () => {
  assert.throws(() => parseEntryFields("  garbage without fields\n"), /no parseable fields/u);
});

test("parseEntryFields 的 methods 多行字段必须解析完整（不得在首个内层 }, 截断）", () => {
  const api = parseCatalogArray(API_FIXTURE, API_ARRAYS[0]);
  const fields = parseEntryFields(api.entries.get("tools"));
  const methods = fields.get("methods");
  assert.ok(methods.includes("register(d: Tool)"), "methods 含第一条方法");
  assert.ok(methods.includes("guard(g: Guard)"), "methods 含第二条方法（截断时会丢失）");
  assert.equal((methods.match(/signature:/gu) ?? []).length, 2, "signature 条数与条目内方法数一致");
  assert.ok(methods.trimEnd().endsWith("]"), "methods 值以 ] 收尾，未把条目闭合并进值里");
  assert.equal(fields.get("key"), "'tools'");
  assert.equal(fields.get("summary"), "'Register and guard tools.'");
});

test("parseEntryFields 不把字符串内的 } 当作条目闭合（深度扫描须跳过字面量与注释）", () => {
  const api = parseCatalogArray(API_FIXTURE, API_ARRAYS[0]);
  const tools = parseEntryFields(api.entries.get("tools"));
  assert.ok(tools.get("methods").includes("a {b} in a string"), "字符串内的 } 不得移动边界");
  assert.ok(tools.get("methods").includes("(paren)"), "字符串内的 ( 不得移动边界");
});

test("FIELD_LAYERS 覆盖全部四张表，且契约/噪音字段互斥非空", () => {
  for (const name of ["SERVICE_API", "EVENT_API", "TYPE_API", "CLIENT_SLOT_API"]) {
    const layer = FIELD_LAYERS[name];
    assert.ok(layer, `${name} 必须有字段分层`);
    assert.ok(layer.contract.length > 0, `${name} 契约字段非空`);
    const overlap = layer.contract.filter((f) => layer.noise.includes(f));
    assert.deepEqual(overlap, [], `${name} 契约字段与噪音字段不得重叠`);
  }
  assert.ok(FIELD_LAYERS.CLIENT_SLOT_API.noise.includes("standardProps"), "standardProps 是框架级 hook 席位，属噪音");
  assert.ok(FIELD_LAYERS.CLIENT_SLOT_API.noise.includes("source"), "source 是行号指针，属噪音");
  assert.ok(FIELD_LAYERS.CLIENT_SLOT_API.contract.includes("registerOptions"), "registerOptions 是 registrant 读的契约");
});

test("CATALOG_PATHS 指向上游三条生成物路径（改路径即改契约，须同步）", () => {
  assert.equal(CATALOG_PATHS.api, "packages/extensions/tool-cordis/src/api-catalog.ts");
  assert.equal(CATALOG_PATHS.slot, "packages/extensions/cordis-client-runner/src/client/slot-catalog.ts");
  assert.equal(CATALOG_PATHS.upgradeGuideRoot, "docs/upgrade-guide");
});
