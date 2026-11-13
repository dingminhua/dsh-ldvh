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

import { REVIEW_ASK_ANSWERS,
  REVIEW_ASK_PLACEHOLDER_TASK,
  REVIEW_ASK_POINTS,
  composeReviewAsk,
  findReviewAskDecision,
  recordReviewAskDecision,
  reviewAskFingerprint,
} from "./review-ask.js";

/** 两处把关询问的 question id 与选项标签——问什么与认什么共用同一常量，
 * 使解析永不因一个从未提供过的标签而判定成立（与 CONSENT 同一纪律）。 */
const REVIEW_ASK_QUESTION_ID = "ldvh-review-ask";
const REVIEW_ASK_REVIEW_LABEL = "安排代理";
const REVIEW_ASK_SKIP_LABEL = "跳过，直接推进";

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

/**
 * `question` 文本的字符上界（ADR 7ceaf7fc 的实现侧落地）。
 *
 * 宿主把 `question` 渲染为标题区（`flex-shrink:0`，无截断、无行数上限、无
 * 滚动），而 `detail` 与选项同处可滚动 body。超长 `question` 顶高卡片后把
 * 选项挤出可视范围，Human 无从作答——实测三次 Spark 创建提请因此 fail-closed。
 * 宿主侧对长度零校验零截断，故本上界只能由本消费侧自查。
 */
export const ASK_QUESTION_MAX_CHARS = 200;

/**
 * 按字符预算裁剪外壳文本，不拆散代理对。
 *
 * 预算以 **UTF-16 码元**（`String.prototype.length`）计量，与仓内既有 200 字符
 * 上界同一口径——否则含代理对的文本
 * （emoji 等）会以「码点数 ≤ 200 而 .length 达 366」的形式越过上界。裁剪时按
 * 码元回退，不把一个代理对劈成两半（半个码元会渲染成替换字符）。
 *
 * 仅用于**短外壳**的兜底：呈报正文永不经过这里（它整体走 detail）。
 */
function clampHead(text, budget) {
  if (text.length <= budget) return text;
  let cut = Math.max(0, budget - 1); // 末位留给省略号
  // 不劈开代理对：若切点落在高代理项之后（切点前一位是高代理项），前移一格。
  const prev = text.charCodeAt(cut - 1);
  if (cut > 0 && prev >= 0xd800 && prev <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * 有界组装（ADR 7ceaf7fc）：短外壳进 `question`，完整呈报进 `question.detail`。
 *
 * - `head` — 短外壳行（Gate 名与对象标题）。逐字进入 `question`，超出
 *   `ASK_QUESTION_MAX_CHARS` 时按预算裁剪（只裁外壳，不裁呈报）。
 * - `detail` — 本次请求未经任何裁剪的完整呈报文本，原样承载。宿主不校验
 *   `detail` 长度，且它渲染于可滚动 body 内，是宿主已提供的长文本位置。
 *
 * 不变量（由 plugin/test 断言）：返回的 `question` 长度 ≤ 上界；`detail`
 * 逐字包含全部呈报内容。任何呈报内容的**丢失**都不可能发生——超限时的处置是
 * 移入 detail，不是截断。
 */
function assembleBoundedAsk({ head, detail }) {
  const lines = (Array.isArray(head) ? head : [])
    .filter((line) => typeof line === "string" && line.trim().length > 0)
    .map((line) => line.trim());
  const report = typeof detail === "string" && detail.trim().length > 0 ? detail.trim() : null;
  return {
    question: clampHead(lines.join("\n"), ASK_QUESTION_MAX_CHARS),
    ...(report === null ? {} : { detail: report })
  };
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

/** 20 §16 Spark Human Gate identity — 创建与终态转换两项共用同一询问 id
 * （一次处置只问一次；两项的呈报内容不同，故 id 相同而 question 文本分列）。
 * 与登记同意同纪律：id 与肯定标签在「问」与「收」两处共用同一常量，解析
 * 永远不会在从未提供过的标签上放行。
 *
 * 大改项（§16 第三项）**不走本 seam**：`09 §5` 判定其语义在形式上不可分，
 * 故按 `09 §6` 弱约束处理——实现只交还 question/scope_boundary 的现值与拟
 * 改值对照，不阻断、不代为判定。本 seam 不承载该项，也不得据其存在声称
 * 大改项已获机械保障。 */
const SPARK_CONSENT_QUESTION_ID = "ldvh-spark-consent";
const SPARK_CONSENT_LABEL = "确认";

/** 22 §16 ADR Human Gate identity — 第 1 项（创建）与第 2 项（终态决定 retired）
 * 共用同一询问 id：一次处置只问一次，两项的呈报内容不同故 question 文本分列。
 * 与 Spark 同纪律：id 与肯定标签在「问」与「收」两处共用同一常量，解析永远不会
 * 在从未提供过的标签上放行。
 *
 * **第 3 项（`specs/22-ADR-决策.md:270` ADR 类型本身的取消或合并）不走本 seam**：
 * 该动作当前无实现入口，本 seam 不承载它，也不得据其存在声称第 3 项已获承载。 */
const ADR_CONSENT_QUESTION_ID = "ldvh-adr-consent";
const ADR_CONSENT_LABEL = "确认";

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
export function createHostSeams() {
  const consumed = Object.create(null);
  const mark = (key, detail) => { consumed[key] = { consumed: true, ...detail }; };
  let questionContext = null;
  let questionGeneration = 0;
  let usedQuestionService = null;

  // The service is optional and may become available after this plugin starts.
  // Resolve it at use time; a missing service or lookup failure never grants.
  function currentUserQuestions() {
    try {
      const service = questionContext?.get("userQuestions");
      return typeof service?.ask === "function" ? service : null;
    } catch {
      return null;
    }
  }

  // Cordis may return a new traceable proxy on every get(). Its exported
  // original symbol identifies the underlying service; if identity cannot be
  // established, diagnostics stay conservative without affecting the Gate.
  function questionServiceIdentity(service) {
    try {
      const original = service?.[Symbol.for("cordis.original")] ?? service;
      return original !== null && (typeof original === "object" || typeof original === "function") ? original : null;
    } catch {
      return null;
    }
  }

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
    return { consumed: false, available: true, detail: "userQuestions service is available; actual use is tracked when a request is sent" };
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
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { granted: false, reason: "no human-answerer entry is available; 07 §5.6 requires explicit intent, so consent cannot be assumed" };
    }
    const verb = action === "unregister" ? "取消登记" : "登记为 LDVH 管辖项目";
    try {
      const answer = await ask({
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
   * Ask the Human to confirm one Spark action (20 §16).
   *
   * 20 §16 registers three Human Gates for this type (创建 / 终态转换 /
   * 问题·边界大改). Two of them are carried HERE: create and the terminal
   * transition. The third (大改) is deliberately NOT carried by this seam — see
   * the note on `SPARK_CONSENT_QUESTION_ID`; it is a `09 §6` weak constraint
   * whose judgement the implementation must NOT make.
   *
   * Same discipline as the other consent seams: the Human's own answer is
   * recorded by the host, not asserted by the AI. A missing answerer, a failed
   * ask or an unchosen/declined answer all yield `granted: false` — silence is
   * not consent, and this path must fail closed.
   *
   * `signal` is forwarded so an abandoned prompt is released (ASK_ABORTED →
   * fail closed) instead of pending forever: the hosting tool declares no
   * wall-clock deadline (`awaitsHumanDecision`).
   *
   * `summary` is the 呈报内容 required by 20 §16 — the caller passes what the
   * Human must see to judge (create: dedup conclusion + question +
   * scope_boundary + serves; terminal: target status + disposition + relation
   * targets). It is carried verbatim — but in `question.detail`, not in
   * `question` (ADR 7ceaf7fc: the title area is not scrollable, so an
   * unbounded report there pushes the options out of reach). Either way a
   * caller cannot satisfy this gate with an empty or generic report.
   */
  async function requestSparkConsent({ action, objectTitle, summary, agent, signal }) {
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { granted: false, reason: "no human-answerer entry is available; 20 §16 requires an explicit Human confirmation, so consent cannot be assumed" };
    }
    const verb = action === "terminal" ? "转入终态" : "创建";
    const report = typeof summary === "string" && summary.trim().length > 0
      ? summary.trim()
      : null;
    // 20 §16 requires the Human to receive the 呈报内容. A caller that sends
    // none is refused rather than asked a content-free question: asking without
    // the report would record a "yes" to something the Human never saw.
    if (report === null) {
      return { granted: false, reason: "20 §16 requires the 呈报内容 (the elements the Human judges) to be presented before the question; none was supplied, so no question was asked" };
    }
    // 有界组装（ADR 7ceaf7fc）：question 只放短外壳（Gate 名与对象标题），
    // 20 §16 的完整呈报逐字进 detail。外壳 53 字符 + disposition 上界 200
    // 字符使原组装至少 227 字符，故必须移入 detail 而不是压缩。
    const head = [`Spark ${verb}确认（20 §16 Human Gate）`];
    if (typeof objectTitle === "string" && objectTitle.trim().length > 0) head.push(`对象：${objectTitle.trim()}`);
    const assembled = assembleBoundedAsk({ head, detail: report });
    try {
      const answer = await ask({
        questions: [{
          id: SPARK_CONSENT_QUESTION_ID,
          header: "Spark 授权",
          question: assembled.question,
          ...(assembled.detail === undefined ? {} : { detail: assembled.detail }),
          options: [
            { label: SPARK_CONSENT_LABEL, description: `确认${verb}该 Spark 对象` },
            { label: "取消", description: "不执行本次写入，保持现状" }
          ]
        }],
        ...(signal === undefined ? {} : { signal })
      }, agent);
      // Accept ONLY the affirmative for THIS question. Do not fall back to
      // `answers[0]` — that could grant Spark consent from an affirmative given
      // to a different question in the same batch.
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === SPARK_CONSENT_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      if (selected === SPARK_CONSENT_LABEL) return { granted: true, answer: selected };
      return { granted: false, reason: `human did not confirm the Spark ${verb} (answer: ${JSON.stringify(selected ?? null)})` };
    } catch (error) {
      return { granted: false, reason: `spark consent request failed: ${String(error?.message ?? error)}` };
    }
  }

  /**
   * Ask the Human to confirm one ADR action (22 §16 Human Gate).
   *
   * Carries the first two of the three 22 §16 Gates: 创建 (action=create) and
   * 终态决定 retired (action=retire). The third (`:270` ADR 类型本身的取消或
   * 合并) has no implementation entry and is deliberately NOT carried here.
   *
   * Same discipline as `requestSparkConsent`: the Human's own answer is recorded
   * by the host, not asserted by the AI. A missing answerer, a failed ask or an
   * unchosen/declined answer all yield `granted: false` — silence is not
   * consent, and this path must fail closed.
   *
   * `signal` is forwarded so an abandoned prompt is released (ASK_ABORTED →
   * fail closed) instead of pending forever: the hosting tool declares no
   * wall-clock deadline (`awaitsHumanDecision`).
   *
   * `summary` is the 呈报内容 the Human must see to judge — create: the dedup
   * conclusion + title/decision/scope; retire: retirement_reason + the full
   * change_log.summary evidence statement + relation targets (22 §10). A caller
   * that supplies none is refused rather than asked a content-free question:
   * asking without the report would record a "yes" to something never seen.
   * The report goes in `question.detail`, not `question` (ADR 7ceaf7fc).
   */
  async function requestAdrConsent({ action, objectTitle, summary, agent, signal }) {
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { granted: false, reason: "no human-answerer entry is available; 22 §16 requires an explicit Human confirmation, so consent cannot be assumed" };
    }
    const verb = action === "retire" ? "转入终态" : "创建";
    const report = typeof summary === "string" && summary.trim().length > 0
      ? summary.trim()
      : null;
    // 22 §16 requires the 呈报内容 before the question (mirrors 20 §16 at
    // requestSparkConsent): a content-free ask would record consent to
    // something the Human never saw.
    if (report === null) {
      return { granted: false, reason: "22 §16 requires the 呈报内容 (the elements the Human judges) to be presented before the question; none was supplied, so no question was asked" };
    }
    // 有界组装（ADR 7ceaf7fc）：question 只放短外壳（Gate 名与对象标题），完整
    // 呈报逐字进 detail——退休呈报含退休理由全文与 change_log.summary，必然超 200。
    const head = [`ADR ${verb}确认（22 §16 Human Gate）`];
    if (typeof objectTitle === "string" && objectTitle.trim().length > 0) head.push(`对象：${objectTitle.trim()}`);
    const assembled = assembleBoundedAsk({ head, detail: report });
    try {
      const answer = await ask({
        questions: [{
          id: ADR_CONSENT_QUESTION_ID,
          header: "ADR 授权",
          question: assembled.question,
          ...(assembled.detail === undefined ? {} : { detail: assembled.detail }),
          options: [
            { label: ADR_CONSENT_LABEL, description: `确认${verb}该 ADR 对象` },
            { label: "取消", description: "不执行本次写入，保持现状" }
          ]
        }],
        ...(signal === undefined ? {} : { signal })
      }, agent);
      // Accept ONLY the affirmative for THIS question — never fall back to
      // `answers[0]`, which could grant ADR consent from an affirmative given
      // to a different question in the same batch.
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === ADR_CONSENT_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      if (selected === ADR_CONSENT_LABEL) return { granted: true, answer: selected };
      return { granted: false, reason: `human did not confirm the ADR ${verb} (answer: ${JSON.stringify(selected ?? null)})` };
    } catch (error) {
      return { granted: false, reason: `adr consent request failed: ${String(error?.message ?? error)}` };
    }
  }

    /**
     * 两处把关询问（2026-11-13 Human 决定：取消工单→改问「要不要安排代理」）。
     *
     * 与上面三处 consent 的**根本差别**：那三处是 Human Gate（不取得答复就不许
     * 继续，fail-closed）。本处**不是 Gate**——Human 选「跳过」是**合法答复**，
     * 不是拒绝。所以本函数的返回值不叫 `granted`，叫 `decision`：
     *
     *   - `"review"` —— 安排代理；
     *   - `"skip"`   —— 不安排（明确答复，不是未决策）；
     *   - `null`     —— 未取得答复（无答题器／询问失败／人跳过未选）。
     *
     * 空答复（`selected: []`）**不落载体**：它是「未决策」，落盘会让下一次误以为
     * 问过了而直接复用一个不存在的决定（与其他接缝同纪律）。
     *
     * 开关关闭时**直接返回 null 且不问**——这是 Human 的原话「打开才有」。调用方
     * 传入 `enabled: false` 即走这条路径；本函数不自己读配置，因为配置读取属
     * 装配侧（host-seams 不认识 Cordis Config）。
     */
  /**
   * 把关询问的身份范围：会话 id + 会话工作目录。
   *
   * 只用**宿主提供的**身份（`agent.session.header`），不让调用方自报——自报键
   * 会被填成固定值，等于退回全局键。取不到时返回 `undefined`，指纹退回旧形态
   * （偏重复提问而非跨项目复用）。
   */
  /**
   * 把关询问的身份范围：会话 id + 会话工作目录。
   *
   * **只从宿主提供的身份取**（`agent.session.header`），不让调用方自报——自报键
   * 会被填成固定值，等于退回全局键。
   *
   * @returns {{scope: string|undefined, sessionIdentified: boolean}}
   *   `sessionIdentified: false` 表示**会话 id 取不到**。此时 scope **不得**被
   *   用来复用答复：只带 cwd 的 scope 会让**同项目下另一个会话**的询问命中上一
   *   会话的记录，静默复用别的上下文的决定（2026-11-13 独立审核 MAJOR-3）。
   *   故这种情况走「每次都问」，宁可多问一次。
   */
  function reviewAskScopeKey(agent) {
    const header = agent?.session?.header;
    if (header === undefined || header === null) return { scope: undefined, sessionIdentified: false };
    const parts = [];
    const id = header.sessionId ?? header.id ?? agent?.session?.id;
    const sessionIdentified = typeof id === "string" && id.length > 0;
    if (sessionIdentified) parts.push(`session:${id}`);
    const cwd = header.cwd;
    if (typeof cwd === "string" && cwd.length > 0) parts.push(`cwd:${cwd}`);
    return { scope: parts.length === 0 ? undefined : parts.join("|"), sessionIdentified };
  }

  async function requestReviewAsk({ point, task, enabled, agent, signal }) {
    if (enabled !== true) {
      return { decision: null, asked: false, reason: "the review-ask switch is off for this point — no prompt is issued (2026-11-13 Human decision: 打开才有)" };
    }
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { decision: null, asked: false, reason: "no human-answerer entry is available; the review-ask cannot be issued, so no decision is assumed" };
    }
    // 先读后问：同一内容指纹问过一次就不再问（消灭「同一件事问两次」）。
    //
    // **指纹必须带会话与项目范围**（2026-11-13 独立审核 MAJOR #2）。
    //
    // 原实现只喂 { point, task }，而 `task` 在工具面是**可省的**——于是所有不带
    // task 的 pre-action 询问共用一个指纹（实测同为 298fbda3…）。载体落在
    // `~/.dsh/ldvh/review-ask-decisions.json`，是**全局**的（不分项目、不分会话）。
    //
    // 后果实测：
    //   * 第一次答 `skip` → 之后所有同类任务**静默不再问**（Human 以为机制在跑，
    //     其实早已失效）；
    //   * 第一次答 `review` → 另一件事也被当成「Human 已同意安排复核」，
    //     把一个**别的上下文里**的决定搬过来用。
    //
    // 取身份只从 `agent` 读，**不接受调用方自报**：能自报的键迟早会被填成固定值，
    // 那等于又退回全局键。两者都取不到时**退回不带 scope 的旧键**——宁可偶尔重复
    // 提问（代价：多问一次），也不要跨项目静默复用（代价：机制失效且无人察觉）。
    const scopeInfo = reviewAskScopeKey(agent);
    const scopeKey = scopeInfo.scope;
    const fingerprint = reviewAskFingerprint({ point, task, scope: scopeKey });
    // **会话 id 取不到 ⇒ 禁止复用**（2026-11-13 独立审核 MAJOR-3，fail-closed）。
    //
    // scope 降级成「只带 cwd」时，同项目下**另一个会话**的询问会命中本会话的记录
    // ——那正是本机制要消灭的「把别的上下文的决定搬过来用」。宁可多问一次。
    const reuseAllowed = scopeInfo.sessionIdentified;
    const prior = await findReviewAskDecision(seams.dshHomePath, fingerprint);
    if (!prior.ok) {
      // 载体不可读时**不问也不猜**：既不能当「问过」（会跳过 Human），也不能
      // 当「没问过」（会重复提问）。如实返回，由调用方报告并决定怎么处置。
      return { decision: null, asked: false, reason: `${prior.error.code}: ${prior.error.message}`, fingerprint };
    }
    if (prior.value !== null) {
      // **task 为空的历史记录不可复用**（2026-11-13 独立审核 MAJOR-2）。
      //
      // 问题：`task` 是可省参数，省略时指纹 = point + scope，同一会话里**所有**
      // 该位置的询问指纹相同。第一次答 skip 后，另一件复杂任务的询问会静默复用
      // 那次 skip——Human 根本收不到第二次提问。这正是本机制要消灭的失效，
      // 只是从「全局」缩小到了「会话内」。
      //
      // 为什么不用「task 设为必填」：那会让模型忘填时直接调用失败，违背
      // 「缺任务描述时不虚构，退化成中性占位」的设计。也不用「拿会话消息参与
      // 指纹」：那会破坏「同一件事重试不重问」这个核心语义。
      //
      // 本解法的判据是**记录本身能否标识「是哪件事」**：task 为空的记录标识不了，
      // 故不复用——宁可多问一次（代价：一次弹窗），也不静默套用无关答复（代价：
      // 机制失效且无人察觉）。新问出来的答复会覆盖旧记录（latest-wins）。
      const priorTask = prior.value.task;
      // 占位词与 null 同义（2026-11-13 独立审核 MAJOR-2）：占位词记录标识不了
      // 「是哪件事」，若判为「可复用」，模型传恒定字符串时静默复用复发。
      const priorIsPlaceholder = typeof priorTask === "string" && priorTask.trim() === REVIEW_ASK_PLACEHOLDER_TASK;
      const reusable =
        reuseAllowed
        && typeof priorTask === "string"
        && priorTask.trim().length > 0
        && !priorIsPlaceholder;
      if (!reusable) {
        // 不可复用 → 继续往下问，不返回。
      } else {
        return {
          decision: prior.value.answer,
          asked: false,
          reused: true,
          fingerprint,
          reason: `reused the recorded answer from ${prior.value.at} (same content fingerprint — not asked again)`,
        };
      }
    }
    const composed = composeReviewAsk({ point, task });
    try {
      const answer = await ask({
        questions: [{
          id: REVIEW_ASK_QUESTION_ID,
          // header 与 question 不重复（Human 2026-11-13：对话框太啰嗦）。
          // question 已写明「<做什么>——要不要安排审查？」，header 只留一个短标签；
          // options 的 description 也压成一句话，不再重述 detail 里已有的后果。
          header: point === REVIEW_ASK_POINTS.PRE_ACTION ? "审查" : "复核",
          question: composed.question,
          // **不带 detail**（Human 2026-11-13 截图指认）：detail 与两个选项说的是
          // 同一件事，卡片上于是三处重复。宿主契约里 detail 是 optional，缺省即
          // 不渲染该块。
          //
          // 后果信息改由**选项的 description** 承担——选项就贴在答案输入框上方，
          // 是 Human 实际会读的地方；原先第二个选项的 description「直接推进」与
          // 它自己的标签「跳过，直接推进」逐字重复，等于没写。
          options: [
            {
              label: REVIEW_ASK_REVIEW_LABEL,
              description: point === REVIEW_ASK_POINTS.PRE_ACTION
                ? "派独立子代理先对这个方案挑错，结论回来后再动手"
                : "派独立子代理逐条核对这次已做的工作，结论回来后再收口",
            },
            { label: REVIEW_ASK_SKIP_LABEL, description: "本次不做独立把关，主控自查仍在" }
          ]
        }],
        ...(signal === undefined ? {} : { signal })
      }, agent);
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === REVIEW_ASK_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      if (selected !== REVIEW_ASK_REVIEW_LABEL && selected !== REVIEW_ASK_SKIP_LABEL) {
        return { decision: null, asked: true, fingerprint, reason: `human did not choose an option (answer: ${JSON.stringify(selected ?? null)}) — 未决策不是答复，下次仍会问` };
      }
      const decision = selected === REVIEW_ASK_REVIEW_LABEL ? REVIEW_ASK_ANSWERS.REVIEW : REVIEW_ASK_ANSWERS.SKIP;
      // **写入载体时把占位词归一为 null**（MAJOR-2）：载体里的 task 是「这件事
      // 是什么」的标识，占位词不承载该语义；留着它会让复用门误判。
      const recorded = await recordReviewAskDecision(seams.dshHomePath, {
        fingerprint,
        point,
        answer: decision,
        task: typeof task === "string" && task.trim() === REVIEW_ASK_PLACEHOLDER_TASK ? null : (task ?? null),
      });
      if (!recorded.ok) {
        // 答复已取得但留不下痕迹：仍如实返回 Human 的选择，同时把留痕失败说
        // 清楚——否则重试时会再问一次，而这正是本载体要消灭的形态。
        return { decision, asked: true, fingerprint, recordError: `${recorded.error.code}: ${recorded.error.message}` };
      }
      return { decision, asked: true, fingerprint, at: recorded.value.at };
    } catch (error) {
      return { decision: null, asked: true, fingerprint, reason: `review-ask request failed: ${String(error?.message ?? error)}` };
    }
  }


  const seams = {
    observations: 0,
    consumed,
    /** Current service adapter, or null; service presence does not prove a Human is connected. */
    get ask() {
      const service = currentUserQuestions();
      if (service === null) return null;
      return (request, agent) => {
        const result = service.ask(agent === undefined ? request : { ...request, agent });
        // Diagnostics must never discard an already-dispatched Human request.
        try {
          const identity = questionServiceIdentity(service);
          usedQuestionService = identity === null ? null : new WeakRef(identity);
        } catch {
          usedQuestionService = null;
        }
        return result;
      };
    },
    get humanGateAvailable() { return currentUserQuestions() !== null; },
    /**
     * The host home resolver captured at install; `null` until then.
     *
     * The review-ask decision carrier needs it to locate its file (先读后问).
     * Before install() it is null, and the seam treats a null resolver exactly
     * like an unreadable carrier: fail closed rather than assume "never asked"
     * (that would re-ask the Human — the very defect the carrier exists to
     * remove).
     */
    dshHomePath: null,
    /** The host fs service captured at install; `null` when unavailable. */
    fs: null,
    /** 07 §5.6 consent request routed through ctx.userQuestions.ask. */
    requestRegistrationConsent,
    /** 20 §16 Spark create/terminal confirmation routed through ctx.userQuestions.ask. */
    requestSparkConsent,
    /** 22 §16 ADR create/retire confirmation routed through ctx.userQuestions.ask. */
    requestAdrConsent,
    /** 两处把关询问（2026-11-13 Human 决定）：非 Gate——`skip` 是合法答复。 */
    requestReviewAsk,
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
      const questionEpoch = ++questionGeneration;
      questionContext = ctx;
      usedQuestionService = null;
      // 询问的持久载体需要 home 解析器（先读后问）。在此保存：install 是唯一
      // 能拿到它的地方，而询问接缝在之后被调用。
      seams.dshHomePath = typeof dshHomePath === "function" ? dshHomePath : null;
      seams.emitter = ctx;
      return {
        results,
        dispose() {
          // An older installation must not detach a newer one. Clear the
          // current owner synchronously before releasing any other effects.
          if (questionEpoch === questionGeneration) {
            questionContext = null;
            usedQuestionService = null;
            delete consumed["ctx.userQuestions.ask"];
          }
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
        if (key === "ctx.userQuestions.ask") {
          const service = currentUserQuestions();
          const identity = service === null ? null : questionServiceIdentity(service);
          const used = identity !== null && usedQuestionService?.deref() === identity;
          return {
            seam: key,
            state: service === null ? "absent" : (used ? "consumed" : "available"),
            consumed: used,
            detail: service === null
              ? "the userQuestions service is unavailable; new requests fail closed"
              : (used
                  ? "a request was sent through the current userQuestions service; a Human answer is not guaranteed"
                  : "the current userQuestions service is available but has not been used")
          };
        }
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
