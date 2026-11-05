// Human Gate 接缝：使用模拟 answerer，不发真实提问、不写项目事实源。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import { createHostSeams } from "../lib/host-seams.js";
import { withTemp } from "./helpers.mjs";

function answerer({ index = 0, seen = [] } = {}) {
  const service = {
    async ask(request) {
      assert.equal(this, service, "the service method must keep its receiver");
      seen.push(request);
      const question = request.questions[0];
      return { answers: [{ id: question.id, selected: [question.options[index].label] }] };
    },
  };
  return service;
}

function getQuestionState(seams) {
  return seams.snapshot().find((item) => item.seam === "ctx.userQuestions.ask");
}

test("real Cordis: late, removed and replacement providers are resolved at use time", async () => {
  await withTemp("ldvh-question-rebind-", async (home) => {
    const root = new Context();
    await root[Symbol.for("cordis.init")]?.();
    let seams;
    const owner = root.registry.plugin({
      name: "question-rebind-fixture",
      apply(ctx) {
        seams = createHostSeams();
        const installed = seams.install(ctx, { dshHomePath: (...parts) => join(home, ...parts) });
        ctx.effect(() => () => installed.dispose());
      },
    });
    let removeA;
    let removeB;
    try {
      await owner;
      const args = { action: "register", projectId: "fixture", projectPath: "/fixture" };
      assert.equal((await seams.requestRegistrationConsent(args)).granted, false);
      assert.equal(seams.humanGateAvailable, false);
      assert.equal(getQuestionState(seams).consumed, false);

      const seenA = [];
      removeA = root.provide("userQuestions", answerer({ seen: seenA }));
      assert.equal(getQuestionState(seams).state, "available");
      assert.equal(typeof seams.ask, "function");
      assert.equal(getQuestionState(seams).consumed, false, "reading a callable service is not actual use");
      const agent = { id: "synthetic-agent" };
      const signal = new AbortController().signal;
      assert.equal((await seams.requestRegistrationConsent({ ...args, agent, signal })).granted, true);
      assert.equal(seenA.length, 1);
      assert.equal(seenA[0].agent, agent);
      assert.equal(seenA[0].signal, signal);
      assert.equal(getQuestionState(seams).consumed, true);

      await removeA();
      removeA = null;
      assert.equal((await seams.requestRegistrationConsent(args)).granted, false);
      assert.equal(seenA.length, 1, "removed provider must not receive a stale call");
      assert.equal(seams.humanGateAvailable, false);
      assert.equal(getQuestionState(seams).consumed, false);

      const seenB = [];
      removeB = root.provide("userQuestions", answerer({ seen: seenB }));
      assert.equal(getQuestionState(seams).state, "available", "a replacement is not consumed by the previous provider's call");
      assert.equal((await seams.requestRegistrationConsent(args)).granted, true);
      assert.equal(seenB.length, 1);
      await owner.dispose();
      assert.equal(seams.humanGateAvailable, false);
      assert.equal((await seams.requestRegistrationConsent(args)).granted, false);
      assert.equal(seenB.length, 1, "disposed plugin must not initiate a new ask");
    } finally {
      await owner.dispose();
      if (removeA) await removeA();
      if (removeB) await removeB();
      await root.fiber.dispose();
    }
  });
});

test("real Cordis Service proxies retain consumption identity across lookups", async () => {
  const root = new Context();
  await root[Symbol.for("cordis.init")]?.();
  let seams;
  const owner = root.registry.plugin({
    name: "question-proxy-fixture",
    apply(ctx) {
      seams = createHostSeams();
      const installed = seams.install(ctx);
      ctx.effect(() => () => installed.dispose());
    },
  });
  const makeProvider = (seen) => class extends Service {
    constructor(ctx) { super(ctx, "userQuestions"); }
    async ask(request) {
      seen.push(request);
      const question = request.questions[0];
      return { answers: [{ id: question.id, selected: [question.options[0].label] }] };
    }
  };
  let first;
  let second;
  try {
    await owner;
    const seenA = [];
    first = root.registry.plugin(makeProvider(seenA));
    await first;
    assert.equal(getQuestionState(seams).state, "available");
    assert.equal((await seams.requestRegistrationConsent({ action: "register", projectId: "p", projectPath: "/p" })).granted, true);
    assert.equal(seenA.length, 1);
    assert.equal(getQuestionState(seams).state, "consumed");
    const disposing = first.dispose();
    const duringDisposal = await seams.requestRegistrationConsent({ action: "register", projectId: "p", projectPath: "/p" });
    assert.equal(duringDisposal.granted, false);
    assert.equal(seenA.length, 1, "a provider being disposed must not receive another ask");
    await disposing;
    first = null;
    assert.equal(getQuestionState(seams).state, "absent");
    const seenB = [];
    second = root.registry.plugin(makeProvider(seenB));
    await second;
    assert.equal(getQuestionState(seams).state, "available");
    assert.equal((await seams.requestRegistrationConsent({ action: "register", projectId: "p", projectPath: "/p" })).granted, true);
    assert.equal(getQuestionState(seams).state, "consumed");
    assert.equal(seenB.length, 1);
  } finally {
    if (first) await first.dispose();
    if (second) await second.dispose();
    await owner.dispose();
    await root.fiber.dispose();
  }
});

test("WorkCase rechecks provider after reading the routing ledger", async () => {
  await withTemp("ldvh-question-ledger-race-", async (home) => {
    const seenA = [];
    const seenB = [];
    const serviceA = answerer({ index: 1, seen: seenA });
    const serviceB = answerer({ index: 1, seen: seenB });
    let service = serviceA;
    let duringRead = null;
    const ctx = { get: (key) => key === "userQuestions" ? service : undefined };
    const seams = createHostSeams();
    const installed = seams.install(ctx, {
      dshHomePath: (...parts) => {
        if (duringRead) {
          const action = duringRead;
          duringRead = null;
          action();
        }
        return join(home, ...parts);
      },
    });
    try {
      duringRead = () => { service = undefined; };
      const denied = await seams.requestWorkcaseRouting({ candidateKey: "removed-during-read" });
      assert.equal(denied.granted, false);
      assert.match(denied.reason, /no human-answerer/);
      assert.equal(seenA.length, 0);

      service = serviceA;
      duringRead = () => { service = serviceB; };
      const agent = { id: "synthetic-agent" };
      const result = await seams.requestWorkcaseRouting({ candidateKey: "replaced-during-read", agent });
      assert.equal(result.routedTo, "direct");
      assert.equal(seenA.length, 0);
      assert.equal(seenB.length, 1);
      assert.equal(seenB[0].agent, agent);
      service = undefined;
      const temporarilyDenied = await seams.requestWorkcaseRouting({ candidateKey: "replaced-during-read", agent });
      assert.equal(temporarilyDenied.granted, false);
      assert.match(temporarilyDenied.reason, /no human-answerer/);
      service = serviceB;
      const reused = await seams.requestWorkcaseRouting({ candidateKey: "replaced-during-read", agent });
      assert.equal(reused.reused, true);
      assert.equal(reused.routedTo, "direct");
      assert.equal(seenB.length, 1, "the recorded decision is reused after the provider returns");
    } finally {
      installed.dispose();
    }
  });
});

test("a recorded WorkCase decision is reused after a provider returns", async () => {
  await withTemp("ldvh-question-ledger-reuse-", async (home) => {
    const seen = [];
    const original = answerer({ seen });
    let service = original;
    const seams = createHostSeams();
    const installed = seams.install({ get: (key) => key === "userQuestions" ? service : undefined }, {
      dshHomePath: (...parts) => join(home, ...parts),
    });
    try {
      const chosen = await seams.requestWorkcaseRouting({ candidateKey: "fixture-recorded" });
      assert.equal(chosen.granted, true);
      assert.equal(chosen.routedTo, "workcase");
      service = undefined;
      const denied = await seams.requestWorkcaseRouting({ candidateKey: "fixture-recorded" });
      assert.equal(denied.granted, false);
      assert.match(denied.reason, /no human-answerer/);
      service = original;
      const reused = await seams.requestWorkcaseRouting({ candidateKey: "fixture-recorded" });
      assert.equal(reused.granted, true);
      assert.equal(reused.reused, true);
      assert.equal(seen.length, 1);
    } finally {
      installed.dispose();
    }
  });
});

test("an unreadable ledger is not treated as an unanswered question", async () => {
  await withTemp("ldvh-question-ledger-bad-", async (home) => {
    await mkdir(join(home, "ldvh"), { recursive: true });
    await writeFile(join(home, "ldvh", "workcase-route-decisions.json"), "not valid JSON", "utf8");
    const seen = [];
    let service;
    const seams = createHostSeams();
    const installed = seams.install({ get: (key) => key === "userQuestions" ? service : undefined }, {
      dshHomePath: (...parts) => join(home, ...parts),
    });
    try {
      const unavailable = await seams.requestWorkcaseRouting({ candidateKey: "fixture-malformed" });
      assert.equal(unavailable.granted, false);
      assert.match(unavailable.reason, /no human-answerer/);
      service = answerer({ seen });
      const result = await seams.requestWorkcaseRouting({ candidateKey: "fixture-malformed" });
      assert.equal(result.granted, false);
      assert.equal(result.routedTo, null);
      assert.match(result.reason, /route-decision carrier unreadable/);
      assert.equal(seen.length, 0);
    } finally {
      installed.dispose();
    }
  });
});

test("registration and Spark each resolve the provider once before asking", async () => {
  const seen = [];
  const service = answerer({ seen });
  let limited = false;
  let lookups = 0;
  const ctx = { get: (key) => {
    if (key !== "userQuestions") return undefined;
    if (!limited) return service;
    lookups += 1;
    return lookups === 1 ? service : undefined;
  } };
  const seams = createHostSeams();
  const installed = seams.install(ctx);
  try {
    limited = true;
    const registration = await seams.requestRegistrationConsent({ action: "register", projectId: "p", projectPath: "/p" });
    assert.equal(registration.granted, true);
    assert.equal(lookups, 1);
    lookups = 0;
    const spark = await seams.requestSparkConsent({ action: "create", objectTitle: "fixture", summary: "synthetic report" });
    assert.equal(spark.granted, true);
    assert.equal(lookups, 1);
    assert.equal(seen.length, 2);
  } finally {
    installed.dispose();
  }
});

test("provider lookup exceptions fail closed and old disposal cannot clear a newer install", async () => {
  let service = answerer();
  let throws = false;
  const ctx = { get: (key) => {
    if (key === "userQuestions" && throws) throw new Error("synthetic lookup error");
    return key === "userQuestions" ? service : undefined;
  } };
  const seams = createHostSeams();
  const first = seams.install(ctx);
  const second = seams.install(ctx);
  try {
    first.dispose();
    assert.equal(seams.humanGateAvailable, true);
    throws = true;
    const denied = await seams.requestRegistrationConsent({ action: "register", projectId: "p", projectPath: "/p" });
    assert.equal(denied.granted, false);
    assert.match(denied.reason, /no human-answerer/);
    assert.equal(getQuestionState(seams).consumed, false);
    throws = false;
    service = undefined;
    assert.equal(seams.humanGateAvailable, false);
  } finally {
    second.dispose();
  }
});

test("diagnostic bookkeeping cannot discard an already dispatched answer", async () => {
  const seen = [];
  const service = answerer({ seen });
  const seams = createHostSeams();
  const installed = seams.install({ get: (key) => key === "userQuestions" ? service : undefined });
  const originalWeakRef = globalThis.WeakRef;
  try {
    globalThis.WeakRef = class { constructor() { throw new Error("synthetic diagnostic failure"); } };
    const result = await seams.requestRegistrationConsent({ action: "register", projectId: "p", projectPath: "/p" });
    assert.equal(result.granted, true);
    assert.equal(seen.length, 1, "diagnostic failure must not repeat the ask");
    assert.equal(getQuestionState(seams).state, "available", "unknown diagnostic identity must not claim consumption");
  } finally {
    globalThis.WeakRef = originalWeakRef;
    installed.dispose();
  }
});

test("an in-flight ask is not replayed when the provider disappears and caller aborts", async () => {
  const controller = new AbortController();
  let service;
  let calls = 0;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  service = { ask: (request) => {
    calls += 1;
    started();
    return new Promise((resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(new Error("ASK_ABORTED")), { once: true });
    });
  } };
  const seams = createHostSeams();
  const installed = seams.install({ get: (key) => key === "userQuestions" ? service : undefined });
  try {
    const pending = seams.requestRegistrationConsent({ action: "register", projectId: "p", projectPath: "/p", signal: controller.signal });
    await ready;
    service = undefined;
    controller.abort();
    const result = await pending;
    assert.equal(result.granted, false);
    assert.match(result.reason, /ASK_ABORTED/);
    assert.equal(calls, 1);
    assert.equal(seams.humanGateAvailable, false);
  } finally {
    installed.dispose();
  }
});
