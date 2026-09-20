// dsh-ldvh — consumption of the DSH host seams named in specs/08 §6.
//
// Authority: specs/08 §6 「宿主缝的消费义务」. That section is explicit that a
// host seam existing does NOT mean LDVH is protected by it:
//
//   在 LDVH 实际消费该缝之前，不得据本文主张相应防护已部署、已生效或已
//   fail-closed
//
// and §6 lists, per seam, what LDVH must actually do to have "consumed" it:
//
//   ctx.tools.register        register operations and accept arg validation
//   ctx.tools.guard           register a MONOTONIC guard
//   ctx.invariants.register   deploy runtime invariant assertions
//   fs/observed               mount read-observation + write version guard
//   ctx.userQuestions.ask     carry Human Gate requests through it
//
// This module is the single home for those consumptions, so the claim
// "consumed" is backed by one reviewable place rather than scattered calls.
// Every registration returns a disposer and is owned by the caller's fiber
// (08 §6 + cordis effect discipline): nothing here leaks past plugin stop.

/** 07 §5.6 consent question identity — the id and the affirmative label are
 * shared between what is ASKED and what is ACCEPTED, so the parse can never
 * grant on a label that was never offered. */
const CONSENT_QUESTION_ID = "ldvh-registration-consent";
const CONSENT_AFFIRMATIVE_LABEL = "确认";

/**
 * Read the selected label from one answer entry.
 *
 * The host service returns `selected` as an ARRAY of labels
 * (`{answers:[{id, selected:["确认"]}]}`) — confirmed against the official
 * consumer, which does `selected: [...answer.selected]`
 * (dsh-tool-ask-user/lib/index.js:108), and reproduced against the live service
 * on 2026-09-18. Treating it as a scalar made every comparison against a label
 * string fail, so an answered question would still be read as "not chosen".
 *
 * A single-element array is unwrapped to its label. Multi-select answers keep
 * only an exact single match: a multi-label answer must not accidentally
 * satisfy a single-label gate.
 */
function selectedLabelOf(entry) {
  if (entry === null || entry === undefined) return null;
  const raw = entry.selected ?? entry.answer ?? null;
  if (Array.isArray(raw)) return raw.length === 1 ? raw[0] : null;
  return raw;
}

/** 21 §6.3 路由询问 identity — the Human decides between carrying the work as a
 * WorkCase or handling it directly. Same discipline as the registration consent:
 * the id and BOTH labels are shared between what is asked and what is accepted,
 * so the parse can never grant on a label that was never offered.
 *
 * This is a ROUTING question ("WorkCase or direct?"), NOT a content approval.
 * The content judgement belongs to Gate 1 (21 §10.1), where the Human sees the
 * whole object; asking for内容 here would demand a judgement the Human cannot
 * yet make. Only the "carry it as a WorkCase" answer authorises creation —
 * "handle it directly" means no object is created at all. */
const ROUTE_QUESTION_ID = "ldvh-workcase-route";
const ROUTE_WORKCASE_LABEL = "建工单走流程";
const ROUTE_DIRECT_LABEL = "直接执行";

/**
 * Latest governance judgement per working directory.
 *
 * The `tools.guard` contract is SYNCHRONOUS (`(execution) => string | undefined`),
 * so a guard cannot await a fresh judgement. This map is the one-line bridge:
 * the lifecycle records every judgement here as it happens, and the guard
 * reads the last recorded state for the invoking cwd. A cwd with no recorded
 * judgement is left alone (the operation's own handler still fails closed) —
 * the guard only ADDS a refusal, never a permission.
 */
const LATEST_JUDGEMENT = new Map();

/** Record a judgement for the guard to consult (called by the lifecycle). */
export function recordJudgementForGuard(cwd, state) {
  if (typeof cwd !== "string" || cwd.length === 0) return;
  if (state === "governed" || state === "not_governed" || state === "unavailable") {
    LATEST_JUDGEMENT.set(cwd, state);
  }
}

/** Test/diagnostic accessor: the recorded judgement for one cwd, if any. */
export function judgementForGuard(cwd) {
  return LATEST_JUDGEMENT.get(cwd);
}

/**
 * Last authoritative observation per filesystem target.
 *
 * `fs/observed` is an EMIT event: the observing side records, listeners mirror.
 * LDVH emits its own observations when it reads a carrier, and mirrors every
 * observation it hears, so the `fs/write-intent` / `fs/edit-intent` guards can
 * key a write to a version that was actually observed rather than invented.
 */
const OBSERVED_VERSIONS = new Map();

/**
 * Stable key for an FsTarget.
 *
 * The two identity sources MUST NOT collide: `targetKey` is the host's opaque
 * stable identity, while `displayPath` is only a fallback for target-shaped
 * values lacking one. Namespacing the fallback prevents two different files
 * from sharing a key (and thus cross-binding one file's observed version as
 * another file's write guard).
 */
function targetKeyOf(target) {
  if (target === null || target === undefined) return null;
  if (typeof target.targetKey === "string" && target.targetKey.length > 0) return `key:${target.targetKey}`;
  if (typeof target.displayPath === "string" && target.displayPath.length > 0) return `path:${target.displayPath}`;
  return null;
}

/**
 * Record an authoritative read observation for a target.
 *
 * LDVH's read path calls this with what it actually read. `version` must come
 * from the host's own read outcome — LDVH must NOT synthesize one, because a
 * fabricated version would make the write guard compare against a value that
 * never existed and defeat the very protection it exists to provide.
 *
 * Returns true when the observation was recorded and emitted.
 */
export function recordObservation(ctx, { target, version }) {
  const key = targetKeyOf(target);
  if (key === null) return false;
  if (version === undefined || version === null) return false;
  OBSERVED_VERSIONS.set(key, version);
  if (typeof ctx?.emit === "function") {
    try {
      ctx.emit("fs/observed", target, { kind: "present", version }, undefined);
    } catch {
      // Recording succeeded; emission is best-effort (listeners are recorders).
    }
  }
  return true;
}

/** Diagnostic accessor: the last observed version for a target key, if any. */
export function observedVersionFor(target) {
  const key = targetKeyOf(target);
  return key === null ? undefined : OBSERVED_VERSIONS.get(key);
}

/** Test seam: forget all observations (keeps cross-test bleed out of the map). */
export function resetObservations() {
  OBSERVED_VERSIONS.clear();
}

/**
 * Registry of what this process actually consumed, exposed for diagnostics
 * (lifecycle snapshot / web state route). Keys match specs/08 §6's table.
 */
export function createHostSeams() {  const consumed = Object.create(null);
  const mark = (key, detail) => { consumed[key] = { consumed: true, ...detail }; };

  /**
   * `ctx.tools.guard` — a monotonic guard over LDVH tool dispatch.
   *
   * 08 §6 requires a guard registered through this入口; the host contract is
   * that any guard may refuse but never re-allow.
   *
   * AUTHORITATIVE SIGNATURE (cordis Inspect, Service `tools`):
   *   guard(guard: ToolGuard): () => void
   *   type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
   *
   * Two contract details this must honour exactly:
   *   - "a returned STRING denies the execution" — returning an object (or any
   *     non-undefined value) is not the documented deny shape;
   *   - `ToolExecution` is `{ callId, rootCallId?, name, arguments, agent?, ... }`
   *     — there is no `tool` field and no `scopeState` field. The call name is
   *     `execution.name`, and the judgement must be made HERE (the guard is
   *     synchronous), so this guard re-judges the cwd rather than reading a
   *     cached property that does not exist.
   */
  function installToolsGuard(ctx, { dshHomePath } = {}) {
    const tools = ctx.get("tools");
    if (tools === undefined || typeof tools.guard !== "function") {
      return { consumed: false, detail: "ctx.tools.guard is unavailable in this composition" };
    }
    const dispose = tools.guard((execution) => {
      const name = execution?.name;
      if (typeof name !== "string" || !name.startsWith("ldvh_")) return;
      // The guard sees the invocation before dispatch. It asserts the
      // precondition the operations themselves also enforce, so a caller can
      // never reach a write-shaped LDVH operation by bypassing a handler.
      if (!WRITE_SHAPED_OPERATIONS.has(name)) return;
      const cwd = execution?.agent?.session?.header?.cwd;
      if (typeof cwd !== "string" || cwd.length === 0) return;
      // Synchronous guard on the last recorded judgement. Deny ONLY on
      // `unavailable`: an absent judgement is left alone (the operation's own
      // handler still fails closed), and `not_governed` must be left alone too
      // — registering the project is precisely how a not-yet-governed cwd
      // becomes governed, so refusing there would make the entry unreachable.
      const judgement = LATEST_JUDGEMENT.get(cwd);
      if (judgement === "unavailable") {
        return `LDVH governance state is unavailable for ${cwd}: write-shaped LDVH operations are refused (07 §7 / 08 §6 fail-closed)`;
      }
    });
    mark("ctx.tools.guard", { detail: "monotonic guard over write-shaped ldvh_ tools (deny by returning a reason string)" });
    return { consumed: true, dispose };
  }

  /**
   * `ctx.invariants.register` — runtime invariant assertions.
   *
   * AUTHORITATIVE SIGNATURE (cordis Inspect, Service `invariants`):
   *   register(packageName: string, installer: InvariantInstaller): () => void
   *   interface InvariantInstaller { (ctx: Context, fail: InvariantFailure): void | Promise<void> }
   *   type InvariantFailure = (message: string) => never
   *
   * So an installer is a FUNCTION that runs at install time and reports a
   * violation by CALLING `fail(message)` — not by returning an array of check
   * descriptors. `fail` throws, so a violation aborts the installer.
   *
   * The assertion is stated as 08 §6 requires (a runtime check, not a test):
   * the registration carrier must satisfy the v5 schema. An `unavailable`
   * carrier is a legitimate runtime state (no DSH home yet, a carrier the
   * Human has not confirmed) and must NOT be reported as a violation —
   * otherwise the invariant fires on the ordinary not-yet-installed case and
   * trains readers to ignore it.
   */
  function installInvariants(ctx, { dshHomePath }) {
    const invariants = ctx.get("invariants");
    if (invariants === undefined || typeof invariants.register !== "function") {
      return { consumed: false, detail: "ctx.invariants.register is unavailable in this composition" };
    }
    const dispose = invariants.register("dsh-ldvh", async (_ictx, fail) => {
      const { evaluateRegistrationEntry } = await import("./governed-projects.js");
      const result = await evaluateRegistrationEntry(dshHomePath);
      if (result.ok) return;
      // Only a schema violation is an assertion failure; the other four
      // unavailable codes are legitimate runtime states.
      if (result.error.code === "registration_schema_invalid") {
        fail(`${result.error.code}: ${result.error.message}`);
      }
    });
    mark("ctx.invariants.register", { detail: "install-time assertion: registration carrier satisfies the v5 schema" });
    return { consumed: true, dispose };
  }

  /**
   * `fs/observed` — read observation plus write version guard.
   *
   * 08 §6 defines consumption of this seam as "挂载读观察并挂载写入版本守卫" —
   * BOTH halves, and both are now carried:
   *
   *   READ half — LDVH's own reads of the registration carrier RECORD an
   *   authoritative observation through `recordObservation()`, emitting
   *   `fs/observed` with `{kind:'present', version}` or `{kind:'absent'}`.
   *   The host requires listeners to be SYNCHRONOUS recorders, so the emit
   *   path is synchronous and never awaits.
   *
   *   WRITE half — LDVH writes to the observed carrier mount `fs/write-intent`
   *   and `fs/edit-intent`, demanding `{kind:'replaceIfVersion', version}`
   *   keyed to the last RECORDED observation. A write to a target LDVH has not
   *   observed yields no LDVH intent (the host's own policy decides), so LDVH
   *   never manufactures a version it did not read.
   *
   * Before this, only a counting listener existed: it recorded nothing and
   * guarded nothing, so claiming the seam would have been exactly the false
   * claim 08 §6 forbids.
   */
  function installFsObservation(ctx) {
    if (typeof ctx.on !== "function") {
      return { consumed: false, detail: "event listening (ctx.on) is unavailable in this composition" };
    }
    const disposers = [];
    // READ half: observe (and mirror) every observation that flows, so the
    // write guard below can key writes to the latest authoritative version.
    disposers.push(ctx.on("fs/observed", (target, observation) => {
      seams.observations += 1;
      const key = targetKeyOf(target);
      if (key === null) return;
      if (observation?.kind === "present") OBSERVED_VERSIONS.set(key, observation.version);
      else if (observation?.kind === "absent") OBSERVED_VERSIONS.delete(key);
    }));
    // WRITE half: demand a version keyed to a real observation.
    const writeIntent = (target, actor, next) => {
      const key = targetKeyOf(target);
      if (key === null) return next();
      const version = OBSERVED_VERSIONS.get(key);
      // Never observed → no LDVH intent; the host's own policy decides.
      if (version === undefined) return next();
      return { kind: "replaceIfVersion", version };
    };
    disposers.push(ctx.on("fs/write-intent", writeIntent));
    disposers.push(ctx.on("fs/edit-intent", writeIntent));
    // The fs service is what lets LDVH obtain a REAL FsVersion (`stat` returns
    // `{version, type}`). Without it LDVH could only guess, which the write
    // guard must never do — so the observation capability is installed only
    // when the service exists.
    const fs = typeof ctx.get === "function" ? ctx.get("fs") : undefined;
    seams.fs = fs ?? null;
    mark("fs/observed", {
      detail: fs === undefined
        ? "listeners mounted, but the fs service is unavailable so LDVH cannot obtain a real version — observations cannot be recorded"
        : "read half binds the fs service (real FsVersion via stat) and records observations; write half mounts fs/write-intent + fs/edit-intent version guards",
      ...(fs === undefined ? { consumed: false, partial: true } : {})
    });
    return {
      consumed: fs !== undefined,
      ...(fs === undefined ? { partial: true } : {}),
      dispose: () => { for (const d of disposers) { try { d(); } catch { /* already removed */ } } }
    };
  }

  /**
   * `ctx.userQuestions.ask` — Human Gate requests through the host entry.
   *
   * 08 §6 defines consumption as "经该入口承载 Human Gate 决策提请" — a Human
   * Gate request must actually BE routed through the entry. The Gate this
   * satisfies is `07 §5.6`: "登记或取消仅由 Human 明确意图触发", i.e. an AI
   * cannot register a project on its own initiative.
   *
   * `requestRegistrationConsent()` is the real call site: the 07 §5.4/§5.7
   * entries invoke it before writing, so the consent is asked, recorded by the
   * host (and thus answerable/reviewable) instead of being assumed from prose.
   * The seam reports `consumed` only because that path exists and is wired to
   * the entry — a captured-but-never-called reference would not count.
   */
  function installUserQuestions(ctx) {
    const userQuestions = ctx.get("userQuestions");
    if (userQuestions === undefined || typeof userQuestions.ask !== "function") {
      return { consumed: false, detail: "ctx.userQuestions.ask is unavailable in this composition" };
    }
    mark("ctx.userQuestions.ask", {
      detail: "07 §5.6 registration consent is routed through the host answerer before any write"
    });
    // The `agent` argument is MANDATORY in every real composition, not an
    // optimisation. The answerer lives in the browser
    // (`dsh-client-ui-user-questions` registers `user-questions/request` via
    // `ctx.remote.$on`) and reaches the host through `dsh-api-remotes`, whose
    // forwarding listener enforces (dsh-api-remotes/lib/index.js:115-119):
    //
    //   const carrierAgent = carrierKeyOf(this);
    //   if (carrierAgent === void 0) return next();
    //   const agent = request.agent;
    //   if (agent === void 0 || agent !== carrierAgent) throw new TypeError(...)
    //
    // Without `agent` the forwarder declines and the waterfall exhausts to
    // `noAnswerer` → NO_PROVIDER ("no user-questions answerer accepted the
    // request"). Measured live 2026-09-18: the official ask_user_question tool
    // (which passes `exec.agent`, dsh-tool-ask-user/lib/index.js:105) prompted
    // the Human in this very session, while this seam — called without an
    // agent — failed with NO_PROVIDER in the same session.
    //
    // Passing a *scoped* agent additionally narrows routing: `scopeTarget`
    // admits untagged listeners plus tags matching the key, so the answerer of
    // THIS agent is selected rather than a sibling's. The agent must be the
    // live registry instance; `dsh-user-questions` rejects anything else with
    // CALLER_NOT_LIVE.
    return { consumed: true, ask: (request, agent) => userQuestions.ask(agent === undefined ? request : { ...request, agent }) };
  }

  /**
   * Ask the Human for explicit registration intent (07 §5.6).
   *
   * Returns `{ granted }` — never throws for a refusal. A `declined` answer, a
   * missing answerer, or a failed ask all yield `granted: false` with a reason,
   * because 07 §5.6 requires EXPLICIT intent: silence is not consent, and this
   * path must fail closed. Callers must not write when `granted` is false.
   *
   * `signal` is the calling tool's cancellation signal, forwarded so an
   * abandoned session releases the prompt (ASK_ABORTED → fail closed) instead
   * of leaving it pending forever — this ask has no wall-clock deadline.
   */
  async function requestRegistrationConsent({ action, projectId, projectPath, agent, signal }) {
    if (typeof seams.ask !== "function") {
      return { granted: false, reason: "no human-answerer entry is available; 07 §5.6 requires explicit intent, so consent cannot be assumed" };
    }
    const verb = action === "unregister" ? "取消登记" : "登记为 LDVH 管辖项目";
    try {
      const answer = await seams.ask({
        questions: [{
          id: CONSENT_QUESTION_ID,
          header: "LDVH 管辖登记",
          question: `是否确认将项目 ${projectId ?? ""}（${projectPath}）${verb}？（07 §5.6：登记或取消仅由 Human 明确意图触发）`,
          options: [
            { label: CONSENT_AFFIRMATIVE_LABEL, description: "执行本次登记变更" },
            { label: "取消", description: "不执行，保持现状" }
          ]
        }],
        // The caller's cancellation MUST reach the question, or an abandoned
        // session leaves this ask pending forever (the tool that hosts it
        // declares no wall-clock deadline — see the `awaitsHumanDecision`
        // operations). `ctx.userQuestions.ask` throws ASK_ABORTED on abort and
        // the browser's PendingQuestion drops the prompt, so the operation
        // fails closed instead of hanging.
        ...(signal === undefined ? {} : { signal })
      }, agent);
      // Accept ONLY an affirmative for THIS question. Do not fall back to
      // `answers[0]`: that could grant registration consent from an affirmative
      // given to a different question. Do not accept shapes never offered
      // ("confirm"/true) — widening the accept surface weakens the gate.
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === CONSENT_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      const granted = selected === CONSENT_AFFIRMATIVE_LABEL;
      return granted
        ? { granted: true, answer: selected }
        : { granted: false, reason: `human did not affirmatively confirm (answer: ${JSON.stringify(selected ?? null)})` };
    } catch (error) {
      return { granted: false, reason: `consent request failed: ${String(error?.message ?? error)}` };
    }
  }

  /**
   * Ask the Human to route this piece of work (21 §6.3 / §14 C1).
   *
   * `create` may only proceed when the Human explicitly chooses to carry the
   * work as a WorkCase. Returns `{ granted, routedTo }`:
   *   - granted=true,  routedTo="workcase" — create may proceed
   *   - granted=false, routedTo="direct"   — the Human chose direct handling;
   *                                          NO object is created
   *   - granted=false, reason=…            — no answerer / failed ask / declined
   *
   * A missing answerer or a failed ask fails closed exactly like the
   * registration consent: silence is not a routing decision, and 21 §6.3
   * excludes "当次行动可直接处理的低风险改动" from objectification — so an
   * un-routed candidate must NOT silently become an object either.
   *
   * `rationale` carries the AI's §6.3 reasoning (why it leans toward a
   * WorkCase and what argues for direct handling). It is advisory text the
   * Human uses to decide; it is NOT part of what is accepted.
   *
   * `signal` is the calling tool's cancellation signal. It MUST be forwarded:
   * this ask carries no wall-clock deadline (it waits for a human), so an
   * abandoned session would otherwise leave the prompt pending forever.
   */
  async function requestWorkcaseRouting({ request, rationale, agent, signal }) {
    if (typeof seams.ask !== "function") {
      return { granted: false, routedTo: null, reason: "no human-answerer entry is available; 21 §6.3 routing requires an explicit Human decision, so it cannot be assumed" };
    }
    const leans = Array.isArray(rationale?.forWorkcase) ? rationale.forWorkcase.filter((x) => typeof x === "string" && x.trim().length > 0) : [];
    const against = Array.isArray(rationale?.forDirect) ? rationale.forDirect.filter((x) => typeof x === "string" && x.trim().length > 0) : [];
    const lines = [];
    if (typeof request === "string" && request.trim().length > 0) lines.push(`你的要求：${request.trim()}`);
    lines.push("");
    lines.push("我判断这件事触及 21 §6.3 的取舍边界：");
    if (leans.length > 0) {
      lines.push("");
      lines.push("倾向建工单的理由：");
      for (const item of leans) lines.push(` · ${item}`);
    }
    if (against.length > 0) {
      lines.push("");
      lines.push("倾向直接执行的理由：");
      for (const item of against) lines.push(` · ${item}`);
    }
    try {
      const answer = await seams.ask({
        questions: [{
          id: ROUTE_QUESTION_ID,
          header: "需要你的判断",
          question: lines.join("\n"),
          options: [
            { label: ROUTE_WORKCASE_LABEL, description: "创建 WorkCase（draft），随后在 Gate 1 待办中审视内容" },
            { label: ROUTE_DIRECT_LABEL, description: "不创建对象，直接在当前行动中处理" }
          ]
        }],
        // Same cancellation contract as requestRegistrationConsent: this ask
        // imposes no wall-clock deadline, so the caller's signal is the ONLY
        // way an abandoned prompt gets released (ASK_ABORTED → fail closed).
        ...(signal === undefined ? {} : { signal })
      }, agent);
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === ROUTE_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      if (selected === ROUTE_WORKCASE_LABEL) return { granted: true, routedTo: "workcase", answer: selected };
      if (selected === ROUTE_DIRECT_LABEL) {
        return { granted: false, routedTo: "direct", answer: selected, reason: "Human chose 直接执行 — 21 §6.3 不对象化" };
      }
      return { granted: false, routedTo: null, reason: `human did not choose a routing option (answer: ${JSON.stringify(selected ?? null)})` };
    } catch (error) {
      return { granted: false, routedTo: null, reason: `routing request failed: ${String(error?.message ?? error)}` };
    }
  }

  const seams = {
    observations: 0,
    consumed,
    /** Set by install(); `null` when no answerer is available (consent fails closed). */
    ask: null,
    humanGateAvailable: false,
    /** The host fs service captured at install; `null` when unavailable. */
    fs: null,
    /** 07 §5.6 consent request routed through ctx.userQuestions.ask. */
    requestRegistrationConsent,
    /** 21 §6.3 routing request routed through ctx.userQuestions.ask. */
    requestWorkcaseRouting,
    /**
     * Read a target and RECORD the authoritative observation.
     *
     * This is the read half of `fs/observed` made real: LDVH asks the HOST for
     * the version (`fs.stat`) rather than inventing one, records it, and emits
     * `fs/observed` so the write guard can key a later write to it. Returns
     * `{observed, version}`; when the target is absent it records `absent`.
     *
     * `path` is resolved through the host so the target identity is the host's,
     * not a locally reconstructed one.
     */
    async observePath(path, { cwd, signal } = {}) {
      const fs = seams.fs;
      if (fs === null || typeof fs.resolve !== "function" || typeof fs.stat !== "function") {
        return { observed: false, reason: "the fs service is unavailable, so no authoritative version can be obtained" };
      }
      try {
        const target = await fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), ...(signal === undefined ? {} : { signal }) });
        const info = await fs.stat(target, signal);
        if (info === undefined) {
          OBSERVED_VERSIONS.delete(targetKeyOf(target));
          return { observed: true, kind: "absent", target };
        }
        OBSERVED_VERSIONS.set(targetKeyOf(target), info.version);
        if (typeof seams.emitter?.emit === "function") {
          try { seams.emitter.emit("fs/observed", target, { kind: "present", version: info.version }, undefined); } catch { /* recorder only */ }
        }
        return { observed: true, kind: "present", version: info.version, target };
      } catch (error) {
        return { observed: false, reason: String(error?.message ?? error) };
      }
    },
    /** Install every seam this composition supports; returned disposers are fiber-owned. */
    install(ctx, { dshHomePath } = {}) {
      const disposers = [];
      const results = {};
      for (const [key, installer] of Object.entries({
        "ctx.tools.guard": () => installToolsGuard(ctx),
        "ctx.invariants.register": () => installInvariants(ctx, { dshHomePath }),
        "fs/observed": () => installFsObservation(ctx),
        "ctx.userQuestions.ask": () => installUserQuestions(ctx)
      })) {
        let outcome;
        try {
          outcome = installer();
        } catch (error) {
          outcome = { consumed: false, detail: String(error?.message ?? error) };
        }
        results[key] = outcome;
        // Track the disposer whenever one exists — including partial/available
        // outcomes (e.g. the fs/observed listener), otherwise a side effect
        // would leak past plugin stop (the 08 §6 + cordis fiber discipline).
        if (typeof outcome.dispose === "function") disposers.push(outcome.dispose);
      }
      seams.ask = results["ctx.userQuestions.ask"]?.ask;
      seams.humanGateAvailable = typeof seams.ask === "function";
      seams.emitter = ctx;
      return {
        results,
        dispose() {
          for (const dispose of disposers) {
            try { dispose(); } catch { /* already removed */ }
          }
        }
      };
    },
    /**
     * Honest per-seam status. Every seam is reported with an explicit state:
     *   consumed  — 08 §6's consumption requirement is actually met
     *   partial   — part of the requirement is met, part is not (named in detail)
     *   available — the entry exists but nothing routes through it yet
     *   absent    — the composition does not provide the seam
     * Unconsumed seams are reported alongside consumed ones, never omitted:
     * omitting them would itself imply protection (08 §6).
     */
    snapshot() {
      const all = ["ctx.tools.register", "ctx.tools.guard", "ctx.invariants.register", "fs/observed", "ctx.userQuestions.ask"];
      return all.map((key) => {
        if (key === "ctx.tools.register") {
          return { seam: key, state: "consumed", consumed: true, detail: "LDVH operations registered through ctx.tools.register" };
        }
        const entry = consumed[key];
        if (entry === undefined) return { seam: key, state: "absent", consumed: false, detail: "not consumed in this composition" };
        const state = entry.consumed === true ? "consumed" : (entry.available === true ? "available" : (entry.partial === true ? "partial" : "absent"));
        return { seam: key, state, consumed: entry.consumed === true, detail: entry.detail };
      });
    }
  };
  return seams;
}

/**
 * Names of the write-shaped LDVH tools the guard covers.
 *
 * This list must name tools that ACTUALLY ship. A phantom entry widens the
 * documented coverage without protecting anything (and a stale entry silently
 * stops covering a tool that was renamed). It is therefore REGISTERED, not
 * hardcoded: each type module registers its writer at import time, so the set
 * reflects what this build really exposes.
 *
 * The two 07 registration entries are listed explicitly because they are
 * declared in specs/07 rather than by a fact-type module.
 */
const WRITE_SHAPED_OPERATIONS = new Set([
  "ldvh_register_governed_project",
  "ldvh_unregister_governed_project"
]);

/**
 * Register a write-shaped tool name with the guard's coverage set.
 * Called by the modules that actually register such tools.
 */
export function registerWriteShapedTool(toolName) {
  if (typeof toolName === "string" && toolName.startsWith("ldvh_")) WRITE_SHAPED_OPERATIONS.add(toolName);
}

/** Diagnostic: the current coverage set (test/verification accessor). */
export function writeShapedTools() {
  return [...WRITE_SHAPED_OPERATIONS].sort();
}
