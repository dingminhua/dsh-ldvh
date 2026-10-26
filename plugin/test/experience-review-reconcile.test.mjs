// 审核周期任务的**设置联动**（2026-10-26）。
//
// ## 这个文件为什么存在
//
// Human 实测报的缺陷：「我修改了间隔时间，但没有发现同步调整」。核查发现配置确实
// 落盘了（`experienceReviewEnabled: true`、`experienceReviewIntervalMs: 120000`），
// 但系统里既没有专属会话也没有周期任务。根因两条：
//
//   ① 武装写在 `agent/created` 里 —— 改设置不创建 agent，代码不重跑；
//   ② 从未订阅 `app-boot/config-reload` —— 宿主有热更新能力却没用上。
//
// 所以这里守的是**四种状态迁移**，而不是「单个函数能跑」：
//
//   关闭 → 开启（武装：建会话 + 建周期任务）
//   开启 → 改间隔（**原地同步**，不重建）
//   开启 → 关闭（撤除周期任务，**但不删会话**）
//   关闭 → 关闭（不动，不做无谓的宿主调用）
//
// ## 一条刻意的设计决定，专门守
//
// **撤除只撤周期任务，不删专属会话。** 会话里是历次审核的运行痕迹，删了不可逆；
// 而 Human 关掉审核的意思是「别再自动跑了」，不是「把历史抹掉」。若有人把它改成
// 连会话一起删，这个测试会红。
import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcileAllProjects, reconcileProjectReview } from "../lib/experience-review-reconcile.js";
import { reviewSessionTitle } from "../lib/experience-review-schedule.js";

const PROJECT = { id: "fixture-project", path: "/Users/dev/projects/fixture" };
// **已含方括号**：拼接时不再套 `[...]`——第一版写成 `` `[${REVIEW_TAG}] x` ``，
// 产出 `[[dsh-ldvh:experience-review]]`，于是 startsWith 判定全部落空、去重被跳过，
// 而断言看到的症状是「重复任务没被收敛」，看起来像被测代码的缺陷。夹具差一个字符，
// 结论就指向错误的地方。
const REVIEW_TAG = "[dsh-ldvh:experience-review]";

/**
 * 假宿主。会话与任务都真的存着，以便断言「有没有被创建/撤除」。
 *
 * `schedule.update` 只改间隔、**不换 id**——这正是「原地同步」与「删后重建」的
 * 可区分之处：重建会换 id。
 */
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
      const sessionId = `session-${++seq}`;
      sessions.push({ sessionId, cwd: request.cwd, running: false, projections: { values: { title: null } } });
      return { sessionId };
    },
    rename: async ({ sessionId, title }) => {
      const row = sessions.find((item) => item.sessionId === sessionId);
      if (row === undefined) throw new Error("session_not_found");
      row.projections.values.title = title;
      return { title, seq: 1 };
    },
  };
  const ctx = {
    get: (name) => {
      if (name === "schedule") return schedule;
      if (name === "sessionController") return sessionController;
      return undefined;
    },
  };
  return { ctx, sessions, schedules };
}

function settings({ enabled, intervalMs = 3_600_000 }) {
  return { review: { enabled, intervalMs } };
}

function quietActivity() {
  const events = [];
  return { record: (name, payload) => events.push({ name, payload }), events };
}

// ── 关闭 → 开启 ────────────────────────────────────────────────────────

test("关闭状态下协调：什么都不做（不建会话、不建任务）", async () => {
  const { ctx, sessions, schedules } = fakeHost();
  const result = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: false }) });

  assert.equal(result.ok, true);
  assert.equal(result.action, "noop");
  assert.equal(sessions.length, 0, "关闭时不得建会话");
  assert.equal(schedules.length, 0, "关闭时不得建任务");
});

test("打开开关 → 武装：建出专属会话与周期任务，间隔按设置", async () => {
  const { ctx, sessions, schedules } = fakeHost();
  const activity = quietActivity();
  const result = await reconcileProjectReview({
    ctx,
    project: PROJECT,
    settings: settings({ enabled: true, intervalMs: 120_000 }),
    activity,
  });

  assert.equal(result.ok, true, JSON.stringify(result.detail));
  assert.equal(result.action, "armed");
  assert.equal(sessions.length, 1, "须建出专属会话");
  assert.equal(sessions[0].cwd, PROJECT.path, "会话须落在该项目内");
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].everySeconds, 120, "间隔须按设置换算成秒");
  assert.equal(schedules[0].sessionId, sessions[0].sessionId, "任务须绑到专属会话");
  assert.ok(activity.events.some((e) => e.name === "review/armed"), "须记账");
});

// ── 开启 → 改间隔（Human 报的那个症状）──────────────────────────────────

test("**间隔改小 → 原地同步**（不重建任务，id 不变）", async () => {
  const { ctx, schedules } = fakeHost();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 3_600_000 }) });
  const originalId = schedules[0].id;
  assert.equal(schedules[0].everySeconds, 3600);

  const result = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });

  assert.equal(result.ok, true, JSON.stringify(result.detail));
  assert.equal(result.action, "interval-synced", "应识别为「同步间隔」而不是重新武装");
  assert.equal(schedules.length, 1, "**不得**出现第二条任务");
  assert.equal(schedules[0].id, originalId, "**id 不变**才叫原地同步；换 id 就是删后重建");
  assert.equal(schedules[0].everySeconds, 120, "间隔必须真的改成 120 秒（2 分钟）");
});

test("连续多次改间隔：每次都同步到最新值，任务始终只有一条", async () => {
  const { ctx, schedules } = fakeHost();
  for (const minutes of [60, 30, 5, 2, 1]) {
    await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: minutes * 60_000 }) });
  }
  assert.equal(schedules.length, 1, "不得累积出多条");
  assert.equal(schedules[0].everySeconds, 60, "最终须是最新的 1 分钟");
});

// ── 开启 → 关闭 ────────────────────────────────────────────────────────

test("**关闭 → 撤除周期任务，但不删专属会话**（历史痕迹不可逆地丢）", async () => {
  const { ctx, schedules, sessions } = fakeHost();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });
  assert.equal(schedules.length, 1);
  assert.equal(sessions.length, 1);

  const activity = quietActivity();
  const result = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: false }), activity });

  assert.equal(result.ok, true, JSON.stringify(result.detail));
  assert.equal(result.action, "disarmed");
  assert.equal(schedules.length, 0, "周期任务须被撤除（否则还会继续投递）");
  assert.equal(sessions.length, 1, "**会话必须留着**——里面是历次审核的运行痕迹，删了不可逆");
  assert.ok(activity.events.some((e) => e.name === "review/disarmed"));
});

test("关闭后再次关闭：不动（不重复删）", async () => {
  const { ctx, schedules } = fakeHost();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: false }) });
  const result = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: false }) });
  assert.equal(result.action, "noop");
  assert.equal(schedules.length, 0);
});

test("关闭 → 再开启：复用既有会话，不建第二个", async () => {
  const { ctx, sessions, schedules } = fakeHost();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: false }) });
  const back = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });

  assert.equal(back.ok, true, JSON.stringify(back.detail));
  assert.equal(back.action, "armed");
  assert.equal(sessions.length, 1, "**不得**建第二个会话——固定标题查找应命中");
  assert.equal(schedules.length, 1, "任务须被重新建上");
});

// ── 残缺状态的自愈 ──────────────────────────────────────────────────────

test("会话在、任务丢了 → 补建任务（不重建会话）", async () => {
  const { ctx, schedules, sessions } = fakeHost();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });
  schedules.length = 0; // 模拟任务被外部删掉

  const result = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });
  assert.equal(result.ok, true);
  assert.equal(result.action, "armed");
  assert.equal(schedules.length, 1, "任务须补回");
  assert.equal(sessions.length, 1, "会话不得重建");
});

// ── 多项目 ────────────────────────────────────────────────────────────

test("遍历全部项目：各自一个专属会话，互不混用", async () => {
  const { ctx, sessions, schedules } = fakeHost();
  const projects = [
    { id: "alpha", path: "/Users/dev/projects/alpha" },
    { id: "beta", path: "/Users/dev/projects/beta" },
  ];
  const { results } = await reconcileAllProjects({ ctx, projects, settings: settings({ enabled: true, intervalMs: 120_000 }) });

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(sessions.length, 2, "每个项目各一个会话");
  assert.equal(schedules.length, 2, "每个项目各一条任务");
  // 落点不得跨项目。
  const alpha = sessions.find((s) => s.cwd === "/Users/dev/projects/alpha");
  const beta = sessions.find((s) => s.cwd === "/Users/dev/projects/beta");
  assert.ok(alpha && beta, "两个项目各自的会话须落在各自根目录");
  assert.notEqual(alpha.sessionId, beta.sessionId);
});

test("单个项目失败不阻断其余项目", async () => {
  const { ctx } = fakeHost();
  const projects = [
    { id: "broken", path: "/nope", status: { error: "path missing" } },
    { id: "alpha", path: "/Users/dev/projects/alpha" },
  ];
  const { results } = await reconcileAllProjects({ ctx, projects, settings: settings({ enabled: true, intervalMs: 120_000 }) });

  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false, "坏项目如实失败");
  assert.equal(results[0].action, "skipped");
  assert.equal(results[1].ok, true, "**好项目不得被坏项目带停**");
});

// ── 记账 ───────────────────────────────────────────────────────────────

test("每次动作都记账，便于事后核对开关到底有没有生效", async () => {
  const { ctx } = fakeHost();
  const activity = quietActivity();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }), activity });
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 60_000 }), activity });
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: false }), activity });

  const names = activity.events.map((e) => e.name);
  assert.ok(names.includes("review/armed"), `须记「已武装」，实际：${names.join(", ")}`);
  assert.ok(names.includes("review/interval-synced"), `须记「间隔已同步」，实际：${names.join(", ")}`);
  assert.ok(names.includes("review/disarmed"), `须记「已撤除」，实际：${names.join(", ")}`);
  // 记账须带项目标识——否则多项目下看不出是谁。
  assert.ok(activity.events.every((e) => e.payload?.projectId === PROJECT.id));
});

test("周期任务的 prompt 带本插件标签（撤除与查重都靠它识别）", async () => {
  const { ctx, schedules } = fakeHost();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 120_000 }) });
  assert.ok(schedules[0].prompt.startsWith(REVIEW_TAG), "标签须在 prompt 首部");
});

// ── 并发缺陷（2026-10-26 实测：两条任务相隔 25 毫秒）─────────────────────

test("**并发调用协调不得创建两条任务**（实测缺陷的回归护栏）", async () => {
  // 症状：Human 打开审核后，同一会话上出现两条周期任务，scheduledAt 差 25ms。
  // 根因：订阅了两个事件，改一次设置两个都触发；ensureReviewSchedule 是「先查后建」，
  // 两次并发都读到「没有」，于是各建一条。
  //
  // 这条测试**必须真的并发**（Promise.all），顺序 await 永远发现不了这个缺陷。
  const { ctx, schedules, sessions } = fakeHost();
  const settingsOn = settings({ enabled: true, intervalMs: 300_000 });

  await Promise.all([
    reconcileProjectReview({ ctx, project: PROJECT, settings: settingsOn }),
    reconcileProjectReview({ ctx, project: PROJECT, settings: settingsOn }),
    reconcileProjectReview({ ctx, project: PROJECT, settings: settingsOn }),
  ]);

  assert.equal(sessions.length, 1, `不得建出第二个会话，实为 ${sessions.length}`);
  assert.equal(schedules.length, 1, `三个并发调用只能有一条任务，实为 ${schedules.length}`);
});

test("**自愈**：同会话已有多条任务时，收敛为一条（保留最早）", async () => {
  // 造出「历史并发缺陷留下的现场」：同一会话两条任务，`scheduledAt` 差 25 毫秒
  // ——正是 2026-10-26 实测到的形态（15:14:50.619 / .644）。
  //
  // **本测试自建整套宿主，不复用 fakeHost()**：上一版复用它时，`fakeHost` 的
  // `create` 会生成自己的 `session-N` 会话，与这里手工铺的 `s-1` 并存，于是协调
  // 找到的是**新会话**而非 `s-1`，去重被跳过、断言看到 3 条。夹具的隐藏状态
  // 会伪装成被测代码的缺陷——故这里把状态全部显式铺出来。
  const SESSION_ID = "session-review";
  const titles = reviewSessionTitle(PROJECT.id);
  const sessions = [{ sessionId: SESSION_ID, cwd: PROJECT.path, running: false, projections: { values: { title: titles } } }];
  const schedules = [
    { id: "sched-old", sessionId: SESSION_ID, kind: "every", everySeconds: 300, prompt: `${REVIEW_TAG} x`, scheduledAt: "2026-10-26T15:14:50.619Z" },
    { id: "sched-new", sessionId: SESSION_ID, kind: "every", everySeconds: 300, prompt: `${REVIEW_TAG} x`, scheduledAt: "2026-10-26T15:14:50.644Z" },
  ];
  let createCalls = 0;
  const ctx = {
    get: (name) => {
      if (name === "schedule") {
        return {
          list: async () => schedules.map((row) => ({ ...row })),
          create: async (sessionId, request) => {
            createCalls += 1;
            const record = { id: `created-${createCalls}`, sessionId, kind: "every", everySeconds: request.every_seconds, prompt: request.prompt, scheduledAt: new Date().toISOString() };
            schedules.push(record);
            return record;
          },
          update: async ({ id, change }) => {
            const row = schedules.find((r) => r.id === id);
            if (row !== undefined) row.everySeconds = change.every_seconds;
            return { updated: true, id };
          },
          delete: async ({ id }) => {
            const index = schedules.findIndex((r) => r.id === id);
            if (index < 0) return { deleted: false };
            schedules.splice(index, 1);
            return { deleted: true };
          },
        };
      }
      if (name === "sessionController") {
        return {
          list: async () => ({ items: sessions.map((row) => ({ ...row })) }),
          create: async () => {
            throw new Error("本测试不应创建会话——专属会话已存在");
          },
          rename: async () => ({ title: "x", seq: 1 }),
        };
      }
      return undefined;
    },
  };

  const result = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 300_000 }) });

  assert.equal(result.ok, true, JSON.stringify(result.detail));
  assert.equal(schedules.length, 1, `重复任务须被收敛为一条，实为 ${schedules.length}：${schedules.map((r) => r.id).join(",")}`);
  assert.equal(schedules[0].id, "sched-old", "须保留**最早**那条（它有最长的投递历史）");
  assert.equal(createCalls, 0, "去重后仍有一条任务存在，不该再补建");
  // 间隔本就一致，故行动只是「同步间隔」。
  assert.equal(result.action, "interval-synced", `间隔已一致时应为 interval-synced，实为 ${result.action}`);
});

test("只有一个任务时自愈不动它（不做无谓删除）", async () => {
  const { ctx, schedules } = fakeHost();
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 300_000 }) });
  const before = schedules[0].id;
  await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 300_000 }) });
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].id, before, "单条任务不得被删重建");
});

// ── 归档视为删除（2026-10-26 Human 要求）────────────────────────────────

test("落点会话被归档后：清掉它上面的孤儿任务，并在新会话上重建", async () => {
  // 场景：用户把审核会话收起来了（归档 = 删除）。此后：
  //   · 旧会话不再算命中 → 应新建一个会话作为落点
  //   · 但旧会话上那条周期任务还在 → 会继续往「已经收起来的对话」投递
  // 故协调必须先把孤儿任务撤掉，否则审核在一个用户看不到的会话里跑。
  const ARCHIVED = "session-archived-review";
  const sessions = [
    { sessionId: ARCHIVED, cwd: PROJECT.path, running: false, projections: { values: { title: reviewSessionTitle(PROJECT.id) } } },
  ];
  const schedules = [
    { id: "sched-orphan", sessionId: ARCHIVED, kind: "every", everySeconds: 300, prompt: `${REVIEW_TAG} x`, scheduledAt: "2026-10-26T15:00:00.000Z" },
  ];
  let createdSession = null;
  const ctx = {
    get: (name) => {
      if (name === "schedule") {
        return {
          // catalog 返回**平铺**结构（ScheduleRecord & {sessionId,status}），无 record 嵌套。
          catalog: async () => schedules.map((row) => ({ ...row, status: "active" })),
          list: async ({ sessionId }) => schedules.filter((row) => row.sessionId === sessionId).map((row) => ({ ...row })),
          create: async (sessionId, request) => {
            const record = { id: `created-${schedules.length}`, sessionId, kind: "every", everySeconds: request.every_seconds, prompt: request.prompt, scheduledAt: new Date().toISOString() };
            schedules.push(record);
            return record;
          },
          update: async ({ id, change }) => {
            const row = schedules.find((r) => r.id === id);
            if (row !== undefined) row.everySeconds = change.every_seconds;
            return { updated: true, id };
          },
          delete: async ({ id }) => {
            const index = schedules.findIndex((r) => r.id === id);
            if (index < 0) return { deleted: false };
            schedules.splice(index, 1);
            return { deleted: true };
          },
        };
      }
      if (name === "sessionController") {
        return {
          list: async () => ({ items: sessions.map((row) => ({ ...row })) }),
          create: async (request) => {
            createdSession = `session-fresh`;
            sessions.push({ sessionId: createdSession, cwd: request.cwd, running: false, projections: { values: { title: null } } });
            return { sessionId: createdSession };
          },
          rename: async ({ sessionId, title }) => {
            const row = sessions.find((r) => r.sessionId === sessionId);
            if (row !== undefined) row.projections.values.title = title;
            return { title, seq: 1 };
          },
        };
      }
      if (name === "workspaceController") {
        return {
          follow: () => (async function* () {
            yield { type: "baseline", value: { items: [], archivedSessionIds: [ARCHIVED], pinnedSessionIds: [] } };
          })(),
        };
      }
      if (name === "workspaceRegistry") return undefined; // 不影响本测试
      return undefined;
    },
  };

  const result = await reconcileProjectReview({ ctx, project: PROJECT, settings: settings({ enabled: true, intervalMs: 300_000 }) });

  assert.equal(result.ok, true, JSON.stringify(result.detail));
  assert.equal(createdSession, "session-fresh", "归档会话不再算命中，应新建一个落点会话");
  const orphanStillThere = schedules.some((row) => row.id === "sched-orphan");
  assert.equal(orphanStillThere, false, "归档会话上那条孤儿任务必须被撤掉——否则它会继续往用户已收起的对话投递");
  assert.equal(schedules.length, 1, "新会话上应恰好一条任务");
  assert.ok(schedules.every((row) => row.sessionId !== ARCHIVED), "不得再有任务绑在归档会话上");
});
