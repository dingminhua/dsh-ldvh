// Tests for the experience delegate arming (specs/23 §13 代理记录通道,
// Human 决定 2026-11-16).
//
// Two layers are covered here and each matters on its own:
//   1. experience-arming.js — the ledger's own mechanics (one-shot bind, expiry,
//      project alignment, durable reload, fail-closed when the ledger is unread).
//   2. child.js installChild — the ONLY place a delegated session acquires the
//      three Pitfall tools. Nothing else in the repo exercises this branch (the
//      child path was previously asserted to register NO tools), so without a
//      direct test here the whole mechanism would be unverified — exactly the
//      shape pitfall-b79dc397 records (new guard with no test that reaches it,
//      mutation survives).
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createExperienceArming } from "../lib/experience-arming.js";
import { createChildInstaller } from "../lib/child.js";
import { withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);
const quietLogger = { info() {}, warn() {}, error() {} };

function makeAgent(id, header = {}) {
  const registered = [];
  const agent = {
    id,
    session: { header: { id, cwd: "/repo", ...header } },
    ctx: {
      effect: (fn) => fn(),
      on: () => () => {},
      get: () => undefined,
      tools: { register: (d) => { registered.push(d?.name ?? "unknown"); return () => {}; } }
    },
    registered
  };
  return agent;
}

/** Minimal registry-level deps installChild needs (live parent record present). */
function makeInstaller({ arming, registerChildSurface, events = [], warns = [] }) {
  const agents = new Map();
  const parent = { lastScope: { state: "governed", project: { path: "/repo", id: "demo" } }, scopeState: "governed" };
  agents.set("parent-1", parent);
  const ctx = {
    logger: { ...quietLogger, warn: (m, ...a) => warns.push([m, ...a].join(" ")) },
    get: (name) => (name === "agents" ? { get: (id) => (id === "parent-1" ? { id: "parent-1" } : undefined) } : undefined)
  };
  const installer = createChildInstaller(ctx, {
    agents,
    children: new Map(),
    sessionScopes: new Map(),
    retiredChildren: new Map(),
    ...(arming === undefined ? {} : { experienceArming: arming }),
    ...(registerChildSurface === undefined ? {} : { registerChildSurface }),
    onEvent: (hook, detail) => events.push({ hook, ...detail })
  });
  return { installer, parent };
}

const childHeader = { origin: "subagent", parentSession: "parent-1", delegationDepth: 1, isSeeded: false };

test("armed child acquires exactly the three Pitfall tools, and arm is spent", async () => {
  await withTemp("arm.", async (base) => {
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    await arming.arm({ parentSessionId: "parent-1", projectPath: "/repo", projectId: "demo", purpose: "记录本轮经验" });
    const events = [];
    const calls = [];
    const { installer } = makeInstaller({
      arming,
      registerChildSurface: (agent) => { calls.push(agent.id); return () => {}; },
      events
    });
    assert.equal(installer(makeAgent("child-A", childHeader)), true);
    assert.deepEqual(calls, ["child-A"], "被授权的分身应装上能力面");
    assert.ok(events.some((e) => e.hook === "child/experience-armed"));

    // 一次性：同父的下一个分身不得继承（审核 B6 的破口）
    assert.equal(installer(makeAgent("child-B", { ...childHeader })), true);
    assert.deepEqual(calls, ["child-A"], "同父会话的第二个分身不得再取得能力面");
    assert.equal(arming.verifyWrite({ childSessionId: "child-B", projectPath: "/repo" }).ok, false);
  });
});

test("unarmed parent: child installs with NO tools surface (既有形态逐字保持)", async () => {
  await withTemp("arm.", async (base) => {
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    await arming.load();
    const calls = [];
    const { installer } = makeInstaller({ arming, registerChildSurface: (a) => { calls.push(a.id); } });
    assert.equal(installer(makeAgent("child-X", childHeader)), true);
    assert.deepEqual(calls, [], "没有开工授权就没有任何分身取得工具面");
  });
});

test("未注入 surface 注册函数时不报错（旧组合保持原行为）", async () => {
  await withTemp("arm.", async (base) => {
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    await arming.load();
    const { installer } = makeInstaller({ arming });
    assert.equal(installer(makeAgent("child-Y", childHeader)), true, "缺 surface 注入不得打断子代理安装");
  });
});

test("surface 注册抛错：留痕、不回滚绑定、不中断安装（friction-277d7479 同族失效）", async () => {
  await withTemp("arm.", async (base) => {
    const warns = [];
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    await arming.arm({ parentSessionId: "parent-1", projectPath: "/repo", purpose: "x" });
    const events = [];
    const { installer } = makeInstaller({
      arming,
      registerChildSurface: () => { throw new Error("boom"); },
      events,
      warns
    });
    assert.equal(installer(makeAgent("child-Z", childHeader)), true, "注册失败不得使子代理安装整体失败");
    assert.ok(events.some((e) => e.hook === "child/experience-arm-failed" && String(e.reason).includes("boom")),
      "失败必须留下可回读的事件");
    assert.ok(warns.some((w) => w.includes("surface registration failed")));
  });
});

test("账本未装载时按未授权处理（fail-closed，不给无据的权限）", async () => {
  await withTemp("arm.", async (base) => {
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    // 故意不调用 load()
    const calls = [];
    const { installer } = makeInstaller({ arming, registerChildSurface: (a) => { calls.push(a.id); } });
    assert.equal(installer(makeAgent("child-Q", childHeader)), true);
    assert.deepEqual(calls, [], "未装载 = 无授权依据 = 不注册");
  });
});

test("项目不一致时不绑定（审核 B5：父项目与授权项目对齐才放行）", async () => {
  await withTemp("arm.", async (base) => {
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    await arming.arm({ parentSessionId: "parent-1", projectPath: "/another-repo", purpose: "x" });
    const calls = [];
    const { installer } = makeInstaller({ arming, registerChildSurface: (a) => { calls.push(a.id); } });
    assert.equal(installer(makeAgent("child-M", childHeader)), true);
    assert.deepEqual(calls, [], "父级判定项目与授权项目不一致时不得放行");
  });
});

test("授权账跨实例复原：重建后同一分身仍可复用绑定，别的仍不可", async () => {
  await withTemp("arm.", async (base) => {
    const home = dshHome(join(base, "home"));
    const first = createExperienceArming({ dshHomePath: home });
    await first.arm({ parentSessionId: "parent-1", projectPath: "/repo", purpose: "x" });
    first.bindForChild({ parentSessionId: "parent-1", childSessionId: "child-R", projectPath: "/repo" });
    // 绑定是 fire-and-forget 落盘（不阻塞同步的安装路径），故等它真的写出来再断言——
    // 轮询而不是固定 sleep：固定 sleep 只在快机器上绿，是假过的另一种写法。
    const ledgerFile = first.ledgerPath();   // 是函数：之前直接取属性拿到的是函数对象
    const { readFile } = await import("node:fs/promises");
    let landed = false;
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await readFile(ledgerFile, "utf8")).includes("child-R")) { landed = true; break; }
      } catch { /* 尚未写出 */ }
      await new Promise((r) => setTimeout(r, 5));
    }
    // 必须断言「等到了」，否则循环空转到底也会继续往下走——那是一条恒过的用例，
    // 比没有用例更糟（它让人以为落盘被验证过）。
    assert.equal(landed, true, `绑定未落盘（授权账 ${ledgerFile} 中找不到 child-R）`);

    const second = createExperienceArming({ dshHomePath: home });
    await second.load();
    assert.equal(second.verifyWrite({ childSessionId: "child-R", projectPath: "/repo" }).ok, true,
      "插件热重建后，已绑定的分身不得被静默剥夺能力");
    assert.equal(second.verifyWrite({ childSessionId: "child-OTHER", projectPath: "/repo" }).ok, false);
  });
});

test("ttl 上限被夹住：传入超过 1 小时按 1 小时计", async () => {
  await withTemp("arm.", async (base) => {
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    const r = await arming.arm({ parentSessionId: "p", projectPath: "/repo", purpose: "x", ttlMs: 10 * 60 * 60 * 1000 });
    assert.equal(r.ok, true);
    const life = new Date(r.value.arming.expires_at).getTime() - new Date(r.value.arming.armed_at).getTime();
    assert.equal(life, 60 * 60 * 1000, "授权不得成为永久资产");
  });
});

test("无用途的授权被拒：事后读不懂的授权等于不可核验", async () => {
  await withTemp("arm.", async (base) => {
    const arming = createExperienceArming({ dshHomePath: dshHome(join(base, "home")) });
    assert.equal((await arming.arm({ parentSessionId: "p", projectPath: "/repo", purpose: "  " })).ok, false);
    assert.equal((await arming.arm({ parentSessionId: "p", purpose: "x" })).ok, false, "缺项目路径同样拒");
  });
});

// ---------------------------------------------------------------------------
// 载体权限与并发（07 §5.6 同层纪律；本批用例是我自查上一轮遗漏时补上的）
//
// 上一轮的错误：修了权限却没有一条断言打到它——与我自己批评的「新增防护无直打
// 用例」（pitfall-b79dc397）同一形态。故此处不仅断言，还对断言做变异检验：
// 把 mode 选项删掉后必须变红，否则这条用例等于没写。
// ---------------------------------------------------------------------------

test("授权账以 0600 落盘：含会话标识与项目路径，世界可读即泄漏", async () => {
  await withTemp("arm.", async (base) => {
    const home = join(base, "home");
    const arming = createExperienceArming({ dshHomePath: dshHome(home) });
    await arming.arm({ parentSessionId: "p1", projectPath: "/repo", purpose: "x" });
    const { stat, readFile } = await import("node:fs/promises");
    if (process.platform !== "win32") {
      const fileMode = (await stat(arming.ledgerPath())).mode & 0o777;
      assert.equal(fileMode, 0o600, `授权账权限为 ${fileMode.toString(8)}，宽于 0600 即泄漏会话标识`);
      const dirMode = (await stat(join(home, "ldvh"))).mode & 0o777;
      assert.equal(dirMode, 0o700, `载体目录权限为 ${dirMode.toString(8)}，管辖载体同层取 0700`);
    }
    // Windows 无 POSIX mode：Node 在 win32 只暴露只读位，stat().mode & 0o777
    // 恒为 0o666/0o777，0600/0700 不可判定——按红线4 如实登记为未覆盖，
    // 不拿「Windows 上跑过」冒充权限防护已验收。下面的可读回断言仍照常验证。
    // 落盘内容仍须可读回（收紧权限不得把功能一起关掉）
    assert.ok((await readFile(arming.ledgerPath(), "utf8")).includes("p1"));
  });
});

test("既有 0644 载体在下次写入时被收紧为 0600（存量不靠人工补救）", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows 无 POSIX mode，无法构造 0644 前置条件；0600 收紧按红线4 登记为未覆盖");
  }
  await withTemp("arm.", async (base) => {
    const home = join(base, "home");
    const { mkdir, writeFile, chmod, stat } = await import("node:fs/promises");
    const dir = join(home, "ldvh");
    await mkdir(dir, { recursive: true });
    // 模拟修复前遗留的宽权限载体
    await writeFile(join(dir, "experience-arming.json"), JSON.stringify({ version: 1, entries: [] }), { mode: 0o644 });
    await chmod(join(dir, "experience-arming.json"), 0o644);
    assert.equal((await stat(join(dir, "experience-arming.json"))).mode & 0o777, 0o644, "前置条件：造出宽权限存量");

    const arming = createExperienceArming({ dshHomePath: dshHome(home) });
    await arming.load();
    await arming.arm({ parentSessionId: "p2", projectPath: "/repo", purpose: "x" });
    const mode = (await stat(arming.ledgerPath())).mode & 0o777;
    assert.equal(mode, 0o600, `原子替换后权限未收紧（实际 ${mode.toString(8)}）——存量宽权限会一直留在那`);
  });
});

test("两个实例并发写账：不得丢条目（锁与串行链各管一层竞态）", async () => {
  await withTemp("arm.", async (base) => {
    const home = join(base, "home");
    const a = createExperienceArming({ dshHomePath: dshHome(home) });
    const b = createExperienceArming({ dshHomePath: dshHome(home) });
    await a.load(); await b.load();
    // 各自持有独立内存快照，交错写同一文件：无跨进程锁时后写者会用整账快照
    // 覆盖前写者，使其中一条授权凭空消失（分身随后静默拿不到能力面）。
    await Promise.all([
      a.arm({ parentSessionId: "p-a", projectPath: "/repo", purpose: "A" }),
      b.arm({ parentSessionId: "p-b", projectPath: "/repo", purpose: "B" })
    ]);
    const reloaded = createExperienceArming({ dshHomePath: dshHome(home) });
    await reloaded.load();
    const ids = reloaded.list().map((e) => e.parent_session_id).sort();
    assert.deepEqual(ids, ["p-a", "p-b"], "两条授权都必须留在账上");
  });
});
