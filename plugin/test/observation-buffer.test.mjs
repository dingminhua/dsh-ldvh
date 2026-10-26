// Tests for plugin/lib/observation-buffer.js — the §12bis 留观缓冲 carrier.
//
// Every case is derived from specs/11 §12bis (the single authority for this carrier),
// §18 (写入合法 / 不可写不可回读) and specs/02 §6.1 末「事实源之外的中间产物」.
// Where the implementation diverges from the spec the failure is reported, never
// "fixed" by bending the assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendBufferEntry,
  readBufferEntries,
  settleBufferEntry,
  bufferEntryPath,
  BUFFER_RELATIVE_PATH,
  BUFFER_STATUSES,
  BUFFER_CAPACITY,
  BUFFER_PENDING_TTL_DAYS,
  BUFFER_SETTLED_TTL_DAYS,
  BUFFER_REQUIRED_FIELDS,
  BUFFER_SETTLED_AT_FIELD,
  BUFFER_MAX_PHENOMENON_LENGTH,
  BUFFER_MAX_EVIDENCE_LENGTH,
} from "../lib/observation-buffer.js";
import { appendPendingEntry, QUEUE_RELATIVE_PATH } from "../lib/pending-queue.js";

/** dshHomePath 的形状与 pending-queue 一致：一个 (...segments) => path 的函数。 */
async function withHome(fn) {
  const base = await mkdtemp(join(tmpdir(), "observation-buffer-"));
  const home = (...segments) => join(base, ...segments);
  home.base = base;
  try {
    await fn(home);
  } finally {
    // temp dirs are left for the OS; no cleanup service is mandated by the spec
  }
}

/** 造一条合法的待写入条目。 */
function validEntry(overrides = {}) {
  return {
    session: "sess-2026-03-01-abc",
    anchor: "turn-014",
    phenomenon: "编辑 config 时插件在 hook 阶段抛出 EACCES。",
    evidence: "EACCES: permission denied, open '/tmp/ldvh/config.json'\n—— 来源引用：sess-2026-03-01-abc turn-014",
    candidate_question: "这里的 hook 是以什么身份写文件的？",
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// 载体位置与分离：§12bis「与待处置队列分开，不得合并为一个载体」
// ---------------------------------------------------------------------------

test("carrier: the buffer lives under the DSH home and is a carrier of its own (§12bis 载体与位置)", async () => {
  await withHome(async (home) => {
    assert.deepEqual([...BUFFER_RELATIVE_PATH], ["ldvh", "observation-buffer.jsonl"]);
    assert.equal(bufferEntryPath(home), join(home.base, "ldvh", "observation-buffer.jsonl"));
    // 不在事实源目录之内——它是宿主侧运行载体（§13 第 4 项）。
    assert.ok(!bufferEntryPath(home).includes("ldvh-base"));
  });
});

test("carrier: the buffer and the pending queue are separate carriers (§12bis 读取纪律第 5 条)", async () => {
  await withHome(async (home) => {
    assert.ok(
      !bufferEntryPath(home).includes("pending-queue"),
      "the buffer must not be merged into the pending-queue carrier",
    );
    assert.notEqual(bufferEntryPath(home), join(home.base, ...QUEUE_RELATIVE_PATH));

    // 一个模块的写入不影响另一个模块的载体。
    const appended = await appendBufferEntry(home, validEntry());
    assert.ok(appended.ok, JSON.stringify(appended.error));
    const queued = await appendPendingEntry(home, {
      task: "friction-discovery",
      reason: "回读不完整：写入后比对失败",
      residual: ["none"],
    });
    assert.ok(queued.ok, JSON.stringify(queued.error));

    const bufferRaw = await readFile(bufferEntryPath(home), "utf8");
    const queueRaw = await readFile(join(home.base, ...QUEUE_RELATIVE_PATH), "utf8");
    assert.equal(bufferRaw.trim().split("\n").length, 1, "the buffer holds only its own entry");
    assert.equal(queueRaw.trim().split("\n").length, 1, "the queue holds only its own entry");
    assert.ok(!bufferRaw.includes("friction-discovery"));
    assert.ok(!queueRaw.includes("observation-buffer"));
  });
});

// ---------------------------------------------------------------------------
// 追加：字段闭集（§12bis 字段表 9 项；§18 第 1 行「字段闭集齐备」）
// ---------------------------------------------------------------------------

/**
 * 载体的一条物理行是**事件**（2026-10-26 起追加事件日志形态），不是完整记录。
 * 取事件里的 entry 记录，供既有断言用。
 */
function entryEventOf(line) {
  const parsed = JSON.parse(line);
  return parsed.kind === "entry" ? parsed.record : parsed;
}

test("append: writes one JSONL line carrying the whole field set (§12bis 字段闭集)", async () => {
  await withHome(async (home) => {
    const result = await appendBufferEntry(home, validEntry());
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.ok(typeof result.value.entry_id === "string" && result.value.entry_id.length > 0);

    const raw = await readFile(bufferEntryPath(home), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1, "one append writes one JSONL line");
    // 该行是 `{kind:"entry", record}` 事件（追加事件日志形态，2026-10-26）。
    assert.equal(JSON.parse(lines[0]).kind, "entry", "追加写的是一个 entry 事件");
    const parsed = entryEventOf(lines[0]);
    for (const field of BUFFER_REQUIRED_FIELDS) {
      assert.ok(field in parsed, `§12bis requires field "${field}"`);
    }
    assert.equal(parsed.id, result.value.entry_id, "id is assigned by the implementation");
    assert.equal(parsed.status, "pending", "a fresh entry is pending");
    assert.equal(parsed.consumed_by, null, "consumed_by is null unless the entry is consumed");
    assert.match(parsed.at, /^\d{4}-\d{2}-\d{2}T/, "at is RFC3339");
    assert.equal(parsed.session, "sess-2026-03-01-abc");
    assert.equal(parsed.anchor, "turn-014");
  });
});

test("append: rejects a field outside the §12bis field set (§12bis：超出即越界)", async () => {
  await withHome(async (home) => {
    const result = await appendBufferEntry(home, validEntry({ priority: "high" }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/unexpected_field");
    assert.match(result.error.message, /priority/);

    // 实现侧生成的字段也不由调用方指定（status/consumed_by/id）。
    const forced = await appendBufferEntry(home, validEntry({ status: "consumed" }));
    assert.equal(forced.ok, false);
    assert.equal(forced.error.code, "observation_buffer/unexpected_field");
  });
});

test("append: rejects a missing field and names the missing one (§18 第 1 行：字段闭集齐备)", async () => {
  await withHome(async (home) => {
    for (const field of ["session", "anchor", "phenomenon", "evidence", "candidate_question"]) {
      const entry = validEntry();
      delete entry[field];
      const result = await appendBufferEntry(home, entry);
      assert.equal(result.ok, false, `missing "${field}" must be rejected`);
      assert.equal(result.error.code, `observation_buffer/missing_${field}`);
      assert.match(result.error.message, new RegExp(field));
    }
  });
});

test("append: rejects an empty or whitespace-only phenomenon (§12bis：phenomenon 是一句话描述)", async () => {
  await withHome(async (home) => {
    for (const value of ["", "   ", "\n\t "]) {
      const result = await appendBufferEntry(home, validEntry({ phenomenon: value }));
      assert.equal(result.ok, false, `phenomenon ${JSON.stringify(value)} must be rejected`);
      assert.equal(result.error.code, "observation_buffer/missing_phenomenon");
    }
  });
});

test("append: rejects a phenomenon beyond the one-sentence length bound (§12bis：phenomenon 是一句话)", async () => {
  await withHome(async (home) => {
    const result = await appendBufferEntry(
      home,
      validEntry({ phenomenon: "x".repeat(BUFFER_MAX_PHENOMENON_LENGTH + 1) }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/phenomenon_too_long");
    assert.match(result.error.message, /400/);
  });
});

test("append: rejects a phenomenon that is not a single sentence (§12bis：一句话，是描述不是结论)", async () => {
  await withHome(async (home) => {
    const result = await appendBufferEntry(
      home,
      validEntry({ phenomenon: "输出为空。进程随后退出。" }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/phenomenon_not_one_sentence");
  });
});

test("append: accepts a one-sentence phenomenon that quotes a source fragment (§12bis：逐字引证常含句号)", async () => {
  await withHome(async (home) => {
    const result = await appendBufferEntry(
      home,
      validEntry({ phenomenon: "命令输出为「未找到文件。」" }),
    );
    assert.ok(result.ok, JSON.stringify(result.error));
  });
});

test("append: rejects an empty or purely referential evidence (§12bis：evidence 必须是逐字片段并附来源引用)", async () => {
  await withHome(async (home) => {
    const empty = await appendBufferEntry(home, validEntry({ evidence: "   " }));
    assert.equal(empty.ok, false);
    assert.equal(empty.error.code, "observation_buffer/missing_evidence");

    for (const reference of ["见上", "同上", "见上文", "  同上  "]) {
      const result = await appendBufferEntry(home, validEntry({ evidence: reference }));
      assert.equal(result.ok, false, `evidence ${JSON.stringify(reference)} must be rejected`);
      assert.equal(result.error.code, "observation_buffer/evidence_not_verbatim");
    }
  });
});

test("append: rejects an evidence beyond the verbatim-fragment bound (§12bis：禁止写入完整消息/日志/命令输出)", async () => {
  await withHome(async (home) => {
    const result = await appendBufferEntry(
      home,
      validEntry({ evidence: "x".repeat(BUFFER_MAX_EVIDENCE_LENGTH + 1) }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/evidence_too_long");
  });
});

test("append: keeps the evidence verbatim, byte for byte (§12bis：不得转述概括)", async () => {
  await withHome(async (home) => {
    const evidence = "  EACCES: permission denied\n    open '/tmp/x'\n—— sess-abc turn-014  ";
    const result = await appendBufferEntry(home, validEntry({ evidence }));
    assert.ok(result.ok, JSON.stringify(result.error));
    const raw = await readFile(bufferEntryPath(home), "utf8");
    const parsed = entryEventOf(raw.trim().split("\n")[0]);
    assert.equal(parsed.evidence, evidence, "the evidence is stored verbatim, not trimmed");
  });
});

test("append: rejects a malformed at and accepts an explicit RFC3339 at (§12bis：at 是 RFC3339)", async () => {
  await withHome(async (home) => {
    const bad = await appendBufferEntry(home, validEntry({ at: "2026-03-01 10:00:00" }));
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "observation_buffer/invalid_at");

    const good = await appendBufferEntry(home, validEntry({ at: "2026-03-01T10:00:00.000Z" }));
    assert.ok(good.ok, JSON.stringify(good.error));
    const raw = await readFile(bufferEntryPath(home), "utf8");
    const parsed = entryEventOf(raw.trim().split("\n")[0]);
    assert.equal(parsed.at, "2026-03-01T10:00:00.000Z");
  });
});

test("append: fails closed when the carrier is not writable (§12bis 读取纪律第 4 条；§18 第 2 行)", async () => {
  await withHome(async (home) => {
    // 让载体路径落在一个目录上——append 必然抛错，模拟「不可写」。
    await mkdir(join(home.base, "ldvh"), { recursive: true });
    await mkdir(bufferEntryPath(home), { recursive: true });

    const result = await appendBufferEntry(home, validEntry());
    assert.equal(result.ok, false, "a non-writable carrier must not yield a success");
    assert.equal(result.error.code, "observation_buffer/unavailable");

    // 不得降级为「只记在内存」或「只写日志」：载体仍是那个目录，没有旁路产物。
    const info = await stat(bufferEntryPath(home));
    assert.ok(info.isDirectory(), "nothing was written beside the carrier");
    const entries = await readdir(home.base);
    assert.deepEqual(entries.sort(), ["ldvh"], "no fallback artefact was created");
  });
});

// ---------------------------------------------------------------------------
// 读取：合法初态、残缺行、参数契约（§12ter.1 / §12ter.2）
// ---------------------------------------------------------------------------

test("read: an absent carrier is a legal empty state, not an error (§12ter.2)", async () => {
  await withHome(async (home) => {
    const result = await readBufferEntries(home);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.deepEqual(result.value.items, []);
    assert.equal(result.value.total, 0);
    assert.equal(result.value.carrier, "absent");
    assert.equal(result.value.complete, true);
    assert.equal(result.value.at_capacity, false);
    assert.deepEqual(result.value.invalid, []);
  });
});

test("read: rejects a status outside the closed set (§12ter.1：status 闭集)", async () => {
  await withHome(async (home) => {
    const result = await readBufferEntries(home, { status: "archived" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/invalid_status");

    for (const status of BUFFER_STATUSES) {
      const ok = await readBufferEntries(home, { status });
      assert.ok(ok.ok, `${status} is a member of the closed set`);
    }
  });
});

test("read: rejects a limit that is not a positive integer (§12ter.1：limit 可选正整数)", async () => {
  await withHome(async (home) => {
    for (const limit of [0, -1, 1.5, "3"]) {
      const result = await readBufferEntries(home, { limit });
      assert.equal(result.ok, false, `limit ${JSON.stringify(limit)} must be rejected`);
      assert.equal(result.error.code, "observation_buffer/invalid_limit");
    }
  });
});

test("read: a limit may only lower the returned count (§12ter.1：不得绕过容量上限与淘汰规则)", async () => {
  await withHome(async (home) => {
    for (let index = 0; index < 5; index += 1) {
      const result = await appendBufferEntry(home, validEntry({ anchor: `turn-${index}` }));
      assert.ok(result.ok, JSON.stringify(result.error));
    }
    const all = await readBufferEntries(home);
    assert.equal(all.value.items.length, 5);
    const limited = await readBufferEntries(home, { limit: 2 });
    assert.equal(limited.value.items.length, 2);
    // total 仍是载体全貌——limit 只影响返回条数，不影响事实。
    assert.equal(limited.value.total, 5);
  });
});

test("read: a broken line is reported, never silently dropped (§12bis 读取纪律；read 的 complete 语义)", async () => {
  await withHome(async (home) => {
    await mkdir(join(home.base, "ldvh"), { recursive: true });
    await writeFile(
      bufferEntryPath(home),
      // 一行是**字段不全的 entry 事件**，另一行是**破损 JSON**——两者都须如实报出。
      `${JSON.stringify({ kind: "entry", record: { id: "x", at: "2026-03-01T00:00:00.000Z" } })}\n{ this is not json\n`,
      "utf8",
    );

    const result = await readBufferEntries(home);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.complete, false, "an unreadable line means the read is not complete");
    assert.ok(result.value.invalid.length >= 2, "both the incomplete record and the broken line are reported");
    assert.ok(result.value.invalid.some((item) => /JSON/i.test(item.reason)));
    assert.ok(result.value.invalid.some((item) => /missing field/.test(item.reason)));
    for (const item of result.value.invalid) {
      assert.equal(typeof item.line, "number");
      assert.equal(typeof item.excerpt, "string");
    }
  });
});

test("read: items carry the §12bis field set plus the implementation-side settled_at (§12bis 字段闭集)", async () => {
  await withHome(async (home) => {
    const appended = await appendBufferEntry(home, validEntry());
    assert.ok(appended.ok, JSON.stringify(appended.error));
    const result = await readBufferEntries(home);
    const item = result.value.items[0];
    assert.deepEqual(
      Object.keys(item).sort(),
      [...BUFFER_REQUIRED_FIELDS, BUFFER_SETTLED_AT_FIELD].sort(),
    );
    assert.equal(item[BUFFER_SETTLED_AT_FIELD], null, "a pending entry carries no settled_at yet");
  });
});

test("read: reports the status distribution and the capacity state (§12ter.2 结果契约)", async () => {
  await withHome(async (home) => {
    await appendBufferEntry(home, validEntry({ anchor: "turn-1" }));
    const second = await appendBufferEntry(home, validEntry({ anchor: "turn-2" }));
    assert.ok(second.ok, JSON.stringify(second.error));
    const settled = await settleBufferEntry(home, second.value.entry_id, {
      status: "consumed",
      consumedBy: "draft-object-uid-1",
    });
    assert.ok(settled.ok, JSON.stringify(settled.error));

    const result = await readBufferEntries(home);
    assert.equal(result.value.total, 2);
    assert.equal(result.value.by_status.pending, 1);
    assert.equal(result.value.by_status.consumed, 1);
    assert.equal(result.value.by_status.discarded, 0);
    assert.equal(result.value.by_status.evicted, 0);
    assert.equal(result.value.at_capacity, false);
  });
});

// ---------------------------------------------------------------------------
// 容量上限：§12bis「条目数上限 200」「最旧优先淘汰」「保留记录」
// ---------------------------------------------------------------------------

test("capacity: BUFFER_CAPACITY is the §12bis default of 200 and may not be raised", async () => {
  await withHome(async (home) => {
    assert.equal(BUFFER_CAPACITY, 200);
    const result = await appendBufferEntry(home, validEntry(), { capacity: 201 });
    assert.equal(result.ok, false, "raising the capacity is not allowed");
    assert.equal(result.error.code, "observation_buffer/invalid_capacity");
    assert.match(result.error.message, /200/);
  });
});

test("capacity: the oldest entry is evicted first and the record is kept (§12bis 容量与保留期第 1 项)", async () => {
  await withHome(async (home) => {
    // 容量接缝只为让测试不必真写 200 条；它只可调低，规范默认值不变。
    const capacity = 3;
    const ids = [];
    for (let index = 0; index < 4; index += 1) {
      const result = await appendBufferEntry(
        home,
        validEntry({ anchor: `turn-${index}`, at: new Date(Date.now() + index * 1000).toISOString() }),
        { capacity },
      );
      assert.ok(result.ok, JSON.stringify(result.error));
      ids.push(result.value.entry_id);
    }

    const result = await readBufferEntries(home, { capacity });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.at_capacity, true, "the live count reached the capacity");
    assert.equal(result.value.live_total, capacity, "the live count never exceeds the capacity");
    assert.equal(result.value.total, capacity + 1, "the evicted record is kept, not dropped");
    assert.equal(result.value.by_status.evicted, 1);
    assert.equal(result.value.by_status.pending, capacity);

    const evicted = result.value.items.find((item) => item.status === "evicted");
    assert.ok(evicted, "the evicted record is visible in the carrier");
    assert.equal(evicted.id, ids[0], "the oldest entry (by at) is evicted first");
    assert.ok(evicted[BUFFER_SETTLED_AT_FIELD], "the evicted record carries the settlement stamp");
  });
});

test("capacity: an append after an eviction still writes a parsable line (§12bis 追加型载体)", async () => {
  await withHome(async (home) => {
    for (let index = 0; index < 4; index += 1) {
      await appendBufferEntry(
        home,
        validEntry({ anchor: `turn-${index}`, at: new Date(Date.now() + index * 1000).toISOString() }),
        { capacity: 3 },
      );
    }
    const after = await appendBufferEntry(
      home,
      validEntry({ anchor: "turn-late", at: new Date(Date.now() + 9000).toISOString() }),
      { capacity: 3 },
    );
    assert.ok(after.ok, JSON.stringify(after.error));

    const raw = await readFile(bufferEntryPath(home), "utf8");
    const lines = raw.trim().split("\n");
    // 5 次追加各写一条 entry 事件；淘汰写成额外的 settle 事件（追加事件日志形态）。
    // 故行数 ≥ 5，且**每一行都须可解析**——这是本条真正要守的性质。
    assert.ok(lines.length >= 5, `at least one event per append (got ${lines.length})`);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), "every carrier line stays parsable");
      const event = JSON.parse(line);
      assert.ok(["entry", "settle", "remove"].includes(event.kind), "每一行都须是合法事件类型");
    }
  });
});

// ---------------------------------------------------------------------------
// 保留期：§12bis「pending 自 at 起 30 天」「终态自状态变更起 90 天」
// ---------------------------------------------------------------------------

test("retention: a pending entry survives 29 days and is evicted at 31 days (§12bis 保留期第 2 项)", async () => {
  await withHome(async (home) => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const young = await appendBufferEntry(home, validEntry({ at: "2026-05-03T00:00:00.000Z" }));
    assert.ok(young.ok, JSON.stringify(young.error));

    const kept = await readBufferEntries(home, { now });
    assert.equal(kept.value.items[0].status, "pending", "29 days old is still pending");
    assert.equal(kept.value.by_status.pending, 1);

    const old = await appendBufferEntry(home, validEntry({ at: "2026-05-01T00:00:00.000Z" }));
    assert.ok(old.ok, JSON.stringify(old.error));

    const evicted = await readBufferEntries(home, { now });
    assert.equal(evicted.value.by_status.evicted, 1, "31 days old is evicted");
    assert.equal(evicted.value.by_status.pending, 1);
    const record = evicted.value.items.find((item) => item.id === old.value.entry_id);
    assert.equal(record.status, "evicted");
    assert.ok(record[BUFFER_SETTLED_AT_FIELD], "the eviction is stamped for the settled retention");

    // 惰性结算必须落盘——再次读仍是 evicted。
    const again = await readBufferEntries(home, { now });
    assert.equal(again.value.by_status.evicted, 1);
    const raw = await readFile(bufferEntryPath(home), "utf8");
    const persisted = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((item) => item.id === old.value.entry_id);
    assert.equal(persisted.status, "evicted", "the lazy settlement is persisted");
  });
});

test("retention: exactly 30 days is not yet evicted (§12bis：30 天未被审核即转 evicted)", async () => {
  await withHome(async (home) => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    await appendBufferEntry(home, validEntry({ at: "2026-05-02T00:00:00.000Z" }));
    const result = await readBufferEntries(home, { now });
    assert.equal(result.value.by_status.pending, 1, "the boundary day is still pending");
    assert.equal(result.value.by_status.evicted, 0);
  });
});

test("retention: a terminal entry survives 89 days and is removed at 91 days (§12bis 保留期第 2 项)", async () => {
  await withHome(async (home) => {
    const settledAt = daysAgo(89);
    const appended = await appendBufferEntry(home, validEntry({ at: settledAt }));
    assert.ok(appended.ok, JSON.stringify(appended.error));
    const settled = await settleBufferEntry(home, appended.value.entry_id, {
      status: "discarded",
      now: new Date(settledAt),
    });
    assert.ok(settled.ok, JSON.stringify(settled.error));

    const kept = await readBufferEntries(home, { now: new Date() });
    assert.equal(kept.value.total, 1, "89 days old is still kept");
    assert.equal(kept.value.by_status.discarded, 1);

    const old = await appendBufferEntry(home, validEntry({ at: daysAgo(91) }));
    assert.ok(old.ok, JSON.stringify(old.error));
    const oldSettled = await settleBufferEntry(home, old.value.entry_id, {
      status: "discarded",
      now: new Date(daysAgo(91)),
    });
    assert.ok(oldSettled.ok, JSON.stringify(oldSettled.error));

    const removed = await readBufferEntries(home, { now: new Date() });
    assert.equal(removed.value.total, 1, "the 91-day-old terminal entry is removed entirely");
    assert.equal(removed.value.by_status.discarded, 1);
    assert.ok(
      !removed.value.items.some((item) => item.id === old.value.entry_id),
      "the expired terminal entry is gone, not merely marked",
    );
  });
});

// ---------------------------------------------------------------------------
// 结算：§12bis 状态闭集与 consumed_by 语义（§12ter review）
// ---------------------------------------------------------------------------

test("settle: rejects a status outside the closed set (§12bis：status 闭集)", async () => {
  await withHome(async (home) => {
    const appended = await appendBufferEntry(home, validEntry());
    assert.ok(appended.ok, JSON.stringify(appended.error));
    const result = await settleBufferEntry(home, appended.value.entry_id, { status: "archived" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/invalid_status");
  });
});

test("settle: reports an unknown entry id (§12bis：目标不存在)", async () => {
  await withHome(async (home) => {
    const result = await settleBufferEntry(home, "no-such-id", { status: "discarded" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/entry_not_found");
  });
});

test("settle: refuses to settle an entry twice (§12bis：已结算即不再改写)", async () => {
  await withHome(async (home) => {
    const appended = await appendBufferEntry(home, validEntry());
    assert.ok(appended.ok, JSON.stringify(appended.error));
    const first = await settleBufferEntry(home, appended.value.entry_id, { status: "discarded" });
    assert.ok(first.ok, JSON.stringify(first.error));
    const second = await settleBufferEntry(home, appended.value.entry_id, { status: "discarded" });
    assert.equal(second.ok, false);
    assert.equal(second.error.code, "observation_buffer/already_settled");
  });
});

test("settle: consumed requires a non-empty consumed_by, other states require it to be empty (§12bis)", async () => {
  await withHome(async (home) => {
    const appended = await appendBufferEntry(home, validEntry());
    assert.ok(appended.ok, JSON.stringify(appended.error));

    const missing = await settleBufferEntry(home, appended.value.entry_id, { status: "consumed" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "observation_buffer/invalid_consumed_by");

    const notConsumed = await settleBufferEntry(home, appended.value.entry_id, {
      status: "discarded",
      consumedBy: "draft-object-uid-1",
    });
    assert.equal(notConsumed.ok, false);
    assert.equal(notConsumed.error.code, "observation_buffer/invalid_consumed_by");
  });
});

test("settle: writes status, consumed_by and settled_at, and preserves the rest verbatim (§12bis)", async () => {
  await withHome(async (home) => {
    const entry = validEntry({ at: "2026-03-01T10:00:00.000Z" });
    const appended = await appendBufferEntry(home, entry);
    assert.ok(appended.ok, JSON.stringify(appended.error));

    const result = await settleBufferEntry(home, appended.value.entry_id, {
      status: "consumed",
      consumedBy: "  draft-object-uid-1  ",
    });
    assert.ok(result.ok, JSON.stringify(result.error));

    // 追加事件日志形态：结算写的是**一条 settle 事件**，不是改写第一行。
    // 故从**折叠后的视图**断言当前状态（这正是读者看到的东西）。
    const raw = await readFile(bufferEntryPath(home), "utf8");
    const events = raw.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.length, 2, "一次追加 + 一次结算 = 两条事件");
    assert.equal(events[0].kind, "entry");
    assert.equal(events[1].kind, "settle");
    assert.equal(events[1].status, "consumed");
    assert.equal(events[1].consumed_by, "draft-object-uid-1");

    const view = await readBufferEntries(home);
    const parsed = view.value.items[0];
    assert.equal(parsed.status, "consumed");
    assert.equal(parsed.consumed_by, "draft-object-uid-1");
    assert.match(parsed[BUFFER_SETTLED_AT_FIELD], /^\d{4}-\d{2}-\d{2}T/, "settled_at is RFC3339");
    // 语义字段逐字保留——结算只改状态与来源指针。
    assert.equal(parsed.phenomenon, entry.phenomenon);
    assert.equal(parsed.evidence, entry.evidence);
    assert.equal(parsed.candidate_question, entry.candidate_question);
    assert.equal(parsed.session, entry.session);
    assert.equal(parsed.anchor, entry.anchor);
    assert.equal(parsed.at, entry.at);
  });
});

test("settle: a broken line in the carrier is preserved, not swallowed (§12bis 载体完整性)", async () => {
  await withHome(async (home) => {
    const appended = await appendBufferEntry(home, validEntry());
    assert.ok(appended.ok, JSON.stringify(appended.error));
    const raw = await readFile(bufferEntryPath(home), "utf8");
    await writeFile(bufferEntryPath(home), `${raw}{ broken line\n`, "utf8");

    const result = await settleBufferEntry(home, appended.value.entry_id, { status: "discarded" });
    assert.ok(result.ok, JSON.stringify(result.error));
    const after = await readFile(bufferEntryPath(home), "utf8");
    assert.ok(after.includes("{ broken line"), "the broken line survives the rewrite");
  });
});

// ---------------------------------------------------------------------------
// 规范常量：§12bis 保留期数值
// ---------------------------------------------------------------------------

test("spec: the retention constants carry the §12bis values", () => {
  assert.equal(BUFFER_PENDING_TTL_DAYS, 30);
  assert.equal(BUFFER_SETTLED_TTL_DAYS, 90);
  assert.deepEqual([...BUFFER_STATUSES], ["pending", "consumed", "discarded", "evicted"]);
  assert.equal(BUFFER_REQUIRED_FIELDS.length, 9, "§12bis 字段闭集为 9 项");
});
