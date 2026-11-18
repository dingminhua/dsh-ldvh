import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import { ToolsService } from "@deepseek-ai/dsh-tools";
import { createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import * as ldvhPlugin from "../lib/index.js";
import { createHostSeams, recordJudgementForGuard } from "../lib/host-seams.js";
import { createLifecycleRegistry } from "../lib/lifecycle.js";
import { createSessionScopes } from "../lib/session-scopes.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, withTemp } from "./helpers.mjs";


const LDVH_EVENT_LABELS = new Set([
  'ctx.on("system-prompt/assemble")',
  'ctx.on("agent/pre-step")',
  'ctx.on("agent/turn-stopping")',
  'ctx.on("agent/status")',
  'ctx.on("session/event")',
]);

const OTHER_EFFECT_LABEL = "other-plugin: agent effect";
const OTHER_TOOL_NAME = "other_plugin_tool";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(predicate, { timeout = 3000, interval = 10, label = "condition" } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let ready;
      try {
        ready = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (ready) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeout) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

class MemorySystemPrompt {
  tools() {
    return () => {};
  }
}

function otherToolDefinition() {
  return {
    name: OTHER_TOOL_NAME,
    description: "sentinel tool owned by another plugin",
    parameters: { type: "object", properties: {} },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: () => "",
    },
    async execute() {
      return {};
    },
  };
}

async function createHarness(base) {
  const home = join(base, "home");
  const project = await initRepo(base, { name: "project" });
  const dshHomePath = (...segments) => join(home, ...segments);
  await registerProject(dshHomePath, { id: "demo", path: project });

  const root = new Context();
  root.provide("systemPrompt", new MemorySystemPrompt());
  await root.registry.plugin(ToolsService);

  const roster = [];
  root.provide("agents", { roots: () => roster, list: () => roster });
  root.provide("dshHomePath", dshHomePath);

  const hostFiber = root.registry.plugin({
    name: "test-agent-host",
    inject: ["tools", "systemPrompt"],
    apply() {},
  });
  await hostFiber;

  const records = [];
  const scopes = [];
  let pluginFiber = null;

  function addAgent(id, cwd = project) {
    const scopeKey = { id, nonce: Symbol("scope") };
    const scope = createScope(hostFiber.ctx, scopeKey);
    const agent = {
      id,
      session: { header: { id, cwd } },
      ctx: scope.ctx,
    };
    roster.push(agent);
    const record = { agent, scope, scopeKey };
    records.push(record);
    scopes.push(scope);
    return record;
  }

  async function loadPlugin() {
    pluginFiber = root.registry.plugin(ldvhPlugin, { webEnabled: false });
    await pluginFiber;
    return pluginFiber;
  }

  async function dispose() {
    if (pluginFiber !== null) {
      try { await pluginFiber.dispose(); } catch {   }
      pluginFiber = null;
    }
    for (const scope of scopes.reverse()) {
      try { await scope.dispose(); } catch {   }
    }
    try { await hostFiber.dispose(); } catch {   }
    try { await root.fiber.dispose(); } catch {   }
    await delay(100);
  }

  return {
    root,
    home,
    project,
    dshHomePath,
    roster,
    addAgent,
    loadPlugin,
    dispose,
    get pluginFiber() { return pluginFiber; },
  };
}


function viewOf(harness, record) {
  return harness.root.tools.view(scopeOf(record.agent.ctx));
}

function visibleNames(harness, record) {
  return [...viewOf(harness, record).visible.keys()];
}

function ldvhNames(harness, record) {
  return visibleNames(harness, record).filter((name) => name.startsWith("ldvh_"));
}

function definitionOf(harness, record, name) {
  return viewOf(harness, record).registrations.get(name)?.definition;
}

function effectLabels(record) {
  return record.agent.ctx.fiber.getEffects().map((effect) => effect.label);
}

function ldvhListenerLabels(record) {
  return effectLabels(record).filter((label) => LDVH_EVENT_LABELS.has(label));
}

function lifecycleEffectLabels(record) {
  return effectLabels(record).filter((label) => label.startsWith("dsh-ldvh: agent lifecycle "));
}

function globalGuardCount(root) {
  let count = 0;
  for (const _guard of root.tools.guards.global.guards.values()) count += 1;
  return count;
}

async function waitForTools(harness, record, { timeout = 3000 } = {}) {
  await waitFor(() => ldvhNames(harness, record).length > 0, {
    timeout,
    label: `LDVH tools for ${record.agent.id}`,
  });
  await delay(0);
}


test("lifecycle reload: stop removes this plugin's agent-scoped tools/listeners only, and a rebuild takes over with one set", async () => {
  await withTemp("ldvh-reload.", async (base) => {
    const harness = await createHarness(base);
    try {
      const record = harness.addAgent("session-reload");

      let otherEffectDisposed = 0;
      record.agent.ctx.effect(() => () => {
        otherEffectDisposed += 1;
      }, OTHER_EFFECT_LABEL);
      record.agent.ctx.tools.register(otherToolDefinition());
      assert.throws(
        () => record.agent.ctx.tools.register(otherToolDefinition()),
        /already registered in this scope/,
        "the real tools registry must reject a same-scope duplicate",
      );

      await harness.loadPlugin();
      await waitForTools(harness, record);

      const oldNames = ldvhNames(harness, record);
      assert.ok(oldNames.includes("ldvh_resolve_governance_scope"), "the first batch really registered");
      assert.deepEqual(
        [...harness.root.tools.view(undefined).visible.keys()].filter((name) => name.startsWith("ldvh_")),
        [],
        "LDVH tools are agent-scoped, not global",
      );
      const oldDefinitions = new Map(oldNames.map((name) => [name, definitionOf(harness, record, name)]));
      assert.equal(ldvhListenerLabels(record).length, 5, "five lifecycle listeners installed");
      assert.equal(lifecycleEffectLabels(record).length, 1, "one lifecycle effect installed");
      assert.equal(globalGuardCount(harness.root), 1, "the host seam guard is installed");
      assert.ok(visibleNames(harness, record).includes(OTHER_TOOL_NAME), "other plugin's tool is present");

      const firstFiber = harness.pluginFiber;
      await firstFiber.dispose();

      assert.equal(record.agent.ctx.fiber.state, 2, "the agent scope stays active after plugin stop");
      assert.deepEqual(ldvhNames(harness, record), [], "every LDVH tool descriptor is gone");
      assert.ok(visibleNames(harness, record).includes(OTHER_TOOL_NAME), "other plugin's tool survives");
      assert.equal(ldvhListenerLabels(record).length, 0, "all five LDVH listeners are gone");
      assert.equal(lifecycleEffectLabels(record).length, 0, "the lifecycle effect is gone");
      assert.ok(effectLabels(record).includes(OTHER_EFFECT_LABEL), "other plugin's effect survives");
      assert.equal(otherEffectDisposed, 0, "other plugin's effect was not disposed");
      assert.equal(globalGuardCount(harness.root), 0, "the old host seam guard is disposed");

      await harness.loadPlugin();
      await waitFor(() => {
        const definition = definitionOf(harness, record, "ldvh_resolve_governance_scope");
        return definition !== undefined && definition !== oldDefinitions.get("ldvh_resolve_governance_scope");
      }, { label: "rebuilt LDVH tool batch" });

      const newNames = ldvhNames(harness, record);
      assert.deepEqual([...newNames].sort(), [...oldNames].sort(), "the rebuilt batch is exactly the same descriptor set");
      assert.notEqual(
        definitionOf(harness, record, "ldvh_resolve_governance_scope"),
        oldDefinitions.get("ldvh_resolve_governance_scope"),
        "the rebuilt descriptor is a new registration, not the old object",
      );
      assert.equal(ldvhListenerLabels(record).length, 5, "exactly one set of listeners after rebuild");
      assert.equal(lifecycleEffectLabels(record).length, 1, "exactly one lifecycle effect after rebuild");
      assert.equal(globalGuardCount(harness.root), 1, "exactly one host seam guard after rebuild");
      assert.equal(otherEffectDisposed, 0, "the rebuild did not touch the other plugin's effect");

      recordJudgementForGuard(harness.project, "unavailable");
      assert.match(
        harness.root.tools.checkGuards({ name: "ldvh_register_governed_project", agent: record.agent }),
        /unavailable/,
        "the rebuilt tools guard is callable",
      );
      recordJudgementForGuard(harness.project, "governed");

      const call = await definitionOf(harness, record, "ldvh_resolve_governance_scope")
        .execute({}, { agent: record.agent });
      assert.equal(call.envelope.operation_key, "resolve-governance-scope");
      assert.equal(call.envelope.result.state, "governed");

      await record.scope.dispose();
      assert.equal(otherEffectDisposed, 1, "agent exit released the other plugin's effect");
      assert.equal(ldvhListenerLabels(record).length, 0, "no LDVH listener survives agent exit");

      await harness.pluginFiber.dispose();
      assert.equal(globalGuardCount(harness.root), 0, "the rebuilt guard is disposed with the plugin");
    } finally {
      await harness.dispose();
    }
  });
});


test("lifecycle reload: agent natural exit first makes the later plugin stop a no-op", async () => {
  await withTemp("ldvh-reload.", async (base) => {
    const harness = await createHarness(base);
    try {
      const record = harness.addAgent("session-exit-first");
      await harness.loadPlugin();
      await waitForTools(harness, record);

      await record.scope.dispose();
      await waitFor(() => ldvhNames(harness, record).length === 0, { label: "tools removed on agent exit" });
      assert.equal(ldvhListenerLabels(record).length, 0, "agent exit removed the listeners");
      assert.equal(lifecycleEffectLabels(record).length, 0, "agent exit removed the lifecycle effect");

      await harness.pluginFiber.dispose();
      await harness.pluginFiber.dispose();
      assert.equal(globalGuardCount(harness.root), 0, "the plugin guard is gone after the late stop");
      assert.deepEqual(ldvhNames(harness, record), [], "no late registration after agent exit + plugin stop");
    } finally {
      await harness.dispose();
    }
  });
});


test("lifecycle reload: plugin stop first leaves the agent fiber usable and does not touch another plugin's effect", async () => {
  await withTemp("ldvh-reload.", async (base) => {
    const harness = await createHarness(base);
    try {
      await harness.loadPlugin();
      const record = harness.addAgent("session-stop-first");
      harness.root.emit("agent/created", { agent: record.agent, source: "startup" });
      await waitForTools(harness, record);

      let otherEffectDisposed = 0;
      record.agent.ctx.effect(() => () => {
        otherEffectDisposed += 1;
      }, OTHER_EFFECT_LABEL);

      await harness.pluginFiber.dispose();

      assert.equal(record.agent.ctx.fiber.state, 2, "agent fiber remains active");
      assert.deepEqual(ldvhNames(harness, record), [], "LDVH tools removed");
      assert.equal(ldvhListenerLabels(record).length, 0, "LDVH listeners removed");
      assert.ok(effectLabels(record).includes(OTHER_EFFECT_LABEL), "other plugin's effect still present");
      assert.equal(otherEffectDisposed, 0, "other plugin's effect not disposed");

      const disposeProbe = record.agent.ctx.tools.register({
        name: "after_stop_probe",
        description: "probe",
        parameters: { type: "object", properties: {} },
        output: { schema: { type: "object" }, render: () => "" },
        async execute() { return {}; },
      });
      assert.ok(visibleNames(harness, record).includes("after_stop_probe"), "agent scope still accepts registrations");
      disposeProbe();
      assert.ok(!visibleNames(harness, record).includes("after_stop_probe"), "probe removed");

      await record.scope.dispose();
      assert.equal(otherEffectDisposed, 1, "agent exit finally releases the other plugin's effect");
    } finally {
      await harness.dispose();
    }
  });
});


test("lifecycle reload: an in-flight resolve must not register tools after plugin stop", async () => {
  await withTemp("ldvh-reload.", async (base) => {
    const harness = await createHarness(base);
    try {
      await harness.loadPlugin();
      assert.equal(harness.roster.length, 0, "empty roster at load: no adoption");

      const record = harness.addAgent("session-pending-resolve");
      harness.root.emit("agent/created", { agent: record.agent, source: "startup" });

      assert.deepEqual(ldvhNames(harness, record), [], "resolve has not completed yet");
      assert.equal(ldvhListenerLabels(record).length, 5, "listeners are installed synchronously");

      const disposal = harness.pluginFiber.dispose();
      await disposal;
      await delay(150);

      assert.deepEqual(ldvhNames(harness, record), [], "a late resolve must not register after stop");
      assert.equal(ldvhListenerLabels(record).length, 0, "stop removed the listeners");
      assert.equal(lifecycleEffectLabels(record).length, 0, "stop removed the lifecycle effect");
      assert.equal(record.agent.ctx.fiber.state, 2, "the agent itself was not disposed by plugin stop");
    } finally {
      await harness.dispose();
    }
  });
});


test("lifecycle reload: a stale resolve from an exited same-id agent must not unregister the new agent's tools", async () => {
  await withTemp("ldvh-reload.", async (base) => {
    const harness = await createHarness(base);
    const originalReadFile = fs.promises.readFile;
    let releaseRead;
    const readGate = new Promise((resolve) => { releaseRead = resolve; });
    let blockedOnce = false;
    let sawBlockedRead = false;
    let patched = false;
    const readOrigin = new AsyncLocalStorage();
    const carrierPath = harness.dshHomePath("ldvh", "governed-projects.yaml");

    try {
      await harness.loadPlugin();
      fs.promises.readFile = async (path, ...rest) => {
        if (!blockedOnce && String(path) === carrierPath && readOrigin.getStore() === "old-agent") {
          blockedOnce = true;
          sawBlockedRead = true;
          await readGate;
        }
        return originalReadFile.call(fs.promises, path, ...rest);
      };
      syncBuiltinESMExports();
      patched = true;

      const oldRecord = harness.addAgent("session-same-id", base);
      readOrigin.run("old-agent", () => harness.root.emit("agent/created", { agent: oldRecord.agent, source: "startup" }));
      await waitFor(() => sawBlockedRead, { label: "old resolve blocked at the carrier read" });
      assert.deepEqual(ldvhNames(harness, oldRecord), [], "old resolve is still in flight");

      await oldRecord.scope.dispose();

      const newRecord = harness.addAgent("session-same-id", harness.project);
      harness.root.emit("agent/created", { agent: newRecord.agent, source: "startup" });
      await waitForTools(harness, newRecord);
      const newDefinition = definitionOf(harness, newRecord, "ldvh_resolve_governance_scope");
      const newCount = ldvhNames(harness, newRecord).length;

      releaseRead();
      await delay(150);

      assert.deepEqual(ldvhNames(harness, oldRecord), [], "the exited agent's scope has no tools");
      assert.equal(ldvhNames(harness, newRecord).length, newCount, "the stale resolve did not unregister the new batch");
      assert.equal(
        definitionOf(harness, newRecord, "ldvh_resolve_governance_scope"),
        newDefinition,
        "the stale resolve did not replace the new registration",
      );
    } finally {
      releaseRead();
      if (patched) {
        fs.promises.readFile = originalReadFile;
        syncBuiltinESMExports();
      }
      await harness.dispose();
    }
  });
});


test("lifecycle reload: plugin unload awaits the lifecycle stop Promise (pending async disposer)", async () => {
  await withTemp("ldvh-reload.", async (base) => {
    const harness = await createHarness(base);
    const originalWriteFile = fs.promises.writeFile;
    let releaseWrite;
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    let blockStopDiagnostic = false;
    let blockSeen = false;

    fs.promises.writeFile = async (path, data, ...rest) => {
      if (
        blockStopDiagnostic &&
        typeof data === "string" &&
        data.includes("silence-cleared") &&
        data.includes('"dispose"')
      ) {
        blockSeen = true;
        await writeGate;
      }
      return originalWriteFile.call(fs.promises, path, data, ...rest);
    };
    syncBuiltinESMExports();

    try {
      await harness.loadPlugin();
      const record = harness.addAgent("session-async-stop");
      harness.root.emit("agent/created", { agent: record.agent, source: "startup" });
      await waitForTools(harness, record);

      harness.root.emit("agent/turn-stopping", { agent: record.agent, turn: 1 });
      harness.root.emit("agent/status", { agent: record.agent, status: "idle" });
      await delay(80);

      blockStopDiagnostic = true;
      const disposal = harness.pluginFiber.dispose();
      let settled = false;
      Promise.resolve(disposal).then(() => { settled = true; });

      await waitFor(() => blockSeen, { label: "the stop diagnostic write to be held" });
      await delay(50);
      assert.equal(settled, false, "plugin unload must await stopLifecycle's pending drain");

      assert.deepEqual(ldvhNames(harness, record), [], "tools already unregistered while stop is pending");
      assert.equal(ldvhListenerLabels(record).length, 0, "listeners already removed while stop is pending");

      releaseWrite();
      await disposal;
      assert.equal(settled, true, "plugin unload resolves only after the drain completes");
    } finally {
      blockStopDiagnostic = false;
      releaseWrite();
      fs.promises.writeFile = originalWriteFile;
      syncBuiltinESMExports();
      await harness.dispose();
    }
  });
});

test("lifecycle reload: real plugin unload reports a listener cleanup error to Cordis", async () => {
  await withTemp("ldvh-reload-real-failure.", async (base) => {
    const harness = await createHarness(base);
    const messages = [];
    const removeExporter = harness.root.logger.exporter({ export: (message) => messages.push(message) });
    try {
      const failed = harness.addAgent("listener-cleanup-fails");
      const healthy = harness.addAgent("listener-cleanup-succeeds");
      const original = failed.agent.ctx;
      failed.agent.ctx = original.extend({
        on(name, listener, options) {
          const dispose = original.on(name, listener, options);
          if (name !== "system-prompt/assemble") return dispose;
          return () => {
            dispose();
            throw new Error("synthetic listener cleanup failure");
          };
        },
      });
      await harness.loadPlugin();
      await waitForTools(harness, failed);
      await waitForTools(harness, healthy);
      await harness.pluginFiber.dispose();

      const hasSyntheticError = (value) => value instanceof Error && (
        value.message.includes("synthetic listener cleanup failure") ||
        (value instanceof AggregateError && value.errors.some(hasSyntheticError))
      );
      assert.ok(messages.some((message) => message.type === "error" && message.args.some(hasSyntheticError)),
        "the real Cordis unload must receive the cleanup failure rather than only a warning");
      assert.deepEqual(ldvhNames(harness, failed), [], "the failing agent's tool cleanup was attempted");
      assert.deepEqual(ldvhNames(harness, healthy), [], "the other agent was cleaned despite the failure");
      assert.equal(ldvhListenerLabels(healthy).length, 0, "the other agent's listeners were removed");
      assert.equal(globalGuardCount(harness.root), 0, "the plugin's host guard is also removed despite the error");
    } finally {
      await removeExporter();
      await harness.dispose();
    }
  });
});

test("lifecycle reload: cleanup failure is reported while other agents are still cleaned", async () => {
  await withTemp("ldvh-reload-failure.", async (base) => {
    const project = await initRepo(base, { name: "project" });
    const dshHomePath = (...parts) => join(base, "home", ...parts);
    await registerProject(dshHomePath, { id: "demo", path: project });
    const warnings = [];
    const makeAgent = (id, fail) => {
      const tools = new Map();
      const agent = {
        id,
        session: { header: { id, cwd: project } },
        ctx: {
          get: () => undefined,
          on: () => () => {},
          effect(setup) {
            const dispose = setup();
            return () => {
              const pending = dispose();
              return Promise.resolve(pending).then(() => {
                if (fail) throw new Error("synthetic agent cleanup failure");
              });
            };
          },
          tools: {
            register(definition) {
              if (tools.has(definition.name)) throw new Error("duplicate tool");
              tools.set(definition.name, definition);
              return () => tools.delete(definition.name);
            },
          },
        },
      };
      return { agent, tools };
    };
    const first = makeAgent("cleanup-fails", true);
    const second = makeAgent("cleanup-succeeds", false);
    const roster = [first.agent, second.agent];
    const host = {
      get: (name) => name === "agents" ? { roots: () => roster, list: () => roster } : undefined,
      on: () => () => {},
      logger: { info() {}, warn(...parts) { warnings.push(parts.map(String).join(" ")); }, error() {} },
    };
    const registry = createLifecycleRegistry(host, { dshHomePath, workspaceRoot: base, sessionScopes: createSessionScopes() });
    const stop = registry.start();
    try {
      await waitFor(() => first.tools.has("ldvh_norm_write") && second.tools.has("ldvh_norm_write"), { label: "both tool batches" });
      await assert.rejects(stop(), /cleanup/i, "a partial cleanup must not be reported as successful");
      assert.equal(first.tools.size, 0, "the failing agent's synchronous cleanup was attempted");
      assert.equal(second.tools.size, 0, "the other agent was cleaned despite the failure");
      assert.ok(warnings.some((message) => message.includes("synthetic agent cleanup failure")), "the failure is logged");
    } finally {
      try { await stop(); } catch {   }
      await delay(100);
    }
  });
});
