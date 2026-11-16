/**
 * dsh-ldvh — 经验记录分身的**开工授权**（Human 决定 2026-11-16）。
 *
 * ## 它解决什么
 *
 * Human 定的机制：主控发现一条值得记的经验后派生一个**继承本对话上下文**的分身，
 * 由该分身自行查重、起草七段、自检并经受控入口写入 `active` Pitfall；主控只做
 * 存在性读回与当次报告。要跑得起来，必须把「Pitfall 那三个工具」给那一个分身，
 * 而 `child.js` 的既有声明是「子代理刻意比根会话轻——不注册工具」。
 *
 * 本模块是那条例外的**唯一授权来源**：它记录「某个根会话，在某个时刻，明确开工
 * 授权了它的下一个分身」。没有这条记录，子代理一个工具都拿不到。
 *
 * ## 为什么必须由插件自持，而不是读宿主字段
 *
 * 独立审核（2026-11-16，只读实测）确认：宿主的 `SessionHeader` 只有
 * `cwd / parentSession / isSeeded / origin / delegationDepth / agentPreset`，
 * **没有任何「这次委派是干什么的」标记**；`label` 只落在会话日志的
 * `subagent/descriptor` 事件里，而 `agentPreset` 在「继承上下文」的 fork provider
 * 上不可用（该 provider `capabilities.agentPreset === false`）。因此「只给那一个
 * 分身」无法仅凭宿主字段判定，只能由发起方留一条可回指的记录。
 *
 * ## 四条机械纪律（都是审核发现的直接后果，不是装饰）
 *
 * 1. **一次性**：一条开工授权只能绑定**一个**子会话。绑定后重复校验只对同一子会话
 *    成立（插件热重建后该分身可复原），**不会**给同一父会话的下一个分身——那正是
 *    审核 B6 指出的「后续任意子代理继承三工具」破口。
 * 2. **会过期**：默认 15 分钟，上限 1 小时。授权不能是永久资产。
 * 3. **落盘**：内存 Map 不够——插件重建即失，会使已开工的分身静默丢能力。故每次
 *    变更原子写入 DSH home，装载时读回。**装载前不判定为已授权**（fail-closed），
 *    宁可漏授权也不给无据的权限。
 * 4. **对齐项目**（审核 B5）：注册按父级继承判定、写入按子级 cwd 自判，两者可错位
 *    到**另一个**受辖项目。故记录父级判定的项目路径，写入侧据此核对，不一致即拒。
 *
 * 与待处置队列（pending-queue.js）同一载体纪律：位于 DSH home 之下、**不进入事实
 * 源**、不是事实对象、不走受控写入；它是授权运行状态，只追加与就地绑定，不保留
 * 任何分身产物正文。
 */

import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
// 与受保护的管辖登记载体（governed-projects.js，07 §5.6）同一套落盘写法：
// 自带目录创建、0600 权限、原子替换与跨进程文件锁。
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";

/** 载体位置（与 governed-projects / pending-queue 同层）。 */
const ARMING_RELATIVE_PATH = ["ldvh", "experience-arming.json"];

/** 默认与上限存活时长：过期即不可再绑定，也不参与复原。 */
export const DEFAULT_ARM_TTL_MS = 15 * 60 * 1000;
export const MAX_ARM_TTL_MS = 60 * 60 * 1000;

/** 留存上限：这是授权账，不是历史档案；超出按最旧淘汰。 */
const MAX_ENTRIES = 20;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function ok(value) { return { ok: true, value }; }
function fail(reason, detail) { return { ok: false, reason, ...(detail ? { detail } : {}) }; }

/**
 * 授权账：内存 Map + 落盘副本。
 *
 * 为什么把 load() 与 arm() 分开而不让 consume 自己读文件：`installChild` 发生在
 * 宿主 `agent/created` 的同步路径上（其 effect 回调也要求同步返回 cleanup），
 * 在那儿 await 一次文件读取会改变安装时序。故装载提前做、消费就地判，持久化在
 * 写入侧 await 完成——「已授权」这句话只有在落盘回执到手后才说出口。
 */
export function createExperienceArming({ dshHomePath, logger = console, now = () => Date.now() }) {
  const entries = new Map();
  let loaded = false;
  let loading = null;
  let writeChain = Promise.resolve();

  function path() {
    return dshHomePath(...ARMING_RELATIVE_PATH);
  }

  function prune() {
    const t = now();
    for (const [id, entry] of entries) {
      if (new Date(entry.expires_at).getTime() <= t) entries.delete(id);
    }
    while (entries.size > MAX_ENTRIES) {
      entries.delete(entries.keys().next().value); // Map 插入序即时间序
    }
  }

  /** 读回授权账。不可读不是错误状态：按「无授权」处理并留痕（fail-closed）。 */
  async function load() {
    if (loaded) return ok({ loaded: true, count: entries.size, source: "cache" });
    if (loading !== null) return loading;
    loading = (async () => {
      try {
        const text = await readFile(path(), "utf8");
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
        for (const entry of list) {
          if (!isNonEmptyString(entry?.arming_id) || !isNonEmptyString(entry?.parent_session_id)) continue;
          entries.set(entry.arming_id, entry);
        }
        prune();
        loaded = true;
        return ok({ loaded: true, count: entries.size, source: "file" });
      } catch (error) {
        loaded = true; // 认定「读过了，没有」；否则每次安装都要重试
        if (error?.code !== "ENOENT") {
          logger.warn("[dsh-ldvh] experience arming ledger unreadable, treated as empty: %s", String(error?.message ?? error));
        }
        return ok({ loaded: true, count: 0, source: error?.code === "ENOENT" ? "absent" : "unreadable" });
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  /**
   * 锁内先并入盘上现状，再整体写回（read-modify-write）。
   *
   * 为什么不能直接写本地快照：本模块的 persist 写的是**整账快照**。宿主重启期、
   * 插件 fiber 重建期或并存第二个宿主进程都会各自持有一份内存 Map，若各写各的快照，
   * 后写者会把先写者刚记下的授权**整条抹掉**——表现为「主控明明记了授权，分身却
   * 拿不到工具面」，且无任何报错。跨进程锁只保证不互相踩写，不保证内容合并，
   * 二者不能互相替代（这条由本仓用例 `两个实例并发写账` 打到，变异检验见测试注记）。
   *
   * 合并取向按字段的单调性定：
   *   · 盘上有、本地无 → 收下（别人记的授权）。
   *   · 同 id 且本地未绑定而盘上已绑定 → **保留盘上的绑定**；绑定是单调推进的，
   *     把它退回未绑定等于让已上岗的分身静默失能。
   *   · 其余以本地为准（本地可能刚更新了绑定或存活期）。
   */
  async function mergeFromDisk(target) {
    let diskEntries = [];
    try {
      const parsed = JSON.parse(await readFile(target, "utf8"));
      if (Array.isArray(parsed?.entries)) diskEntries = parsed.entries;
    } catch (error) {
      if (error?.code !== "ENOENT" && error instanceof SyntaxError === false) throw error;
      // ENOENT = 尚无账；SyntaxError = 半截文件（理论上被原子替换排除，出现即按空账
      // 继续，但留下痕迹——静默当作空等于把丢账说成没发生过）
      if (error instanceof SyntaxError) {
        logger.warn("[dsh-ldvh] experience arming ledger is not valid JSON, merging as empty: %s", String(error?.message ?? error));
      }
    }
    for (const disk of diskEntries) {
      if (!isNonEmptyString(disk?.arming_id) || !isNonEmptyString(disk?.parent_session_id)) continue;
      const mine = entries.get(disk.arming_id);
      if (mine === undefined) { entries.set(disk.arming_id, disk); continue; }
      if (mine.child_session_id === null && isNonEmptyString(disk.child_session_id)) {
        entries.set(disk.arming_id, {
          ...mine,
          child_session_id: disk.child_session_id,
          consumed_at: disk.consumed_at ?? mine.consumed_at
        });
      }
    }
    prune();
  }

  /**
   * 落盘授权账。
   *
   * 三件事都由仓内既有的 `@deepseek-ai/dsh-atomic-write` 承担（受保护的管辖登记
   * 载体用的就是它，07 §5.6），本模块不再自带一套写法：
   *   · **权限 0600**——授权账含会话标识与项目路径，世界可读（0644）会把「哪个
   *     会话被授过权」暴露给同机其他用户；管辖登记载体同层数据即取 0600。
   *   · **原子替换**——不留半截文件；崩溃在写入中途时读到的仍是完整旧账。
   *   · **跨进程加锁 + 锁内合并**——见 mergeFromDisk。
   *
   * 本地 writeChain 仍保留：它保证同一进程内的先后次序，锁保证跨进程不互踩，
   * 合并保证不互抹，三者管的是不同的竞态，不能互相替代。
   */
  function persist() {
    writeChain = writeChain.then(async () => {
      const target = path();
      // 顺序照 governed-projects.js:412——**先建目录再加锁**。锁文件与载体同目录
      // （`<target>.lock`），而 writeFileAtomic 的目录创建发生在锁**之后**，首启时
      // 目录尚不存在，锁文件就 ENOENT（本次改动首跑即由此暴露）。
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await withFileLock(target, async () => {
        await mergeFromDisk(target);
        const snapshot = JSON.stringify({ version: 1, entries: [...entries.values()] }, null, 2);
        await writeFileAtomic(target, snapshot, { mode: 0o600, dirMode: 0o700 });
      });
    });
    return writeChain;
  }

  /**
   * 记一条开工授权（由根会话的工具入口调用）。
   *
   * `purpose` 必填：授权账要能被事后读懂「这条是给什么用的」。没有用途的授权记录
   * 与一串无语义 token 等价， Human 翻账时无法判断该不该撤销。
   */
  async function arm({ parentSessionId, projectPath, projectId, purpose, ttlMs }) {
    if (!isNonEmptyString(parentSessionId)) return fail("parent_session_id_required");
    if (!isNonEmptyString(projectPath)) return fail("project_path_required", "授权必须绑定到父会话判定的受辖项目（审核 B5）");
    if (!isNonEmptyString(purpose)) return fail("purpose_required", "一条没有用途的授权无法被事后读懂，故拒绝");
    const t = now();
    const raw = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, MAX_ARM_TTL_MS) : DEFAULT_ARM_TTL_MS;
    const entry = {
      arming_id: randomUUID(),
      parent_session_id: parentSessionId.trim(),
      child_session_id: null,
      project_path: resolve(projectPath),
      project_id: isNonEmptyString(projectId) ? projectId.trim() : null,
      purpose: purpose.trim(),
      armed_at: new Date(t).toISOString(),
      expires_at: new Date(t + raw).toISOString(),
      consumed_at: null
    };
    await load();
    prune();
    entries.set(entry.arming_id, entry);
    await persist(); // 回执到手才算授权成立
    return ok({ arming: entry });
  }

  /**
   * 为一个刚安装的分身匹配并绑定一条授权（**同步**，供 installChild 调用）。
   *
   * 判据三条同时成立：父会话相符、项目相符、未被别的分身占走（或已被**本分身**占走
   * ——插件热重建后同一分身的复原路径）。命中即就地绑定 `child_session_id`。
   */
  function bindForChild({ parentSessionId, childSessionId, projectPath }) {
    if (!loaded) return fail("ledger_not_loaded", "授权账尚未读回，按未授权处理（fail-closed）");
    if (!isNonEmptyString(parentSessionId) || !isNonEmptyString(childSessionId)) return fail("session_ids_required");
    prune();
    const wantProject = isNonEmptyString(projectPath) ? resolve(projectPath) : null;
    for (const entry of entries.values()) {
      if (entry.parent_session_id !== parentSessionId.trim()) continue;
      if (entry.child_session_id !== null && entry.child_session_id !== childSessionId) continue;
      if (wantProject !== null && resolve(entry.project_path) !== wantProject) continue;
      const rebinding = entry.child_session_id === childSessionId;
      entry.child_session_id = childSessionId;
      if (entry.consumed_at === null) entry.consumed_at = new Date(now()).toISOString();
      // 绑定结果必须落盘，否则重建后又会给同一父会话的下一个分身授权。写失败不回收
      // 本次授权（分身已装上工具），但要留痕：下次重建时它会失去绑定。
      persist().catch((error) => {
        logger.warn("[dsh-ldvh] experience arming bind not persisted for %s: %s", childSessionId, String(error?.message ?? error));
      });
      return ok({ arming: entry, rebinding });
    }
    return fail("no_arming_for_parent");
  }

  /** 写入侧的复核：该子会话是否确实被授权、授权是否属于该项目、是否仍在存活期内。 */
  function verifyWrite({ childSessionId, projectPath }) {
    if (!loaded) return fail("ledger_not_loaded");
    // **不在这里先 prune**：先淘汰再查，过期条目已被整条删除，`arming_expired`
    // 就成了永远报不出来的死分支——调用方只能看到 `child_not_armed`。这两个理由
    // 对读者是不同的事实：「从没被授权」与「被授权过但已过期」决定下一步是「回去
    // 找主控」还是「催一次新的开工授权」，不可混为一谈。故先按原样查，再淘汰。
    for (const entry of entries.values()) {
      if (entry.child_session_id !== childSessionId) continue;
      if (new Date(entry.expires_at).getTime() <= now()) {
        prune();
        return fail("arming_expired", "该分身的开工授权已过存活期；需主控重新记一条开工授权，不要重试");
      }
      if (isNonEmptyString(projectPath) && resolve(entry.project_path) !== resolve(projectPath)) {
        return fail("project_mismatch", "分身被授权的项目与本次写入判定的项目不一致（审核 B5）");
      }
      return ok({ arming: entry });
    }
    prune();
    return fail("child_not_armed");
  }

  /** 诊断取数：当前账上有哪些授权与绑定状态（不含任何正文）。 */
  function list() {
    prune();
    return [...entries.values()];
  }

  return { load, arm, bindForChild, verifyWrite, list, ledgerPath: path };
}
