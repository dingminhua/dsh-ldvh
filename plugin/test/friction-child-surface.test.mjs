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
    let enabled = true;
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
    delete args.group;
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
    });
    const result = await registered[0].execute(observationArgs({ index: 9, group }));
    assert.equal(result.ok, true, "观察本身已写入，不因署名缺失而作废");
    assert.equal(result.recorded, true);
    assert.equal(result.promotion?.promoted ?? 0, 0, "无署名不得建账（09 机械签名）");
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
