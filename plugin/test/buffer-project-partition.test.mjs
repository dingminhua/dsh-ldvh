// 经验留观缓冲的**按项目分区**（11 §12bis 载体段，2026-10 修订，Human 决定）。
//
// ## 规范依据（不是我的偏好）
//
// §12bis 载体段原文：
//
// > **按管辖项目分载体（2026-10 修订，Human 决定）**：缓冲条目属**哪个项目**必须可
// > 机械区分——载体须按管辖项目分文件（或等价的分区），**不得使多个管辖项目的观察
// > 材料混在同一个无项目维度的载体里**。理由：留观材料的消费方（审核段）须在**该
// > 项目自己的**事实源上成文，混装会使一个项目的观察被写成另一个项目的候选；且容量
// > 上限按项目独立计算，混装使一个项目的积压挤掉另一个项目的容量。
// > **诊断记号**：本项目此前的实现把两个项目的材料混在一个全局载体里（实测 47 条中
// > 混有他项目材料，并已入账为 friction `11f4eb8f`），属**已知缺陷**，本次修订一并纠正。
//
// ## 本文件守的三条
//
//   ① 两个项目写到**不同**载体，互相读不到；
//   ② 生产调用点**不得**省略 `projectId`（源码级断言——「形参存在但忘了传」是本仓库
//      反复登记的失效形态，靠自觉防不住）；
//   ③ 缺 `projectId` 时各入口**明确拒绝**，而不是静默落到旧全局载体。
//
// ## 一处与摩擦侧（§12bis.1）的**关键差异**，别抄错
//
// 摩擦条目**自带 `project` 字段**（闭集 10 项），经验条目**没有**（闭集 9 项）。
// 所以经验侧的项目区分**只由载体路径承担**——这正是 §12bis「或等价的分区」允许的形态。
// 若照摩擦侧给经验条目加 `project` 字段，就是**越出 §12bis 的字段闭集**
// （「超出即越界，按 §20.1 第 3 项处理」）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendBufferEntry,
  readBufferEntries,
  settleBufferEntry,
  bufferEntryPath,
  bufferRelativePath,
  BUFFER_RELATIVE_PATH,
  BUFFER_PROJECT_DIR,
} from "../lib/observation-buffer.js";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

const PROJECT_A = "project-alpha";
const PROJECT_B = "project-beta";

async function withHome(fn) {
  const base = await mkdtemp(join(tmpdir(), "buffer-partition-"));
  const home = (...segments) => join(base, ...segments);
  home.base = base;
  await fn(home);
}

function entry(overrides = {}) {
  return {
    session: "session-aaaa",
    anchor: "turn 1..2",
    phenomenon: "插件以只读身份写配置失败。",
    evidence: "EACCES: permission denied\n来源：session-aaaa turn 1",
    candidate_question: "这是什么机制？",
    at: "2026-10-26T00:00:00.000Z",
    ...overrides,
  };
}

// ── ① 两个项目互不可见 ──────────────────────────────────────────────────────

test("两个项目的条目落在不同载体，且互相读不到", async () => {
  await withHome(async (home) => {
    const pathA = bufferEntryPath(home, PROJECT_A);
    const pathB = bufferEntryPath(home, PROJECT_B);
    assert.notEqual(pathA, pathB, "两个项目必须落到不同文件——否则分区不存在");

    const a = await appendBufferEntry(home, entry({ phenomenon: "甲项目的现象。" }), { projectId: PROJECT_A });
    const b = await appendBufferEntry(home, entry({ phenomenon: "乙项目的现象。" }), { projectId: PROJECT_B });
    assert.equal(a.ok, true, JSON.stringify(a.error));
    assert.equal(b.ok, true, JSON.stringify(b.error));

    const readA = await readBufferEntries(home, { projectId: PROJECT_A });
    const readB = await readBufferEntries(home, { projectId: PROJECT_B });
    assert.equal(readA.ok, true);
    assert.equal(readB.ok, true);
    assert.equal(readA.value.total, 1, "甲只应看到自己那一条");
    assert.equal(readB.value.total, 1, "乙只应看到自己那一条");
    assert.equal(readA.value.items[0].phenomenon, "甲项目的现象。");
    assert.equal(readB.value.items[0].phenomenon, "乙项目的现象。");
  });
});

test("容量按项目独立计算：一个项目的积压不得挤掉另一个项目的条目", async () => {
  // §12bis 载体段的理由段明写：「容量上限按项目独立计算，混装使一个项目的积压挤掉
  // 另一个项目的容量」。这里用两个项目各写 2 条、容量各 2 验证——若容量是全局的，
  // 后写的项目会把先写的挤掉。
  await withHome(async (home) => {
    for (const project of [PROJECT_A, PROJECT_B]) {
      for (let i = 0; i < 2; i += 1) {
        const r = await appendBufferEntry(home, entry({ at: `2026-10-26T00:0${i}:00.000Z` }), {
          projectId: project,
          capacity: 2,
        });
        assert.equal(r.ok, true, JSON.stringify(r.error));
      }
    }
    const readA = await readBufferEntries(home, { projectId: PROJECT_A });
    const readB = await readBufferEntries(home, { projectId: PROJECT_B });
    assert.equal(readA.value.total, 2, "甲的两条须完整保留（容量按项目独立）");
    assert.equal(readB.value.total, 2, "乙的两条须完整保留");
  });
});

test("分区后的载体仍在事实源之外，且与摩擦缓冲的目录不同（两类载体不得混装）", async () => {
  await withHome(async (home) => {
    const path = bufferEntryPath(home, PROJECT_A);
    assert.ok(path.startsWith(home.base), "必须落在 DSH home 下");
    assert.ok(!path.includes("ldvh-base"), "缓冲是中间产物，不在事实源内（02 §6.1）");
    assert.ok(!path.includes("pending-queue"), "不得与待处置队列合并载体（§12bis 纪律 5）");
    // 02 §6.1 第 2 条：每个中间载体须有**唯一**消费者，故不得与摩擦缓冲同目录同文件。
    assert.ok(
      !path.includes("friction-observations"),
      "经验缓冲不得落在摩擦缓冲目录——§12bis 与 §12bis.1 是两类载体，各须唯一消费者",
    );
    assert.ok(path.includes("experience-buffers"), "经验侧用独立目录");
  });
});

test("相对路径回指与绝对路径同源（交付面不得手抄一份）", async () => {
  await withHome(async (home) => {
    for (const project of [PROJECT_A, PROJECT_B]) {
      const rel = bufferRelativePath(project);
      assert.equal(join(home.base, ...rel), bufferEntryPath(home, project), `相对与绝对须同源：${project}`);
    }
    assert.deepEqual([...bufferRelativePath(undefined)], [...BUFFER_RELATIVE_PATH], "省略时回指旧全局载体");
    assert.deepEqual([...BUFFER_PROJECT_DIR], ["ldvh", "experience-buffers"]);
  });
});

test("条目**不带** project 字段——经验侧的字段闭集是 9 项（不得照抄摩擦侧）", async () => {
  await withHome(async (home) => {
    const appended = await appendBufferEntry(home, entry(), { projectId: PROJECT_A });
    assert.equal(appended.ok, true, JSON.stringify(appended.error));
    const read = await readBufferEntries(home, { projectId: PROJECT_A });
    const item = read.value.items[0];
    // §12bis 字段闭集：id/at/session/anchor/phenomenon/evidence/candidate_question/status/consumed_by
    assert.equal("project" in item, false, "经验条目不得带 project —— §12bis 闭集 9 项，超出即越界（§20.1 第 3 项）");
    // 项目归属由**载体路径**承担即可满足「可机械区分」。
    assert.ok(bufferEntryPath(home, PROJECT_A).includes(PROJECT_A));
  });
});

test("旧全局载体保持可指认——存量数据不擅自迁移", async () => {
  await withHome(async (home) => {
    const legacy = bufferEntryPath(home);
    assert.equal(legacy, join(home.base, "ldvh", "observation-buffer.jsonl"));
    // 分区后写入的新条目**不得**落进旧载体。
    const projectPath = bufferEntryPath(home, PROJECT_A);
    assert.notEqual(projectPath, legacy, "新写入走项目分区，不得继续用旧全局载体");
  });
});

// ── ② 非法项目 id 被拒绝（路径注入）──────────────────────────────────────

test("非法 projectId 被拒绝——它要变成文件名，不得允许路径分隔符", async () => {
  await withHome(async (home) => {
    // 注意 `""` **不在此列**：空串的语义是「未传」，走旧全局载体（向后兼容），
    // 并不构成路径注入风险。真正的注入风险来自含分隔符或相对段的非空值。
    for (const bad of ["../evil", "a/b", ".", "..", "a\\b", "a b"]) {
      assert.throws(
        () => bufferEntryPath(home, bad),
        (error) => String(error.message).includes("invalid_project"),
        `非法 projectId ${JSON.stringify(bad)} 必须在拼路径时被拒绝`,
      );
    }
    // 空串 = 未传：落到旧全局载体，不抛（这是有意的兼容语义）。
    assert.equal(bufferEntryPath(home, ""), join(home.base, "ldvh", "observation-buffer.jsonl"));
    // 合法的应通过。
    for (const good of ["dsh-ldvh", "a.b_c-d", "P1"]) {
      assert.ok(bufferEntryPath(home, good).endsWith(`${good}.jsonl`), `${good} 应合法`);
    }
  });
});

// ── ③ 生产调用点不得省略 projectId（源码级护栏）──────────────────────────

/**
 * 取出每个缓冲 API 调用的实参文本。
 *
 * **不能简单截到下一个 `);`**：像 `bufferRelativePath(id).join("/")` 这种写法，
 * `(` 之后紧跟 `)`，`);` 出现在**链式调用**之后而不是实参结束时，截出来的窗口只包含
 * `bufferRelativePath(governed.project.id)` 的一部分——实测会漏看实参、误报「未传
 * projectId」。正确做法是**按括号配对**找到与该 `(` 匹配的 `)`。
 */
function bufferCallSites(source) {
  const sites = [];
  const pattern = /\b(appendBufferEntry|readBufferEntries|settleBufferEntry|bufferEntryPath|bufferRelativePath)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const openIndex = match.index + match[0].length - 1;
    let depth = 0;
    let closeIndex = -1;
    for (let i = openIndex; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) { closeIndex = i; break; }
      }
    }
    const text = closeIndex > openIndex ? source.slice(match.index, closeIndex + 1) : source.slice(match.index, match.index + 400);
    sites.push({ api: match[1], text });
  }
  return sites;
}

/**
 * 这个调用是否**确实指明了项目**？
 *
 * 判据不能只认字面量 `projectId`（我第一版就是这么写的，结果误报了 4 处真实正确的
 * 调用）。`ldvh-tools.js` 里传的是 `governed.project.id`——语义完全正确，只是拼写
 * 不同。护栏若只认一个拼写，就会把「正确」判成「错误」，然后被当成噪音忽略掉，
 * 那比没有护栏更糟。
 *
 * 故判据是「实参里出现任一**项目标识来源**」：`projectId` / `project.id` /
 * `scope.project` / `governed.project`。这些是本仓库取项目标识的全部既有写法。
 */
function passesProject(text) {
  return /\bprojectId\b/.test(text)
    || /\bproject\.id\b/.test(text)
    || /\b(scope|governed|project)\b\s*\.\s*project\b/.test(text);
}

test("生产调用点一律传 projectId——省略即退回全局载体，分区形同虚设", async () => {
  const offenders = [];
  const files = (await readdir(LIB)).filter((name) => name.endsWith(".js"));
  for (const name of files) {
    if (name === "observation-buffer.js") continue; // 载体模块自身即被调用方
    const source = await readFile(join(LIB, name), "utf8");
    for (const site of bufferCallSites(source)) {
      if (!passesProject(site.text)) {
        offenders.push(`${name}: ${site.api}(…) 未传项目标识 — ${site.text.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `11 §12bis 载体段（2026-10 修订）：下列调用点未传 projectId，会读写所有项目共用的旧载体——\n${offenders.join("\n")}`,
  );
});

test("新增缓冲调用点无法绕过护栏：护栏确实能识别漏传（元测试）", () => {
  const missing = bufferCallSites('const x = await readBufferEntries(dshHomePath, { status: "pending" });');
  assert.equal(missing.length, 1);
  assert.ok(!missing[0].text.includes("projectId"), "该样本确实没传");

  const present = bufferCallSites('const y = await appendBufferEntry(dshHomePath, e, { projectId });');
  assert.equal(present.length, 1);
  assert.ok(present[0].text.includes("projectId"), "该样本确实传了");
});

// ── ④ 缺 projectId 时各入口拒绝 ──────────────────────────────────────────

test("缺 projectId 时捕获落地拒绝（不得落进所有项目共用的旧载体）", async () => {
  const { landCaptureVerdict } = await import("../lib/experience-landing.js");
  const { validateCaptureVerdict } = await import("../lib/experience-capture-contract.js");
  await withHome(async (home) => {
    const windowText = "EACCES: permission denied, open '/tmp/ldvh/config.json'";
    const verdict = validateCaptureVerdict({
      verdict: "failure-observed",
      phenomenon: "插件以只读身份写配置失败。",
      evidence: windowText,
      source: "session-aaaa turn 1",
      candidate_question: "这是什么机制？",
      quote: windowText,
      reason: "材料中出现失败现象。",
    }, { windowText });
    assert.equal(verdict.ok, true, JSON.stringify(verdict.error));

    const result = await landCaptureVerdict({
      dshHomePath: home,
      verdict: verdict.value,
      sessionId: "session-aaaa",
      anchor: "turn 1..2",
      observationAt: "2026-10-26T00:00:00.000Z",
      // projectId 刻意不给
    });
    assert.equal(result.ok, false, "缺 projectId 必须拒绝，而不是静默用全局载体");
    assert.equal(result.error.code, "capture/project_missing");
  });
});

test("缺 projectId 时审核段拒绝（不得读到别的项目的材料）", async () => {
  const { reviewPendingEntries } = await import("../lib/observation-review.js");
  await withHome(async (home) => {
    const result = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot: "/fixture/facts",
      existingPitfalls: [],
      proposals: [],
      sessionSignature: { provider: "p", model: "m" },
      // projectId 刻意不给
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_review/project_missing");
  });
});

// ── ⑤ 并发安全（2026-10-26 追加事件日志形态的**存在理由**）──────────────────

/**
 * 这一组测试是本模块形态改动的**全部理由**，故必须常驻。
 *
 * ## 改动前实测（原「一行一条完整记录 + 读-改-写」）
 *
 * ```
 * 场景A 并发 append 40 条 → 读出 40 条  ✅ 无丢失
 * 场景B 并发 settle 20 条 → 仍有 19 条没被结算 ❌ 丢失更新 19 条
 * ```
 *
 * 原因：`settle` 走「读全文 → 改目标行 → 临时文件 + rename」。两个会话同时结算
 * **不同**条目时，各自读到同一份旧内容、各自写出一份「只有自己那条被改」的新文件，
 * 后一个 `rename` 整个覆盖前一个。
 *
 * ## 改动后
 *
 * 所有写都是追加；`settle` 写成一条 `settle` 事件，由读侧折叠出状态。并发不再互相
 * 覆盖——因为物理上**没有任何代码路径去改别人那一条**。
 *
 * ## 为什么必须在测试里守着
 *
 * 这是**非功能性质**（正确性在并发下保持），单线程顺序测试永远发现不了它。若不守着，
 * 将来任何一次「读-改-写更方便」的重构都会把这个缺陷悄悄带回来，而所有顺序测试仍绿。
 */

test("并发 append：40 条同时写入，一条都不丢（O_APPEND 语义）", async () => {
  await withHome(async (home) => {
    const N = 40;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendBufferEntry(home, entry({ anchor: `turn-${i}`, at: new Date(Date.now() + i).toISOString() }), {
          projectId: PROJECT_A,
        }),
      ),
    );
    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result.error));

    const read = await readBufferEntries(home, { projectId: PROJECT_A });
    assert.equal(read.value.total, N, `40 条并发行写入必须全部可读（实测基线：这一点在旧形态下也是对的）`);
    // id 必须互不相同——若随机 id 碰撞，说明生成方式有问题。
    assert.equal(new Set(read.value.items.map((x) => x.id)).size, N);
  });
});

test("并发 settle：20 条同时结算，**不能丢更新**（旧形态在此丢 19/20）", async () => {
  await withHome(async (home) => {
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendBufferEntry(home, entry({ anchor: `turn-${i}`, at: new Date(Date.now() + i).toISOString() }), {
          projectId: PROJECT_A,
        }),
      ),
    );
    const before = await readBufferEntries(home, { projectId: PROJECT_A });
    const ids = before.value.items.map((x) => x.id);
    assert.equal(ids.length, N);

    await Promise.all(
      ids.map((id) => settleBufferEntry(home, id, { status: "discarded", projectId: PROJECT_A })),
    );

    const after = await readBufferEntries(home, { projectId: PROJECT_A });
    const stillPending = after.value.items.filter((x) => x.status === "pending");
    assert.deepEqual(
      stillPending.map((x) => x.id),
      [],
      `并发结算后不得有残留 pending——旧形态实测 20 条里丢了 19 次更新（这是本模块改成追加事件日志的直接原因）`,
    );
    assert.equal(after.value.total, N, "结算不改变条目总数");
  });
});

test("并发混合写：append + settle 同时打，状态与总数都正确", async () => {
  await withHome(async (home) => {
    // 先铺 30 条。
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        appendBufferEntry(home, entry({ anchor: `seed-${i}`, at: new Date(Date.now() + i).toISOString() }), {
          projectId: PROJECT_A,
        }),
      ),
    );
    const seeded = await readBufferEntries(home, { projectId: PROJECT_A });
    const ids = seeded.value.items.map((x) => x.id);

    // 同时：10 条 consumed、10 条 discarded、20 条新追加。
    const ops = [
      ...ids.slice(0, 10).map((id, i) =>
        settleBufferEntry(home, id, { status: "consumed", consumedBy: `uid-${i}`, projectId: PROJECT_A })),
      ...ids.slice(10, 20).map((id) =>
        settleBufferEntry(home, id, { status: "discarded", projectId: PROJECT_A })),
      ...Array.from({ length: 20 }, (_, i) =>
        appendBufferEntry(home, entry({ anchor: `late-${i}`, at: new Date(Date.now() + 100 + i).toISOString() }), {
          projectId: PROJECT_A,
        })),
    ];
    const results = await Promise.all(ops);
    const failures = results.filter((r) => !r.ok);
    assert.deepEqual(failures.map((r) => r.error.code), [], "并发混合写不应产生任何失败");

    const after = await readBufferEntries(home, { projectId: PROJECT_A });
    assert.equal(after.value.total, 50, "30 条既有 + 20 条新追加");
    assert.equal(after.value.by_status.consumed, 10);
    assert.equal(after.value.by_status.discarded, 10);
    assert.equal(after.value.by_status.pending, 30, "10 条被 consumed + 10 条 discarded 后，30 条 pending 应原样保留");
    assert.equal(after.value.invalid.length, 0, "折叠不得产生任何 invalid 事件");
  });
});

test("重复结算同一条目是**幂等**的（并发读者各写一次很常见，不得判失败或产生分歧）", async () => {
  await withHome(async (home) => {
    const appended = await appendBufferEntry(home, entry(), { projectId: PROJECT_A });
    const id = appended.value.entry_id;

    const first = await settleBufferEntry(home, id, { status: "discarded", projectId: PROJECT_A });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    // 第二次：状态已终态 → 明确拒绝（不静默成功，也不损坏载体）。
    const second = await settleBufferEntry(home, id, { status: "discarded", projectId: PROJECT_A });
    assert.equal(second.ok, false);
    assert.equal(second.error.code, "observation_buffer/already_settled");

    // 载体仍可读，折叠后也只有一条。
    const read = await readBufferEntries(home, { projectId: PROJECT_A });
    assert.equal(read.value.total, 1);
    assert.equal(read.value.items[0].status, "discarded");
    assert.equal(read.value.invalid.length, 0, "重复结算事件不得被折叠层判为非法（它是幂等的同状态事件）");
  });
});
