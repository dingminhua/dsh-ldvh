// dsh-ldvh — 零上下文 subagent provider 的发现与挑选（宿主 0.2.2-rc.2 起）。
//
// ── 为什么要这个模块 ────────────────────────────────────────────────────────
//
// 三处受管辖隔离子代理的派发（摩擦发现、建前独立审核、经验审核）都需要先回答
// 「有哪些 provider、哪个是零上下文的」，原实现统一调用 `ctx.subagents.list()`。
// **该方法已在宿主 0.2.2-rc.2 被删除**（上游提交 86d4c75516「Remove unused
// public subagent service methods」，同批还删了 `drainChildren` /
// `listChildren` / `interruptByParent`；官方指南 docs/upgrade-guide/
// v0.2.1-rc.2/subagent-service-methods 明写 "The service no longer enumerates
// all registered names"）。缺失时调用抛 TypeError，被三处的 try 兜住后各自
// 降级成 `unavailable`——插件不崩，但**独立审核与摩擦发现整体空转**，这正是
// 最坏的一种失效：看起来跑过了，实际一个结论都没产出。
//
// 官方给的迁移是「用 getProvider(name) 查已知名」，但本模块的用途恰恰相反：
// 我们不知道装了哪些 provider，需要**枚举**才能挑出零上下文的那个。故改走宿主
// 早已存在、且 rc.2 仍保留的注册期事件通道：
//
//   `subagent/provider-added`   (provider) → 记入名册
//   `subagent/provider-removed` (name)     → 移出名册
//
// 两个事件都是普通 `emit`（**不带 scoped carrier**——`createLifecycleEmitter`
// 只给 start/end 加 carrier，provider-removed 的注释明写 "Provider removal
// reaches all scopes"），因此在插件根 ctx 上监听即可收到全部注册。
//
// ── 为什么还要回退到 getProvider ────────────────────────────────────────────
//
// 事件只在**注册时**发一次。若本插件在 provider 注册之后才装载（插件重载、宿主
// 早启动完成后再挂插件），名册会是空的，而 provider 其实好端端在服务上。故挑选
// 时对名册里每个名字都现查一次 `getProvider(name)`：
//   · 现查得到 → 用它（事件名册只决定「查谁」，权威永远是服务本身）；
//   · 现查不到 → 名字已过期，剔除，不据事件缓存下判断。
// 若名册为空但有**已知内置名**候选，仍尝试现查——这是唯一能覆盖「先注册后装载」
// 顺序的通道，且失败只会得到 undefined，不产生虚假可用。
//
// 无任何零上下文 provider 时**一律 fail-closed**，绝不退回 `fork`：`fork` 的
// `inheritsParentContext === true`，会把父会话的完整历史交付执行体，违反
// 11 §7.1/§10.2「禁止全量交付（须零上下文派生 + 调度侧机械交付有界材料）」。
const KNOWN_PROVIDER_NAMES = Object.freeze(["spawn"]);

/**
 * 宿主 provider 名册：订阅注册期事件，维护「当前已注册的 provider 名」。
 *
 * 名册只是**候选名单**，不是可用性的判据——见模块首部说明。所有读取方都必须
 * 现查 `getProvider`。名册不持有 provider 对象，故不会因卸载而留下陈旧能力位。
 *
 * **订阅一律写成 `ctx.on("字面量", …)` 的内联形态**，不经 `subscribe(name)` 包装
 * 转发。理由不是风格：消费面清单由 `host-consumption-consistency.test.mjs` 从
 * 源码机械提取 `.on("…")` 字面量，变量转发会让这两个宿主事件**从清单里消失**，
 * 而清单正是升级三态判定的比对基准——漏登 = 日后宿主删改这两个事件时差分器
 * 无声放过。宁可重复三行样板，也不让一个真实的消费点对机械层不可见。
 *
 * @param {object} ctx - 插件根 Context（`.on` 可用即可；虚构 ctx 下容忍缺失）
 * @returns {{names:()=>string[], dispose:()=>void}}
 */
export function createProviderRoster(ctx) {
  const registered = new Set();
  const disposers = [];
  const keep = (dispose) => {
    if (typeof dispose === "function") disposers.push(dispose);
  };
  const canSubscribe = ctx !== null && ctx !== undefined && typeof ctx.on === "function";
  // 事件顺序上 provider-removed 可能先到（极端竞态），Set 语义天然幂等。
  if (canSubscribe) {
    try {
      keep(ctx.on("subagent/provider-added", (provider) => {
        const name = provider?.name;
        if (typeof name === "string" && name.length > 0) registered.add(name);
      }));
    } catch {
      // 订阅失败不得阻断插件装载：名册退化为空，挑选时仍有 getProvider 通道。
    }
    try {
      keep(ctx.on("subagent/provider-removed", (name) => {
        if (typeof name === "string") registered.delete(name);
      }));
    } catch {
      // 同上
    }
  }
  return {
    names: () => [...registered],
    dispose: () => {
      for (const d of disposers.splice(0)) {
        try { d(); } catch { /* disposer 失败不影响其余 */ }
      }
      registered.clear();
    },
  };
}

/**
 * 候选名集合：注册事件名册 ∪ 已知内置名。
 *
 * 已知内置名来自宿主包 `dsh-subagent-spawn-in-process` 的默认 `providerName`
 * （实测 asar 内 `z.string().default("spawn")`），用于覆盖「provider 已注册、
 * 本插件后装载」的顺序。这里**只补 name、不假设其存在**——每个候选都要经
 * `getProvider` 现查确认。
 *
 * @param {{names:()=>string[]}} roster - createProviderRoster 的返回
 * @returns {string[]} 去重后的候选名（名册顺序在前，内置名在后）
 */
export function providerCandidates(roster) {
  const out = [];
  const seen = new Set();
  const push = (name) => {
    if (typeof name !== "string" || name.length === 0 || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  let fromRoster = [];
  try {
    fromRoster = roster?.names?.() ?? [];
  } catch {
    fromRoster = [];
  }
  for (const name of fromRoster) push(name);
  for (const name of KNOWN_PROVIDER_NAMES) push(name);
  return out;
}

/**
 * 挑选零上下文的 provider。
 *
 * 判据顺序（与 2026-10-12 规范修订一致）：
 *   1. `inheritsParentContext === false` 是**硬条件**——继承父上下文的 provider
 *      已经读过父会话，独立性不成立，也不满足「零上下文派生」；
 *   2. 其中优先具备 `capabilities.outputSchema`（能把语义判断升为机械校验）；
 *   3. 再优先内置 `spawn`（宿主实测名，能力面最全）；否则取第一个合格者。
 *
 * fail-closed，**不退化为任意 provider**：没有任何合格者时返回 `{ ok:false }`，
 * 由各调用点如实登记「不可用」，而不是挑一个凑一次。
 *
 * @param {object} subagents - 宿主 subagents 服务
 * @param {{names:()=>string[]}} roster - provider 名册（见 createProviderRoster）
 * @returns {{ok:true,value:{name:string,provider:object}} | {ok:false,error:{code:string,message:string}}}
 */
export function selectZeroContextProvider(subagents, roster) {
  if (subagents === null || subagents === undefined || typeof subagents.getProvider !== "function") {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: "the host subagents service exposes no getProvider(), so no provider can be resolved (0.2.2-rc.2 removed list())",
      },
    };
  }
  const candidates = providerCandidates(roster);
  if (candidates.length === 0) {
    return { ok: false, error: { code: "unavailable", message: "no subagent provider candidate is known" } };
  }

  // 现查：名册是候选，服务才是权威。逐个 getProvider，异常按「该名不可用」处理。
  const resolved = [];
  for (const name of candidates) {
    let provider;
    try {
      provider = subagents.getProvider(name);
    } catch {
      continue;
    }
    if (provider !== null && provider !== undefined) resolved.push({ name, provider });
  }
  if (resolved.length === 0) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: `no subagent provider is registered (candidates probed: ${candidates.join(", ")})`,
      },
    };
  }

  const zeroContext = resolved.filter((entry) => entry.provider?.inheritsParentContext === false);
  if (zeroContext.length === 0) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: `no registered subagent provider is zero-context (resolved: ${resolved.map((e) => e.name).join(", ")}) — zero-context spawn with scheduler-delivered bounded material is required; refusing to fall back to a context-inheriting provider (全量交付禁止)`,
      },
    };
  }
  const withSchema = zeroContext.filter((entry) => entry.provider?.capabilities?.outputSchema !== false);
  const chosen = withSchema.find((entry) => entry.name === "spawn") ?? withSchema[0] ?? zeroContext[0];
  return { ok: true, value: { name: chosen.name, provider: chosen.provider } };
}

/**
 * 记录「provider 已挑好」的一次派发，但**不判断可用性**——纯日志形状的辅助，
 * 供调用点在错误信息里带上本次实际探测到的候选，避免只写「不可用」而无从排查。
 *
 * @param {string[]} candidates - 本次探测的候选名
 * @returns {string} 可直接拼进错误消息的候选清单
 */
export function describeCandidates(candidates) {
  return Array.isArray(candidates) && candidates.length > 0 ? candidates.join(", ") : "(none)";
}
