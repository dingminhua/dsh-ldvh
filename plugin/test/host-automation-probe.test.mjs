// 宿主能力探针的单元测试（2026-10-26）。
//
// ## 这个文件守什么
//
// `probeHostAutomation` 是**接线前的可行性验证**工具。它的价值在于「结论可信」——
// 若它自己会把「接口不匹配」误报成「通过」，那它就变成了一张假的通行证，
// 比没有它更糟。
//
// 故这里用**假宿主**覆盖几类真实世界会出现的失败形态：
//   ① 服务未装配 → 必须报 `services-missing`，**不得**继续假装能跑；
//   ② `schedule.create` 拒收 `timing: { kind: 'every' }` → 必须如实记录该步失败；
//   ③ 宿主把 `kind` 存成别的形态 → 必须报「kind≠every」；
//   ④ 新建会话的 `cwd` 与请求不符 → 必须报不一致（这是「只在本项目内创建」的机械证据）；
//   ⑤ 清理指引必须给出**确切**的删除参数，否则「跑完留下一堆东西」。
//
// ## 0.2.2-rc.1 契约变更后本文件同步的三处
//
// 宿主把 `schedule` 重建为「独立任务 + 显式目标」形态：`create(request, actorSessionId?, signal?)`
// （会话进 `request.target`、计时进 `request.timing`），`delete` 移除并入
// `edit({ action: 'delete' })`。假宿主必须**按新签名**接收，否则测的是一份已不存在的接口，
// 绿了也不代表能跑。⑥ 新增：探针若退回旧签名（把会话当第一个实参、计时放顶层），
// 假宿主会因读不到 `request.timing` 而判失败——这条防止「改测试不改实现」的反向漂移。
//
// **真实宿主上的结论只能由真实宿主给出**——本文件不主张任何关于宿主行为的事实。
import { test } from "node:test";
import assert from "node:assert/strict";

import { probeHostAutomation, formatProbeReport } from "../lib/host-automation-probe.js";

const PROJECT = "/Users/dev/projects/alpha";

/** 造一个假宿主；`overrides` 可覆盖任一部分以模拟畸形宿主。 */
function fakeHost(overrides = {}) {
  const state = {
    sessions: [{ sessionId: "session-existing", cwd: PROJECT, projections: { values: { title: "LDVH 经验审核 · 探针" } } }],
    schedules: [],
  };
  let seq = 0;
  const schedule = {
    // 0.2.2-rc.1 签名：create(request, actorSessionId?, signal?)。
    // 刻意**不**兼容旧签名：若探针退回旧形态，`request` 会是 sessionId 字符串，
    // `request.timing` 读不到 → 下面抛错 → 用例红。
    create: async (request) => {
      if (typeof request !== "object" || request === null || typeof request.timing !== "object") {
        throw new Error("invalid_rule: schedule.create expects a request object carrying `timing`");
      }
      if (request.timing.kind !== "every") {
        throw new Error(`invalid_rule: expected an every selector, got ${String(request.timing.kind)}`);
      }
      const record = {
        id: `sched-${++seq}`,
        kind: "every",
        title: request.title,
        prompt: request.prompt,
        everySeconds: request.timing.every_seconds,
        scheduledAt: new Date().toISOString(),
      };
      state.schedules.push({ target: request.target, record });
      return record;
    },
    edit: async () => ({ deleted: true }),
    ...(overrides.schedule ?? {}),
  };
  const sessionController = {
    list: async () => ({ items: state.sessions }),
    create: async (request) => {
      const sessionId = `session-new-${++seq}`;
      state.sessions.push({
        sessionId,
        cwd: request.cwd,
        projections: { values: { title: request.title ?? null } },
      });
      return { sessionId };
    },
    ...(overrides.sessionController ?? {}),
  };
  const ctx = {
    get: (name) => {
      if (overrides.hideServices?.includes(name)) return undefined;
      if (name === "schedule") return schedule;
      if (name === "sessionController") return sessionController;
      return undefined;
    },
  };
  return { ctx, state };
}

test("dryRun（缺省）：只读探测，不创建任何东西", async () => {
  const { ctx, state } = fakeHost();
  const sessionsBefore = state.sessions.length;
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT });

  assert.equal(result.dryRun, true, "缺省必须是只读——探针不得因为被调用就产生副作用");
  assert.equal(state.sessions.length, sessionsBefore, "只读模式不得创建会话");
  assert.equal(state.schedules.length, 0, "只读模式不得创建任务");
  assert.equal(result.verdict, "dry-run-complete");
  assert.deepEqual(result.cleanup, [], "没创建东西就不该有清理项");
});

test("服务未装配：如实报 services-missing，不假装能跑", async () => {
  const { ctx } = fakeHost({ hideServices: ["schedule"] });
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT });
  assert.equal(result.verdict, "services-missing");
  assert.equal(result.services.schedule, false);
  const failed = result.steps.filter((s) => !s.ok).map((s) => s.name);
  assert.ok(failed.some((name) => name.includes("schedule 可取")), `须如实报缺服务，实际失败项：${failed.join(", ")}`);
});

test("写模式：创建会话与周期任务，并给出**确切**的清理参数", async () => {
  const { ctx, state } = fakeHost();
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT, dryRun: false });

  assert.notEqual(result.created.sessionId, null, "须创建会话");
  assert.notEqual(result.created.scheduleId, null, "须创建任务");
  assert.equal(state.schedules.length, 1);
  assert.equal(state.schedules[0].record.kind, "every", "周期任务须是 every 规则");
  assert.equal(state.schedules[0].record.everySeconds, 3600);

  // 清理指引必须**精确到可执行**，否则跑完会留下东西。
  const kinds = result.cleanup.map((c) => c.kind);
  assert.ok(kinds.includes("schedule.edit"), "须给出任务删除指引（0.2.2-rc.1 无 schedule.delete，删除并入 edit）");
  assert.ok(kinds.includes("session.delete"), "须给出会话删除指引");
  const schedCleanup = result.cleanup.find((c) => c.kind === "schedule.edit");
  assert.equal(schedCleanup.request.action, "delete", "清理动作须是 edit 的 delete");
  assert.equal(schedCleanup.request.id, result.created.scheduleId);
});

test("宿主拒收 every 选择器：如实记录失败，不伪造成功", async () => {
  const { ctx } = fakeHost({
    schedule: {
      create: async () => {
        throw new Error("invalid_rule: the every selector is not supported");
      },
    },
  });
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT, dryRun: false });
  assert.equal(result.created.scheduleId, null, "失败时不得记出一个假 id");
  assert.equal(result.verdict, "some-probes-failed");
  const step = result.steps.find((s) => s.name.includes("schedule/create(every) 调用"));
  assert.ok(step, "须记录该步");
  assert.equal(step.ok, false);
  assert.match(step.detail, /invalid_rule/);
});

test("宿主把周期任务存成别的形态：报 kind≠every（判别式是判据，不是装饰）", async () => {
  const { ctx } = fakeHost({
    schedule: {
      // 宿主「接受」了请求，但存下来的是 at 形态——这种静默降级最危险。
      create: async (request) => ({
        id: "sched-quiet",
        kind: "at",
        title: request.title,
        prompt: request.prompt,
        scheduledAt: new Date().toISOString(),
      }),
    },
  });
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT, dryRun: false });
  assert.notEqual(result.created.scheduleId, null, "宿主确实返回了记录");
  const step = result.steps.find((s) => s.name === "返回记录 kind=every");
  assert.ok(step, "须有 kind 判定这一步");
  assert.equal(step.ok, false, "kind=at 必须判失败——静默降级成一次性任务等于审计从不重复");
  assert.equal(result.verdict, "some-probes-failed");
});

test("新建会话的 cwd 与项目根不符：报不一致（「只在本项目内创建」的机械证据）", async () => {
  const { ctx } = fakeHost({
    sessionController: {
      // 宿主忽略了 cwd，把会话建在别处。
      create: async () => ({ sessionId: "session-elsewhere" }),
      list: async () => ({
        items: [
          { sessionId: "session-elsewhere", cwd: "/Users/dev/projects/beta", projections: { values: { title: "x" } } },
        ],
      }),
    },
  });
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT, dryRun: false });
  const step = result.steps.find((s) => s.name === "新会话的 cwd 与项目根一致");
  assert.ok(step, "须核对 cwd");
  assert.equal(step.ok, false, "cwd 不符必须判失败——否则「只创建在各自管辖的项目内」无从保证");
  assert.match(step.detail, /beta/);
});

test("投影里读不出 title：如实报样本情况，不把空样本当成「可行」", async () => {
  const { ctx } = fakeHost({
    sessionController: {
      list: async () => ({ items: [{ sessionId: "s1", cwd: PROJECT, projections: { values: {} } }] }),
      create: async () => ({ sessionId: "s-new" }),
    },
  });
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT });
  const step = result.steps.find((s) => s.name === "投影可读出 title");
  assert.ok(step);
  assert.equal(step.ok, false, "有会话但都读不出 title，须判失败（否则「按固定标题查找」不成立）");
});

test("formatProbeReport 可读，且把须清理项列出来", async () => {
  const { ctx } = fakeHost();
  const result = await probeHostAutomation(ctx, { projectRoot: PROJECT, dryRun: false });
  const text = formatProbeReport(result);
  assert.match(text, /宿主能力探针/);
  assert.match(text, /须清理/);
  assert.match(text, /schedule\.edit/);
  // 报告须能一眼看出成败：每一步都有 ✅ 或 ❌。
  for (const step of result.steps) {
    assert.ok(text.includes(step.name), `报告须包含步骤：${step.name}`);
  }
});
