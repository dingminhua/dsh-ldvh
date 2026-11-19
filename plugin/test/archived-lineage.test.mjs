import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnderArchivedLineage, resolveArchiveServices } from "../lib/archived-lineage.js";

function registry(ids) {
  return { archivedSessionIds: ids };
}

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
  const r = isUnderArchivedLineage({
    workspaceRegistry: registry(["session-unrelated"]),
    sessions: sessionsOf({
      "session-child": { header: { id: "session-child", origin: "subagent", parentSession: "session-root" } },
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
