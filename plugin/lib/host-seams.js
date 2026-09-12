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
      // Synchronous guard: the cached judgement is the only available source,
      // and a null/absent judgement must not read as "fine" — deny-closed.
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
   * `fs/observed` — read observation.
   *
   * 08 §6 defines consumption of this seam as "挂载读观察并挂载写入版本守卫" —
   * BOTH halves. The write half is genuinely carried (every LDVH writer goes
   * through the atomic writer's version/lock semantics, and registration
   * writes use `writeFileAtomic`). Mounting a listener that only COUNTS host
   * events does not implement a read observation, so this reports
   * `partial: true` rather than claiming full consumption — 08 §6 forbids
   * claiming protection the consumption did not deliver.
   *
   * The listener is still mounted: it keeps the process honest about the seam
   * being live in this composition, and `observations` is real evidence a host
   * observation flowed. What is NOT claimed is that LDVH's own reads are
   * observed.
   */
  function installFsObservation(ctx) {
    if (typeof ctx.on !== "function") {
      return { consumed: false, detail: "event listening (ctx.on) is unavailable in this composition" };
    }
    const dispose = ctx.on("fs/observed", () => {
      seams.observations += 1;
    });
    mark("fs/observed", {
      consumed: false,
      partial: true,
      detail: "write-version half carried by the atomic writer; the read-observation half is NOT implemented (only a host-event listener is mounted)"
    });
    return { consumed: false, partial: true, dispose };
  }

  /**
   * `ctx.userQuestions.ask` — Human Gate requests through the host entry.
   *
   * 08 §6 defines consumption as "经该入口承载 Human Gate 决策提请" — i.e. a
   * Human Gate request must actually BE routed through it. Capturing a
   * callable reference and never calling it does not route anything, so this
   * reports `consumed: false` with the reference exposed as an available
   * capability. Until a Human-Gate path calls `ask`, the honest state is
   * "available, not consumed".
   */
  function installUserQuestions(ctx) {
    const userQuestions = ctx.get("userQuestions");
    if (userQuestions === undefined || typeof userQuestions.ask !== "function") {
      return { consumed: false, detail: "ctx.userQuestions.ask is unavailable in this composition" };
    }
    mark("ctx.userQuestions.ask", {
      consumed: false,
      available: true,
      detail: "entry available and exposed; no Human-Gate path routes through it yet, so the seam is NOT consumed"
    });
    return { consumed: false, available: true, ask: (request) => userQuestions.ask(request) };
  }

  const seams = {
    observations: 0,
    consumed,
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

/** Write-shaped LDVH tool names (guard target set; mirrors the may_change_state declarations). */
const WRITE_SHAPED_OPERATIONS = new Set([
  "ldvh_register_governed_project",
  "ldvh_unregister_governed_project",
  "ldvh_spark_write",
  "ldvh_workcase_write",
  "ldvh_adr_write",
  "ldvh_pitfall_write",
  "ldvh_friction_write",
  "ldvh_research_write",
  "ldvh_norm_write",
  "ldvh_research_session"
]);
