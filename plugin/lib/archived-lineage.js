/**
 * 归档血缘守卫——**不往会被宿主拒绝的血缘下派发执行体**。
 *
 * ## 为什么需要这个模块（2026-10-31 实测根因）
 *
 * 宿主的 `ArchivedSessionGate`（`dsh-api-session-controller/lib/index.js:2509`，
 * 在 `:2979` 无条件 `ctx.plugin` 挂载，不可配置）注册在 `agent/pre-step`：只要
 * 一个 Agent 的会话**自身或其子代理血缘上的任一祖先会话**在归档集合里，它提议的
 * 每一步都被 reject，`turn/end reason={kind:"blocked"}`。
 *
 * 实测：审核执行体 `78f975c2` 的 `parentSession` 是 `session-9d57cb22`，而后者在
 * `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`（59 个）里。
 * 该执行体 10 个事件、19 毫秒、`turn/end {kind:"blocked"}`、**一条 assistant 消息
 * 都没有**。`dsh-subagent` 把它映射为 `stopReason: "refusal"`（`lib/index.js:231`）。
 *
 * 后果不是「这次审核失败」那么轻：
 *   - 执行体从未产出判断，经验审核的提案为空 → 整批条目留在 pending；
 *   - 摩擦晋升虽在派发之前执行，但整段被外层锁包着，锁要等 `activation.result`
 *     结算才在 `finally` 里释放，而结算被门禁拖到超时 → 下一次静置撞锁跳过。
 *
 * ## 边界（如实声明）
 *
 * 本模块只做**只读探测**：读 `workspaceRegistry.archivedSessionIds` 与 `sessions`
 * 服务的会话头，沿 `origin === "subagent"` 的 `parentSession` 向上走——与宿主
 * `underArchivedSession` 的遍历规则**逐条对齐**（`origin !== "subagent"` 或
 * `parentSession === undefined` 即停；取不到父会话时按「父 id 是否在归档集合内」
 * 判定）。两者不一致时以宿主为准：本模块**只能**减少无效派发，不能保证宿主一定
 * 接受——若宿主将来改变规则，这里最坏退化为「照旧派发、照旧被拒」。
 *
 * 判不出来（服务取不到、会话头读不到）时返回 `{archived:false, reason}` 而**不**
 * 阻断派发：把「探不到」当成「被归档」会让审核在本可运行时永久停摆，那是另一种
 * 不可见失效。故探测失败按「未归档」处理，并**如实把原因带回**给调用方登记。
 */

/**
 * 宿主归档集合。取不到时返回 `null`（不是空集合——「没有归档」与「读不到」是
 * 两件事，前者可以据此放行，后者不能假装放行）。
 *
 * @param {object} workspaceRegistry - 宿主 `workspaceRegistry` 服务
 * @returns {Set<string>|null}
 */
function archivedSet(workspaceRegistry) {
  try {
    const ids = workspaceRegistry?.archivedSessionIds;
    if (!Array.isArray(ids)) return null;
    return new Set(ids);
  } catch {
    return null;
  }
}

/**
 * 沿子代理血缘向上判断某个会话是否落在归档范围内。
 *
 * @param {object} args
 * @param {object|null} args.sessions - 宿主 `sessions` 服务（提供 `get(id)`）
 * @param {Set<string>} args.archived - 归档 id 集合
 * @param {string} args.sessionId - 待判定的会话 id
 * @returns {{archived: boolean, via: string|null}}
 */
function lineageArchived({ sessions, archived, sessionId }) {
  let id = sessionId;
  const visited = new Set();
  let via = null;
  while (typeof id === "string" && id.length > 0 && !visited.has(id)) {
    if (archived.has(id)) return { archived: true, via };
    visited.add(id);
    let header;
    try {
      header = sessions?.get?.(id)?.header;
    } catch {
      header = undefined;
    }
    if (header === undefined || header === null) {
      // 与宿主一致：父会话取不到时，按「父 id 是否在归档集合内」判定，不再向上。
      // 宿主在同一位置 `return archived.includes(header.parentSession)`。
      return { archived: false, via };
    }
    if (header.origin !== "subagent" || header.parentSession === undefined) {
      return { archived: false, via };
    }
    via = header.parentSession;
    id = header.parentSession;
  }
  return { archived: false, via };
}

/**
 * 判定「当前会话是否处于归档血缘下」。
 *
 * @param {object} args
 * @param {object|null} args.workspaceRegistry - 宿主 `workspaceRegistry` 服务
 * @param {object|null} args.sessions - 宿主 `sessions` 服务
 * @param {string|null} args.sessionId - 当前（父）会话 id
 * @returns {{archived: boolean, checked: boolean, reason: string|null, via: string|null}}
 *   `checked:false` 表示探测没能完成——调用方**仍可派发**，但应把 `reason` 登记下来。
 */
export function isUnderArchivedLineage({ workspaceRegistry, sessions, sessionId }) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { archived: false, checked: false, reason: "session-id-unavailable", via: null };
  }
  const archived = archivedSet(workspaceRegistry);
  if (archived === null) {
    return { archived: false, checked: false, reason: "archive-set-unavailable", via: null };
  }
  const result = lineageArchived({ sessions, archived, sessionId });
  return { archived: result.archived, checked: true, reason: null, via: result.via };
}

/**
 * 从宿主上下文中取本判定所需的两个服务。
 *
 * @param {object|null} ctx - 宿主上下文（`ctx.get(name)` 为可选查找）
 * @returns {{workspaceRegistry: object|null, sessions: object|null}}
 */
export function resolveArchiveServices(ctx) {
  const pick = (name) => {
    try {
      return ctx?.get?.(name) ?? null;
    } catch {
      return null;
    }
  };
  return { workspaceRegistry: pick("workspaceRegistry"), sessions: pick("sessions") };
}
