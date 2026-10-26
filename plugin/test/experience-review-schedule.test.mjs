// 经验审核的**周期调度与专属会话**（11 §6.1 形态 2，2026-10-26）。
//
// ## 本文件守什么
//
// §6.1 形态 2 的规范原文（本次修订）：
//
// > **承载**：由宿主自动化任务的周期调度承载；该形态**须**绑定一个所服务的会话作为
// > 投递落点。**落点解析顺序**：先按**固定标题**查找已存在的专属会话，找到则复用之；
// > 找不到则**创建一个固定标题的专属会话**并以其为落点。**该创建须发生在该形态所服务
// > 的管辖项目之内**——不得跨项目创建，且一个管辖项目至多一个专属会话。
// > **不得并发开两个审核回合**。
//
// 于是要守四件事 + 一个反面：
//
//   ① 找不到专属会话 → 创建，且 **cwd 是该项目根**（「只在本项目内」的机械保证）；
//   ② 找得到 → 复用，**不重复创建**；
//   ③ 标题必须能设上——设不上就**找不到**，下次会再建一个（须报错而非静默）；
//   ④ 周期任务：`every_seconds` 规则、原地改间隔、不重复创建；
//   ⑤ （反面）判不了「落点是否在跑」时**不放行**——宁可跳过，不冒并发。
//
// ## 一处易错的细节，专门守
//
// 标题**不在** `SessionSummary` 顶层，而在 `projections.values.title`。用错位置就会
// 永远找不到、然后每次都不停地新建——表面「正常」，实际每轮都多一个会话。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REVIEW_SCHEDULE_TAG,
  armReviewAutomation,
  ensureReviewSchedule,
  ensureReviewSession,
  findReviewSession,
  isReviewSessionBusy,
  removeReviewSchedule,
  reviewSessionTitle,
} from "../lib/experience-review-schedule.js";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const PROJECT_ID = "fixture-project";
const WORKSPACE_PATHS = { "ws-fixture": "/Users/dev/projects/fixture" };
const PROJECT_ROOT = "/Users/dev/projects/fixture";

/** 假宿主：schedule + sessionController。 */
function fakeHost() {
  const sessions = [];
  const schedules = [];
  let seq = 0;
  const schedule = {
    list: async () => schedules.map((row) => ({ ...row })),
    create: async (sessionId, request) => {
      const record = {
        id: `sched-${++seq}`,
        sessionId,
        kind: request.every_seconds !== undefined ? "every" : "at",
        title: request.title,
        prompt: request.prompt,
        everySeconds: request.every_seconds,
      };
      schedules.push(record);
      return record;
    },
    update: async ({ id, change }) => {
      const row = schedules.find((item) => item.id === id);
      if (row === undefined) return { updated: false, code: "schedule_not_found" };
      row.everySeconds = change.every_seconds;
      return { updated: true, id };
    },
    delete: async ({ id }) => {
      const index = schedules.findIndex((item) => item.id === id);
      if (index < 0) return { deleted: false };
      schedules.splice(index, 1);
      return { deleted: true };
    },
  };
  const sessionController = {
    list: async () => ({ items: sessions.map((row) => ({ ...row })) }),
    create: async (request) => {
      // **模拟真实宿主的两条契约**：
      //   ① `cwd` 与 `workspaceId` **互斥**——同时传直接抛（实测报错原文
      //      "session.create accepts workspaceId or cwd, not both"）；
      //   ② 只给 `workspaceId` 时，会话的 `cwd` 由该 workspace 绑定目录推出。
      //      夹具若只照抄 `request.cwd`，就会把「给 workspaceId 的正确调用」记成
      //      cwd 缺失，从而把正确实现判成错的。
      if (request.cwd !== undefined && request.workspaceId !== undefined && request.workspaceId !== null) {
        throw new Error("session.create accepts workspaceId or cwd, not both");
      }
      const sessionId = `session-${++seq}`;
      createdRequests.push({ ...request });
      sessions.push({
        sessionId,
        cwd: request.workspaceId !== undefined && request.workspaceId !== null
          ? (WORKSPACE_PATHS[request.workspaceId] ?? null)
          : request.cwd,
        workspaceId: request.workspaceId ?? null,
        running: false,
        projections: { values: { title: null } },
      });
      return { sessionId };
    },
    rename: async ({ sessionId, title }) => {
      const row = sessions.find((item) => item.sessionId === sessionId);
      if (row === undefined) throw new Error("session_not_found");
      row.projections.values.title = title;
      return { title, seq: 1 };
    },
  };
  // workspaceRegistry：侧边栏分组的来源。测试里预置一个已存在的 workspace，
  // 使「解析得到的 workspaceId」可断言（而不是恒为 null 而看不出问题）。
  const workspaces = [{ id: "ws-fixture", path: PROJECT_ROOT, title: "fixture" }];
  const createdRequests = [];
  const workspaceRegistry = {
    resolveByPath: async (path) => workspaces.find((w) => w.path === path),
    create: async (path) => {
      const made = { id: `ws-${path.replaceAll("/", "-")}`, path, title: path.split("/").at(-1) };
      workspaces.push(made);
      return made;
    },
  };
  const ctx = {
    get: (name) => {
      if (name === "schedule") return schedule;
      if (name === "sessionController") return sessionController;
      if (name === "workspaceRegistry") return workspaceRegistry;
      return undefined;
    },
  };
  return { ctx, sessions, schedules, workspaces, createdRequests };
}

// ── ① 找不到就创建，且落在项目根 ──────────────────────────────────────────

test("没有专属会话时创建，且 cwd 是该管辖项目根（「只在本项目内创建」的机械保证）", async () => {
  const { ctx, sessions } = fakeHost();
  const result = await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });

  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.created, true);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].cwd, PROJECT_ROOT, "会话必须落在该项目根（不得跨项目）");
  assert.equal(
    sessions[0].projections.values.title,
    reviewSessionTitle(PROJECT_ID),
    "标题必须是固定标题，否则下次找不到",
  );
});

test("**cwd 与 workspaceId 互斥**：能解析到 workspace 时只传 workspaceId", async () => {
  // 实测报错原文（2026-10-27）："session.create accepts workspaceId or cwd, not both"
  //
  // 我第一版两个都传，以为「双保险」更稳——宿主直接拒绝，于是每次建会话都失败，
  // 而失败点排在「协调是否跑起来」之后，前四轮排查都没看到它。
  //
  // 为什么给 workspaceId 就不必给 cwd：workspace 本身绑定一个目录。两者**不是**
  // 「目录 + 分组」，而是「分组」或「裸目录」二选一。
  const { ctx, createdRequests } = fakeHost();
  const result = await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });

  assert.equal(result.ok, true, JSON.stringify(result.error));
  const sent = createdRequests[0];
  assert.ok(sent.workspaceId !== undefined && sent.workspaceId !== null, "须传 workspaceId（它决定目录与分组）");
  assert.equal(sent.cwd, undefined, "**不得同时传 cwd**——宿主会直接拒绝创建");
});

test("**专属会话须归入该项目的 workspace，而不是「未分组」**", async () => {
  const { ctx, createdRequests } = fakeHost();
  const result = await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });

  assert.equal(result.ok, true, JSON.stringify(result.error));
  const sent = createdRequests[0];
  assert.equal(
    sent.workspaceId,
    "ws-fixture",
    "**必须传 workspaceId**——只传 cwd 会让会话出现在「未分组」（Human 从截图实测发现）",
  );
  assert.equal(sent.cwd, undefined, "不得同时传 cwd（宿主拒绝两者并存）");
});

test("项目根没有对应 workspace 时：为它建一个，仍然归好组", async () => {
  const { ctx, createdRequests, workspaces } = fakeHost();
  const otherRoot = "/Users/dev/projects/other";
  const result = await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: otherRoot });

  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.ok(createdRequests[0].workspaceId !== null && createdRequests[0].workspaceId !== undefined, "须解析出 workspaceId");
  assert.ok(
    workspaces.some((w) => w.path === otherRoot),
    "没有现成 workspace 时应为该项目根建一个",
  );
});

test("workspace 服务未装配时仍能建会话（只退化为可能未分组，不失败）", async () => {
  const { ctx, sessions } = fakeHost();
  const noWs = {
    get: (name) => {
      if (name === "workspaceRegistry") return undefined;
      return ctx.get(name);
    },
  };
  const result = await ensureReviewSession(noWs, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });
  assert.equal(result.ok, true, "不该因为拿不到分组就整个失败");
  assert.equal(sessions.length, 1, "会话仍应建出来");
});

test("已有同标题会话时复用，不重复创建", async () => {
  const { ctx, sessions } = fakeHost();
  await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });
  const second = await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: "/elsewhere" });

  assert.equal(second.ok, true);
  assert.equal(second.created, false, "第二次必须复用");
  assert.equal(sessions.length, 1, "不得创建第二个会话");
  assert.equal(sessions[0].cwd, PROJECT_ROOT, "复用时不改它的落点");
});

test("按固定标题查找：标题在 projections.values.title，不在 summary 顶层", async () => {
  const { ctx, sessions } = fakeHost();
  // 手工造两条：一条标题在投影里（正确位置），一条只有顶层 title（错误位置）。
  sessions.push({ sessionId: "s-proj", cwd: PROJECT_ROOT, projections: { values: { title: reviewSessionTitle(PROJECT_ID) } } });
  sessions.push({ sessionId: "s-top", cwd: PROJECT_ROOT, title: reviewSessionTitle(PROJECT_ID) });

  const found = await findReviewSession(ctx, { projectId: PROJECT_ID });
  assert.equal(found.ok, true);
  assert.equal(found.sessionId, "s-proj", "必须从 projections.values.title 读——读顶层会永远找不到并不断新建");
  assert.equal(found.candidates, 1, "顶层那条不算命中");
});

test("标题设不上时报错（否则下次找不到、会再建一个）", async () => {
  const { ctx } = fakeHost();
  const broken = {
    get: (name) => {
      if (name !== "sessionController") return undefined;
      return {
        list: async () => ({ items: [] }),
        create: async () => ({ sessionId: "s-1" }),
        rename: async () => {
          throw new Error("rename_not_supported");
        },
      };
    },
  };
  const result = await ensureReviewSession(broken, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "review_session/title_not_set");
  assert.match(result.error.message, /will create another/, "须说清后果：下次会再造一个");
  assert.ok(ctx); // 占位，避免 lint 抱怨未使用
});

// ── ④ 周期任务 ───────────────────────────────────────────────────────────

test("周期任务用 every_seconds 规则，且标签可与安静期区分", async () => {
  const { ctx, schedules } = fakeHost();
  const armed = await ensureReviewSchedule(ctx, {
    projectId: PROJECT_ID,
    sessionId: "s-1",
    intervalMs: 3_600_000,
  });
  assert.equal(armed.ok, true, JSON.stringify(armed.error));
  assert.equal(armed.everySeconds, 3600);
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].kind, "every", "必须是周期规则，不是一次性 at");
  assert.ok(schedules[0].prompt.startsWith(`[${REVIEW_SCHEDULE_TAG}]`), "须带本插件标签以便查重");
});

test("间隔变化时原地更新，不删后重建（不重复创建）", async () => {
  const { ctx, schedules } = fakeHost();
  await ensureReviewSchedule(ctx, { projectId: PROJECT_ID, sessionId: "s-1", intervalMs: 3_600_000 });
  const updated = await ensureReviewSchedule(ctx, { projectId: PROJECT_ID, sessionId: "s-1", intervalMs: 900_000 });

  assert.equal(updated.ok, true);
  assert.equal(updated.created, false);
  assert.equal(schedules.length, 1, "必须原地改，不得出现第二条");
  assert.equal(schedules[0].everySeconds, 900);
});

test("间隔未变则不动（不制造无谓的 update）", async () => {
  const { ctx, schedules } = fakeHost();
  await ensureReviewSchedule(ctx, { projectId: PROJECT_ID, sessionId: "s-1", intervalMs: 3_600_000 });
  const before = schedules[0].everySeconds;
  const again = await ensureReviewSchedule(ctx, { projectId: PROJECT_ID, sessionId: "s-1", intervalMs: 3_600_000 });
  assert.equal(again.ok, true);
  assert.equal(again.created, false);
  assert.equal(schedules[0].everySeconds, before);
  assert.equal(schedules.length, 1);
});

test("非法间隔在写入时拒绝——0／负数／非整数／小于 1 秒（§6.1 明文要求）", async () => {
  const { ctx, schedules } = fakeHost();
  for (const bad of [0, -1, 1.5, Number.NaN, null, 500]) {
    const result = await ensureReviewSchedule(ctx, { projectId: PROJECT_ID, sessionId: "s-1", intervalMs: bad });
    assert.equal(result.ok, false, `取值 ${String(bad)} 必须被拒绝`);
    assert.match(result.error.code, /review_schedule\/(invalid_interval|interval_too_small)/);
  }
  assert.equal(schedules.length, 0, "被拒绝的取值不得留下任何任务");
});

test("宿主把 every 静默存成 at → 报错（否则审核只跑一次而永不重复）", async () => {
  const quiet = {
    get: (name) => {
      if (name !== "schedule") return undefined;
      return {
        list: async () => [],
        create: async (sessionId, request) => ({
          id: "sched-quiet",
          kind: "at", // 静默降级：接受请求但存成一次性
          title: request.title,
          prompt: request.prompt,
        }),
        update: async () => ({ updated: true }),
        delete: async () => ({ deleted: true }),
      };
    },
  };
  const result = await ensureReviewSchedule(quiet, { projectId: PROJECT_ID, sessionId: "s-1", intervalMs: 3_600_000 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "review_schedule/kind_not_every");
});

test("撤掉周期任务只删那一条", async () => {
  const { ctx, schedules } = fakeHost();
  const armed = await ensureReviewSchedule(ctx, { projectId: PROJECT_ID, sessionId: "s-1", intervalMs: 3_600_000 });
  await removeReviewSchedule(ctx, { sessionId: "s-1", scheduleId: armed.scheduleId });
  assert.equal(schedules.length, 0);
});

// ── ⑤ 反面：判不了就不放行 ────────────────────────────────────────────────

test("判不了「落点是否在跑回合」时**不放行**（宁可跳过，不冒并发）", async () => {
  const noService = { get: () => undefined };
  assert.equal(
    await isReviewSessionBusy(noService, { sessionId: "s-1" }),
    true,
    "服务未装配时须判为忙——跳过本次比并发开两个审核安全（下一周期自然到）",
  );

  const listThrows = {
    get: () => ({
      list: async () => {
        throw new Error("list_failed");
      },
    }),
  };
  assert.equal(await isReviewSessionBusy(listThrows, { sessionId: "s-1" }), true, "列举失败同样判忙");
});

test("落点确实空闲时放行", async () => {
  const { ctx } = fakeHost();
  await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });
  const idle = await isReviewSessionBusy(ctx, { sessionId: "session-2" });
  assert.equal(idle, false, "running=false 时应放行");
});

// ── 完整链路 ────────────────────────────────────────────────────────────

test("armReviewAutomation 一次办完：建会话 + 建周期任务", async () => {
  const { ctx, sessions, schedules } = fakeHost();
  const armed = await armReviewAutomation(ctx, {
    projectId: PROJECT_ID,
    projectRoot: PROJECT_ROOT,
    intervalMs: 3_600_000,
  });
  assert.equal(armed.ok, true, JSON.stringify(armed.error));
  assert.equal(armed.sessionCreated, true);
  assert.equal(armed.scheduleCreated, true);
  assert.equal(sessions.length, 1);
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].sessionId, sessions[0].sessionId, "周期任务须绑到专属会话");
});

test("重复 arm 不产生第二份（幂等）", async () => {
  const { ctx, sessions, schedules } = fakeHost();
  await armReviewAutomation(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT, intervalMs: 3_600_000 });
  const again = await armReviewAutomation(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT, intervalMs: 3_600_000 });
  assert.equal(again.ok, true);
  assert.equal(again.sessionCreated, false);
  assert.equal(again.scheduleCreated, false);
  assert.equal(sessions.length, 1);
  assert.equal(schedules.length, 1);
});

// ── 源码级：不得自建计时器 ────────────────────────────────────────────────

test("周期调度模块不得使用 setTimeout/setInterval（形态 2 的周期归宿主）", async () => {
  const source = await readFile(join(LIB, "experience-review-schedule.js"), "utf8");
  // **剥掉注释再判**：本文件的说明性注释里就写着「本文件里没有 setTimeout」——
  // 直接对全文做 includes 会把那句说明判成违规（实测踩到，一次假失败）。
  // 判据要看的是**调用**，不是提到名字。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["setTimeout", "setInterval", "setImmediate"]) {
    assert.ok(
      !code.includes(forbidden),
      `${forbidden} 不得出现在周期调度模块的**代码**里——周期由宿主持有；自建计时器重启即丢，且规范要求该形态的周期归宿主`,
    );
  }
  assert.ok(code.includes("every_seconds"), "必须走宿主的 every_seconds 规则");
});

// ── 归档视为删除（2026-10-26 Human 要求）────────────────────────────────

test("**已归档的会话不算命中**（归档即删除，不得继续往里投递）", async () => {
  // 实测依据：本项目 113 条已归档会话仍在 sessionController.list() 的返回里
  // ——宿主不过滤归档，故必须自己判。若不判，审核会不断回到一个用户已经收起来的
  // 对话里：用户既看不到、也管不了它。
  const { ctx, sessions } = fakeHost();
  const archivedId = "session-archived";
  sessions.push({
    sessionId: archivedId,
    cwd: PROJECT_ROOT,
    running: false,
    projections: { values: { title: reviewSessionTitle(PROJECT_ID) } },
  });
  // 给这个宿主补一个 workspaceController.follow()，baseline 里带上归档集合。
  const withArchive = {
    get: (name) => {
      if (name === "workspaceController") {
        return {
          follow: () => (async function* () {
            yield { type: "baseline", value: { items: [], archivedSessionIds: [archivedId], pinnedSessionIds: [] } };
          })(),
        };
      }
      return ctx.get(name);
    },
  };

  const found = await findReviewSession(withArchive, { projectId: PROJECT_ID });
  assert.equal(found.ok, true);
  assert.equal(found.sessionId, null, "已归档的会话不得被当作落点");
});

test("未归档的同标题会话仍正常命中（排除归档不得误伤）", async () => {
  const { ctx } = fakeHost();
  await ensureReviewSession(ctx, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });
  const withArchive = {
    get: (name) => {
      if (name === "workspaceController") {
        return {
          follow: () => (async function* () {
            yield { type: "baseline", value: { items: [], archivedSessionIds: ["some-other-session"], pinnedSessionIds: [] } };
          })(),
        };
      }
      return ctx.get(name);
    },
  };
  const found = await findReviewSession(withArchive, { projectId: PROJECT_ID });
  assert.equal(found.ok, true);
  assert.notEqual(found.sessionId, null, "别的会话被归档，不该影响本项目的落点");
});

test("读不到归档集合时**不当作「没有归档」**，仍按标题查找（保守但可用）", async () => {
  // 读不到 = 未知。此时若报错，审核就完全不能跑了；若当作「全都已归档」，
  // 则会无限新建会话。故按标题正常查找——这是最小损害的退化，且不产生新问题：
  // 最坏情况是复用了一个已归档会话（与修复前相同），而不是彻底停摆。
  const { ctx } = fakeHost();
  const noWorkspaceController = {
    get: (name) => (name === "workspaceController" ? undefined : ctx.get(name)),
  };
  await ensureReviewSession(noWorkspaceController, { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT });
  const found = await findReviewSession(noWorkspaceController, { projectId: PROJECT_ID });
  assert.equal(found.ok, true);
  assert.notEqual(found.sessionId, null, "读不到归档信息时仍应能命中已有会话");
});
