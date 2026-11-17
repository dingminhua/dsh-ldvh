/**
 * 子代理摩擦记录面（`ldvh_friction_record_observation`）——2026-11-17 新增。
 *
 * Authority: specs/11 §9（摩擦六项，两拍同在一次派发内）、§12bis.1（观察缓冲）、
 *            specs/00 §4.5（代理辅助任务）、specs/26 §16 第 1 项（账目写入须 Human 确认）。
 *
 * ## 为什么必须有这个文件
 *
 * 这一面在 2026-11-17 随「主控发起」机制新增，此前**没有任何测试**。它是新机制里
 * 唯一能写摩擦观察的入口，且承担两件容易悄悄失效的事：
 *
 *   ① **记录总是发生**——不因「攒不够 N=3」而拒记（Human 2026-11-17 明确：
 *      「发现摩擦还是要记录的呀，大于=3就转为待修」）。若实现把阈值当成写入前置，
 *      缓冲永远攒不满，机制整体停摆且外部只看到「没记上」。
 *   ② **晋升由本执行体顺带做**，不再另派一个代理（Human 2026-11-17：「是派出去的
 *      代理来执行，不是再派一个代理」）。若实现漏掉这一步，达阈值的组会永远停在
 *      pending——这正是旧形态实测「50 条运行记录 0 次成功晋升」的同族失效。
 *
 * 同时钉住边界：**不给账目读写**。账目写入绕过 N=3 阈值且需 Human 确认（26 §16），
 * 子代理绝不能有那个工具。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { withTemp } from "./helpers.mjs";
import { registerFrictionChildSurface } from "../lib/friction-tools.js";
import {
  appendFrictionObservation,
  readFrictionObservations,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "../lib/friction-observation-buffer.js";
import { listFrictionObjects } from "../lib/friction-writer.js";

const PROJECT = "dsh-ldvh";

/** 捕获注册进来的工具描述符，返回可调用 execute 的句柄。 */
function makeCtx() {
  const registered = [];
  return {
    ctx: {
      tools: {
        register(descriptor) {
          registered.push(descriptor);
          return () => {};
        },
      },
    },
    registered,
  };
}

/**
 * 宿主会话持久化桩：晋升建账要**权威署名**（09 机械签名），署名只能从会话记录的
 * `model/selection` 事件取，不得由调用方自填。故这里给一个真实形状的最小日志。
 */
function persistenceStub() {
  return {
    locate: () => undefined,
    open: async () => ({
      read: async () => ({
        events: [
          { type: "model/selection", seq: 0, data: { provider: "test-provider", model: "test-model" } },
        ],
      }),
      close: async () => {},
    }),
  };
}

/** 一条观察的入参（闭集必填齐全）。 */
function observationArgs({ index = 1, group = "dependency-reinstall" } = {}) {
  return {
    phenomenon: `同一份依赖被重装 ${index} 次`,
    evidence: `依赖重装记录第 ${index} 行（逐字引证）`,
    group,
    title: "依赖被重复安装",
    basis: "重复出现；归因：索引重建未复用已装依赖。",
    attribution: "索引重建流程",
    anchor: `turn-${index}`,
  };
}

test("子代理摩擦面：只注册 record 一个工具，不给账目读写（26 §16 第 1 项边界）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: (...segments) => join(root, "dsh-home", ...segments),
      resolveProjectId: async () => ({ id: PROJECT, path: join(root, "fact-source") }),
      resolveSessionId: () => "sess-child",
    });
    assert.deepEqual(
      registered.map((d) => d.name),
      ["ldvh_friction_record_observation"],
      "子面只应有 record；账目 read/list/write 一律不得出现在子代理工具集里",
    );
  });
});

test("记录总是发生：未达阈值也照样写入缓冲（不因攒不够 N=3 而拒记）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: h,
      resolveProjectId: async () => ({ id: PROJECT, path: join(root, "fact-source") }),
      resolveSessionId: () => "sess-child",
    });
    const result = await registered[0].execute(observationArgs({ index: 1 }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.recorded, true, "第一条观察必须被记下");
    assert.equal(result.group_pending_count, 1);

    const read = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.items.length, 1, "缓冲里确有这一条");
    // 未达阈值 ⇒ 不建账。
    assert.equal(result.promotion?.promoted ?? 0, 0, "未达阈值不得晋升");
  });
});

test("设置面关闭：拒绝写入缓冲，且不解析项目、不晋升（关了不能照写）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    const { ctx, registered } = makeCtx();
    let projectResolutions = 0;
    registerFrictionChildSurface(ctx, {
      dshHomePath: h,
      resolveProjectId: async () => {
        projectResolutions += 1;
        return { id: PROJECT, path: join(root, "fact-source") };
      },
      resolveSessionId: () => "sess-child",
      sessionPersistence: persistenceStub,
      // 设置面：总开关或「发现摩擦」子项被关 → 本次一律拒绝。
      isFrictionDiscoveryEnabled: () => false,
    });
    const result = await registered[0].execute(observationArgs({ index: 1 }));
    assert.equal(result.ok, false, "关闭时必须拒绝写入");
    assert.equal(result.error, "friction_observation/disabled");
    assert.match(String(result.message), /设置面关闭/, "拒绝原因须可归因为设置面开关");
    assert.equal(projectResolutions, 0, "关闭时应在任何副作用之前返回，连项目解析都不做");

    const read = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.items.length, 0, "关闭时缓冲不得新增条目");
  });
});

test("设置面启用：显式 true 与旧调用方缺省均照常写入", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    // 两种调用形态：显式 true，以及完全不传该回调（旧调用方/直接测试）。
    for (const [label, enabled] of [["true", () => true], ["缺省", undefined]]) {
      const { ctx, registered } = makeCtx();
      registerFrictionChildSurface(ctx, {
        dshHomePath: h,
        resolveProjectId: async () => ({ id: PROJECT, path: join(root, "fact-source") }),
        resolveSessionId: () => "sess-child",
        ...(enabled === undefined ? {} : { isFrictionDiscoveryEnabled: enabled }),
      });
      const result = await registered[0].execute(observationArgs({ index: 1, group: `enabled-${label}` }));
      assert.equal(result.ok, true, `${label}：应照常写入（${JSON.stringify(result)}）`);
      assert.equal(result.recorded, true, `${label}：记录须真的发生`);
    }

    const read = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.items.length, 2, "两种启用形态各写入一条");
  });
});

test("每次现读：同一分身先开后关，第二次调用即被拒（volatile 开关无需重建分身）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    let enabled = true; // 模拟 volatile 配置：同一 surface 生命周期内翻转
    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: h,
      resolveProjectId: async () => ({ id: PROJECT, path: join(root, "fact-source") }),
      resolveSessionId: () => "sess-child",
      isFrictionDiscoveryEnabled: () => enabled,
    });

    assert.equal((await registered[0].execute(observationArgs({ index: 1, group: "volatile-on" }))).ok, true);
    enabled = false;
    const second = await registered[0].execute(observationArgs({ index: 2, group: "volatile-off" }));
    assert.equal(second.ok, false, "开关翻转后第二次调用须被拒");
    assert.equal(second.error, "friction_observation/disabled");

    const read = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.items.length, 1, "仅第一次开启时写入一条，翻转后未再写");
  });
});

test("达阈值：同一次调用内顺带晋升为 open 账目（不再另派代理）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    const fsRoot = join(root, "fact-source");
    const group = "dependency-reinstall";
    // 先垫 N-1 条，使下一次调用正好达阈值。
    for (let i = 1; i < FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      const appended = await appendFrictionObservation(h, {
        project: PROJECT,
        session: "sess-child",
        anchor: `turn-${i}`,
        phenomenon: `同一份依赖被重装 ${i} 次`,
        evidence: `依赖重装记录第 ${i} 行（逐字引证）`,
        group,
        title: "依赖被重复安装",
        basis: "重复出现；归因：索引重建未复用已装依赖。",
        attribution: "索引重建流程",
      });
      assert.ok(appended.ok, JSON.stringify(appended.error));
    }

    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: h,
      resolveProjectId: async () => ({ id: PROJECT, path: fsRoot }),
      resolveSessionId: () => "sess-child",
      sessionPersistence: persistenceStub,
    });
    const result = await registered[0].execute(
      observationArgs({ index: FRICTION_OBSERVATION_THRESHOLD_N, group }),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.recorded, true);
    assert.equal(
      result.promotion?.promoted,
      1,
      "达阈值的组必须在**本次调用内**晋升——漏掉这一步就是旧形态「0 次成功晋升」的同族失效",
    );

    // 账目真的成立了（不是只在回执里声称）。
    // 执行体内部按 `join(projectPath, "ldvh-base")` 建账，故核对须用同一层根。
    const listed = await listFrictionObjects({ factSourceRoot: join(fsRoot, "ldvh-base") });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.items.length, 1, "事实源里须确有一条 open 账目");
    assert.equal(listed.value.items[0].status, "open");
  });
});

test("无项目路径时：记录仍成功，晋升被如实跳过（不静默声称已晋升）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: h,
      // 只给裸 id（旧注入形态）：没有 path 就无从建账。
      resolveProjectId: async () => PROJECT,
      resolveSessionId: () => "sess-child",
    });
    const result = await registered[0].execute(observationArgs({ index: 1 }));
    assert.equal(result.ok, true, "记录本身不受晋升可用性影响");
    assert.equal(result.recorded, true);
    assert.equal(result.promotion?.skipped, true);
    assert.equal(result.promotion?.reason, "no-project-path", "跳过原因须可归因，不得静默");
  });
});

test("解析不到受辖项目：拒绝写入（缓冲按项目分区，无分区即无处落）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: (...segments) => join(root, "dsh-home", ...segments),
      resolveProjectId: async () => null,
      resolveSessionId: () => "sess-child",
    });
    const result = await registered[0].execute(observationArgs());
    assert.equal(result.ok, false);
    assert.equal(result.error, "friction_observation/no_project");
  });
});

test("缺必填字段：拒绝写入，且不留下半条缓冲条目", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: h,
      resolveProjectId: async () => ({ id: PROJECT, path: join(root, "fact-source") }),
      resolveSessionId: () => "sess-child",
    });
    const args = observationArgs();
    delete args.group; // group 是同源聚合键，缺它阈值永远算不出
    const result = await registered[0].execute(args);
    assert.equal(result.ok, false, "缺 group 必须被拒");
    const read = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.ok(read.ok);
    assert.equal(read.value.items.length, 0, "被拒的写入不得留下条目");
  });
});

test("无权威署名时：不得建账，且失败原因须在回执里可见（不静默停滞）", async () => {
  await withTemp("friction-child-surface.", async (root) => {
    const h = (...segments) => join(root, "dsh-home", ...segments);
    const fsRoot = join(root, "fact-source");
    const group = "unsigned-group";
    for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      const appended = await appendFrictionObservation(h, {
        project: PROJECT,
        session: "sess-child",
        anchor: `turn-${i}`,
        phenomenon: `现象 ${i}`,
        evidence: `引证 ${i}`,
        group,
        title: "依赖被重复安装",
        basis: "依据",
        attribution: "归因",
      });
      assert.ok(appended.ok, JSON.stringify(appended.error));
    }
    const { ctx, registered } = makeCtx();
    registerFrictionChildSurface(ctx, {
      dshHomePath: h,
      resolveProjectId: async () => ({ id: PROJECT, path: fsRoot }),
      resolveSessionId: () => "sess-child",
      // 故意不给 sessionPersistence：署名无从取得。
    });
    const result = await registered[0].execute(observationArgs({ index: 9, group }));
    assert.equal(result.ok, true, "观察本身已写入，不因署名缺失而作废");
    assert.equal(result.recorded, true);
    assert.equal(result.promotion?.promoted ?? 0, 0, "无署名不得建账（09 机械签名）");
    // **关键**：失败原因必须可见。只报「promoted: 0」会让它与「没有达阈值的组」
    // 完全同形——那正是「看似工作而实则停滞」的失效形态。
    assert.ok(
      Array.isArray(result.promotion?.residual) && result.promotion.residual.length > 0,
      `晋升失败须带 residual 说明原因，实得 ${JSON.stringify(result.promotion)}`,
    );
    assert.equal(result.promotion.residual[0].code, "signature_unavailable");
    const listed = await listFrictionObjects({ factSourceRoot: join(fsRoot, "ldvh-base") });
    assert.ok(listed.ok);
    assert.equal(listed.value.items.length, 0, "事实源里不得出现未署名的账目");
  });
});

test("回归护栏：消费侧须读锁的 `value` 键，不得读 `result`（历史 0 次成功晋升的成因）", async () => {
  // `runFrictionPromotionExclusive` 返回 `{skipped:false, value: await fn()}`。
  // 消费侧若读 `locked.result`，恒为 undefined ⇒ 每次晋升都被记成 failed，
  // 即便账目其实已建成。历史实测「50 条运行记录 0 次成功晋升」即此形态。
  //
  // 本护栏同时钉住两个消费侧（子代理记录面 + lifecycle 检查点），因为该缺陷
  // 曾在两处同时存在；只修一处会留下同形的另一半。
  const { readFile } = await import("node:fs/promises");
  for (const rel of ["../lib/friction-tools.js", "../lib/lifecycle.js"]) {
    const source = await readFile(new URL(rel, import.meta.url), "utf8");
    const codeLines = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
    const code = codeLines.join("\n");
    assert.doesNotMatch(
      code,
      /locked\??\.result/,
      `${rel} 不得再读 locked.result——锁返回的键是 value`,
    );
  }
});
