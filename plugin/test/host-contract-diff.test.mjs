import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { withTemp, git } from "./helpers.mjs";
import { runDiff } from "../scripts/host-contract-diff.mjs";
import { CATALOG_PATHS } from "../lib/host-contract-catalog.js";

function apiCatalog({ services, events, types }) {
  const render = (arr, entries) => `export const ${arr}: readonly unknown[] = [\n${entries.join("\n")}\n];\n`;
  return [
    render("SERVICE_API", services),
    render("EVENT_API", events),
    render("TYPE_API", types),
  ].join("\n");
}

function slotCatalog(slots) {
  return `export const CLIENT_SLOT_API: readonly unknown[] = [\n${slots.join("\n")}\n];\n`;
}

const SVC = {
  kept: (methods, summary = "s") => `  {\n    key: 'tools',\n    summary: '${summary}',\n    description: 'd',\n    methods: [${methods}],\n  }`,
  stable: (summary = "s") => `  {\n    key: 'stable',\n    summary: '${summary}',\n    description: 'd',\n    methods: ['m(): void'],\n  }`,
  removable: `  {\n    key: 'removable',\n    summary: 's',\n    description: 'd',\n    methods: ['m(): void'],\n  }`,
};

function seedRepo(root) {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "LDVH Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "ldvh-test@example.com"], { cwd: root });

  const writeCatalogs = ({ services, slots, guides }) => {
    for (const [rel, body] of Object.entries({
      [CATALOG_PATHS.api]: apiCatalog({ services, events: [], types: [] }),
      [CATALOG_PATHS.slot]: slotCatalog(slots),
    })) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body, "utf8");
    }
    for (const [rel, body] of Object.entries(guides)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body, "utf8");
    }
  };

  const SLOT = `  {\n    key: 'conversation.view',\n    kind: 'component',\n    scope: 'session',\n    summary: 's',\n  }`;

  writeCatalogs({
    services: [SVC.kept("'register(): void'"), SVC.stable(), SVC.removable],
    slots: [SLOT],
    guides: {},
  });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  execFileSync("git", ["tag", "dsh-v0.2.1-rc.1"], { cwd: root });

  writeCatalogs({
    services: [
      SVC.kept("'register(x: number): void'"),
      SVC.stable("changed-summary"),
    ],
    slots: [SLOT],
    guides: {
      "docs/upgrade-guide/v0.2.2-rc.1/tools-removed/guide.md":
        "---\ndescription: tools register signature changed, consume tools methods\n---\nbody mentions nothing relevant.",
    },
  });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "target"], { cwd: root });
  execFileSync("git", ["tag", "dsh-v0.2.2-rc.1"], { cwd: root });
}

const consumption = {
  hostServices: [{ key: "tools" }, { key: "stable" }, { key: "removable" }],
  hostEvents: [],
  clientSlots: [{ key: "conversation.view" }],
  valueServices: [],
  clientServices: [],
  nonContract: [],
};

test("三态判定：消费面服务删除/契约字段变更落破坏，噪音字段变更落须审", async () => {
  await withTemp("ldvh-diff-fixture-", (root) => {
    seedRepo(root);
    const r = runDiff({ repo: root, baseTag: "dsh-v0.2.1-rc.1", targetTag: "dsh-v0.2.2-rc.1", consumption });

    assert.deepEqual(r.tables.services.tri.breaking.removed, ["removable"]);
    const changedIds = r.tables.services.tri.breaking.changed.map((c) => c.id);
    assert.ok(changedIds.includes("tools"), "tools 的 methods 契约变更须落破坏初值");
    assert.equal(r.tables.services.tri.breaking.changed.find((c) => c.id === "tools").contractFields.includes("methods"), true);
    assert.deepEqual(r.tables.services.tri.review.noiseOnConsumed.map((c) => c.id), ["stable"], "summary 是噪音字段，须落须审而非破坏");
    assert.equal(r.tables.services.tri.neutral.added, 0);
  });
});

test("upgrade-guide 强匹配：消费面 token 出现在 version/item/description 时判 strong 且不被文本噪音漏掉", async () => {
  await withTemp("ldvh-diff-fixture-", (root) => {
    seedRepo(root);
    const r = runDiff({ repo: root, baseTag: "dsh-v0.2.1-rc.1", targetTag: "dsh-v0.2.2-rc.1", consumption });
    const strong = r.upgradeGuides.matched.filter((g) => g.match === "strong").map((g) => g.item);
    assert.ok(strong.includes("tools-removed"), "guide 的 description 含消费面 token 'tools'，须强匹配");
    assert.equal(r.upgradeGuides.totalAdded, 1);
  });
});

test("区间反向或 tag 缺失时 fail-closed（不降级为零变更）", async () => {
  await withTemp("ldvh-diff-fixture-", (root) => {
    seedRepo(root);
    assert.throws(
      () => runDiff({ repo: root, baseTag: "dsh-v0.2.2-rc.1", targetTag: "dsh-v0.2.1-rc.1", consumption }),
      /不低于目标|不可判定|区间/,
      "基线高于目标时须拒绝，不得出零变更报告",
    );
    assert.throws(
      () => runDiff({ repo: root, baseTag: "dsh-v0.2.1-rc.1", targetTag: "dsh-v9.9.9", consumption }),
      /无 tag|不可判定/,
      "目标 tag 缺失时须拒绝",
    );
  });
});
