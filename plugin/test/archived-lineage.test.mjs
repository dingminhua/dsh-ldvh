/**
 * 归档血缘守卫的契约（2026-10-31，实测根因）。
 *
 * ## 这组测试守的是什么
 *
 * 宿主的 `ArchivedSessionGate`（`dsh-api-session-controller/lib/index.js:2509`，
 * `:2979` 无条件挂载）让**归档血缘下的每一个执行体**在 `agent/pre-step` 被 reject，
 * `turn/end reason={kind:"blocked"}`。实测：审核执行体 `78f975c2` 的父会话
 * `session-9d57cb22` 在归档集合里，该执行体 10 个事件、19 毫秒、一条 assistant
 * 消息都没有，`stopReason` 被 `dsh-subagent` 映射为 `refusal`（`lib/index.js:231`）。
 *
 * 插件改不了宿主门禁，但可以**不去撞它**：派发前判一次血缘，命中即不派发并如实
 * 记账。这里钉住三件事：
 *
 *   1. 判定规则与宿主 `underArchivedSession` **逐条对齐**——自身或祖先任一命中即
 *      命中；`origin !== "subagent"` 或 `parentSession === undefined` 即停；
 *   2. **探不到不等于被归档**。服务缺失、会话头读不到时按未归档处理并带回原因：
 *      把「探不到」当「被归档」会让审核在本可运行时永久停摆，那是另一种不可见失效；
 *   3. 不向上无限走——`visited` 防环。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnderArchivedLineage, resolveArchiveServices } from "../lib/archived-lineage.js";

/** 造一个只提供 `archivedSessionIds` 的注册表。 */
function registry(ids) {
  return { archivedSessionIds: ids };
}

/** 造一个只提供 `get(id)` 的 sessions 服务。 */
function sessionsOf(map) {
  return {
    get(id) {
      return map[id];
    },
  };
}

test("自身在归档集合内 → 命中", () => {
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-a"]),
    sessions: sessionsOf({}),
    sessionId: "session-a",
  });
  assert.equal(r.archived, true);
  assert.equal(r.checked, true);
});

test("父会话在归档集合内 → 命中（这是实测的那条路径）", () => {
  // 复核执行体的 header：origin=subagent、parentSession 指向归档会话。
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-parent"]),
    sessions: sessionsOf({
      "session-child": { header: { id: "session-child", origin: "subagent", parentSession: "session-parent" } },
      "session-parent": { header: { id: "session-parent", origin: "root" } },
    }),
    sessionId: "session-child",
  });
  assert.equal(r.archived, true);
  assert.equal(r.checked, true);
});

test("隔一代的祖先在归档集合内 → 命中（要一路向上）", () => {
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-grand"]),
    sessions: sessionsOf({
      "session-child": { header: { id: "session-child", origin: "subagent", parentSession: "session-mid" } },
      "session-mid": { header: { id: "session-mid", origin: "subagent", parentSession: "session-grand" } },
      "session-grand": { header: { id: "session-grand", origin: "root" } },
    }),
    sessionId: "session-child",
  });
  assert.equal(r.archived, true);
});

test("血缘干净 → 不命中", () => {
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-other"]),
    sessions: sessionsOf({
      "session-child": { header: { id: "session-child", origin: "subagent", parentSession: "session-parent" } },
      "session-parent": { header: { id: "session-parent", origin: "root" } },
    }),
    sessionId: "session-child",
  });
  assert.equal(r.archived, false);
  assert.equal(r.checked, true);
});

test("**遍历到非子代理会话即停**：root 的 parentSession 不被跟进（与宿主同规则）", () => {
  // 宿主写的是 `if (header.origin !== "subagent" || header.parentSession === void 0) return false;`
  // ——一个 origin=root 的会话即便带了 parentSession 字段也不向上走。这条钉住该对齐。
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-unrelated"]),
    sessions: sessionsOf({
      "session-child": { header: { id: "session-child", origin: "subagent", parentSession: "session-root" } },
      // 故意让 root 带一个 parentSession 指向归档会话：若实现错误地跟进了它，本条会红。
      "session-root": { header: { id: "session-root", origin: "root", parentSession: "session-unrelated" } },
    }),
    sessionId: "session-child",
  });
  assert.equal(r.archived, false, "origin 非 subagent 时不得继续向上遍历");
});

test("**探不到归档集合 ≠ 被归档**：不阻断，但 checked=false 且带回原因", () => {
  const r = isUnderArchivedLineage({
    workspaceRegistry: null,
    sessions: sessionsOf({}),
    sessionId: "session-a",
  });
  assert.equal(r.archived, false, "探不到时不得阻断派发（否则审核永久停摆）");
  assert.equal(r.checked, false);
  assert.equal(r.reason, "archive-set-unavailable");
});

test("**没有会话 id ≠ 被归档**：同样不阻断并带回原因", () => {
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry([]),
    sessions: sessionsOf({}),
    sessionId: null,
  });
  assert.equal(r.archived, false);
  assert.equal(r.checked, false);
  assert.equal(r.reason, "session-id-unavailable");
});

test("会话头取不到时**按宿主口径**判父 id 是否归档，不无限向上", () => {
  // 宿主：`if (parent === void 0) return archived.includes(header.parentSession);`
  // 即取不到父会话时用「父 id 在不在归档集合」定论。
  const hit = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-parent"]),
    sessions: sessionsOf({
      "session-child": { header: { id: "session-child", origin: "subagent", parentSession: "session-parent" } },
    }),
    sessionId: "session-child",
  });
  assert.equal(hit.archived, true);

  const miss = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-other"]),
    sessions: sessionsOf({
      "session-child": { header: { id: "session-child", origin: "subagent", parentSession: "session-parent" } },
    }),
    sessionId: "session-child",
  });
  assert.equal(miss.archived, false);
});

test("环形血缘不得死循环", () => {
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry([]),
    sessions: sessionsOf({
      "session-a": { header: { id: "session-a", origin: "subagent", parentSession: "session-b" } },
      "session-b": { header: { id: "session-b", origin: "subagent", parentSession: "session-a" } },
    }),
    sessionId: "session-a",
  });
  assert.equal(r.archived, false);
  assert.equal(r.checked, true);
});

test("`resolveArchiveServices` 取不到服务时返回 null 而不是抛错", () => {
  assert.deepEqual(resolveArchiveServices(null), { workspaceRegistry: null, sessions: null });
  const throwing = {
    get() {
      throw new Error("service unavailable");
    },
  };
  assert.deepEqual(resolveArchiveServices(throwing), { workspaceRegistry: null, sessions: null });
  const ok = {
    get(name) {
      return name === "workspaceRegistry" ? registry([]) : sessionsOf({});
    },
  };
  const got = resolveArchiveServices(ok);
  assert.ok(got.workspaceRegistry !== null);
  assert.ok(got.sessions !== null);
});
