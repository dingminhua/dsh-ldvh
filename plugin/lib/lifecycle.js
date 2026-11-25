
import { resolveGovernanceScope } from "./governance-scope.js";
import { buildNormDirectoryForRoot, normDirectoryDigest, NORM_DIRECTORY_BUDGET_CHARS, NORM_DIRECTORY_SECTION_NAME } from "./norm-directory.js";
import { registerLdvhTools } from "./ldvh-tools.js";
import { createAssembleHandler, createPreStepHandler } from "./guidance.js";
import { RECALL_SUMMARY, buildRecallInjection } from "./recall-injection.js";
import { recallLimitForBudget } from "./source-recall.js";
import { noticeTextFor, noticeSummaryFor } from "./guidance-text.js";
import { buildCaptureNotice, captureNoticeDigest, resolveCaptureSwitches, CAPTURE_NOTICE_SUMMARY } from "./capture-notice.js";
import { createTurnTriggers } from "./triggers.js";
import { recordRun } from "./idle-runlog.js";
import { COMPLEXITY_CRITERIA, GATE_POINT_EXCLUSIONS, REVIEW_ASK_ROW_SUMMARY } from "./review-ask.js";



export function buildReviewAskNotice({ preOn, postOn, preKnown = true, postKnown = true, consultOn = false, consultKnown = true, silentOn = false }) {
  const criteria = COMPLEXITY_CRITERIA
    .map((item, index) => `  ${index + 1}. ${item.label}（${item.source}）`)
    .join("\n");
  const lines = [
    "各处提请的开关状态（行动前与收口前为「那次核对做不做、由谁做」两问——安排代理／主控自己做／跳过三选一，Human 2026-11-13 决定设两问、2026-11-23 决定加主控自做档；第三处为「遇难题：联网调查提请」，三选一为联网调查／主控自调查／先不查，Human 2026-11-19 决定增设）",
  ];
  const stateOf = (on, known) => (on ? "**已开启**" : (known ? "关闭" : "关闭（未设置，按关处理）"));
  lines.push(`- 行动前审查：${stateOf(preOn, preKnown)} ｜ 行动后复核：${stateOf(postOn, postKnown)}`);
  const consultStateOf = (on, known) => (on ? "**已开启**" : (known ? "关闭" : "关闭（未设置——该处按不可用报告，不当作已关闭）"));
  lines.push(`- 遇难题：联网调查提请：${consultStateOf(consultOn, consultKnown)}｜开时，主控自查遇到依赖外部信息、且自己不掌握的事，会先查内部经验／报告／事实规范，未命中才来问你三选一「联网调查／主控自调查／先不查」（见 research-entry 条目）；关时只交还内部读数、不来打扰。`);
  if (silentOn) {
    lines.push("- 静默执行：**已开启** —— 判为复杂任务且**未命中点位排除**时**不问**，直接自动安排那次代理核对；每次须在交付里原样引用该次结果的 notice 一行（静默不等于无痕）。命中点位排除时该处不问**也不派发**——排除管的是那一次核对要不要发生，它优先于档位（见 exclusion-beats-mode 条目）。");
  }
  lines.push("", "判据（不新造；gate-consult-system-foundation 的 complex-task 条目三条正面是条目原文，其排除清单取反是据此推导的判据而非条目原文）：");
  lines.push(criteria);
  const exclusionLines = GATE_POINT_EXCLUSIONS.map((item) => `  - ${item.label}｜承接：${item.carried}｜不适用：${item.notExcluded}`).join("\n");
  lines.push(
    "",
    "点位排除（gate-consult-system-foundation 的 point-exclusions 条目，判为复杂任务**之后**才看；命中则该处**不问**）：",
    exclusionLines,
    "  命中要件：**当次工作整件**只属上述一类——混合任务照旧请示，本文不按动作切分。",
    "  命中不免三件事：complex-task 条目所要求的方案收敛自查与主控自查照做（另见 `ldvh-root` 的 `required-checks` 条目）；任何须人决定事项的提请照提（`ldvh-root` 的 `decisions-are-human` 条目所列根决定、`protected-content` 条目所列受保护内容的同意、管辖登记、各事实类型的创建与终态确认）；独立审核的适用范围照做（受保护内容修改、下位规范建立或实质修改、进入事实源的事实规范候选），见 `ldvh-root` 的 `proxy-review-arrangement` 条目。",
    "  命中即须交付一行：`点位排除：命中〔哪一类〕｜当次整体范围〔…〕｜判定理由〔…〕`——不写这行按未请示处理（见 point-exclusions 条目）。",
  );
  lines.push("");
  if (preOn && silentOn) {
    lines.push("① 行动前（方案已有候选、尚未产生副作用时，见 before-action-entry 条目）：按上面判据判定本次是否「复杂任务」，再看是否命中点位排除。判为复杂**且未命中排除**时，**不要问**——调 `ldvh_review_ask`（须带去除首尾空白后 1–200 个字符的 `candidate_summary`，按字符串长度计，缺或超限会被机械拒绝）会直接返回派发模板，按它派零上下文子代理核对候选，结论回来后再落地。**先把方案压缩成摘要写进 `candidate_summary`**（摘要会进 ask 题面并参与答复复用指纹）；**无候选摘要时不得发起该处请示**，机械闸会直接拒绝（Human 2026-11-25 改裁）；机械层只查摘要存在与字符数，候选内容是否合格仍由主控与 Human 判断；该处核对免的是征询，不是核对本身。");
  } else if (preOn) {
    lines.push("① 行动前（方案已有候选、尚未产生副作用时，见 before-action-entry 条目）：按上面判据判定本次是否「复杂任务」，再看是否命中点位排除。判为复杂**且未命中排除**时，询问 Human「这次审查做不做、由谁做」（三选一：安排代理审查／主控自审／跳过直接推进）。**调用须带去除首尾空白后 1–200 个字符的 `candidate_summary`**（方案摘要，按字符串长度计，写入 ask 题面供人自足作答，并参与答复复用指纹）；**缺候选摘要或超限会被机械拒绝**，不发问、不派代理、不进静默模板（Human 2026-11-25 改裁）；机械层只判断摘要存在与字符数，候选内容是否合格仍由主控与 Human 判断。**答复不构成动手前提**：请示不使行动暂停，未取得答复时按既有路径继续（见 answer-means 条目）。");
  }
  if (postOn && silentOn) {
    lines.push("② 收口前（一件复杂任务做完、尚未形成完成声明时，见 before-closing-entry 条目）：先看是否命中点位排除；**未命中**则**不要问**——调 `ldvh_review_ask`（须带去除首尾空白后 1–200 个字符的 `conclusion_summary`，按字符串长度计，缺或超限会被机械拒绝）直接取派发模板，派零上下文子代理逐条核对后再收口。**先把当前结论压缩成摘要写进 `conclusion_summary`**（摘要进 ask 题面并参与答复复用指纹）；无结论摘要时不得发起该处请示，机械闸直接拒绝（与行动前 candidate_summary 对称）；机械层只判断摘要存在与字符数，结论内容是否合格仍由主控与 Human 判断。");
  } else if (postOn) {
    lines.push("② 收口前（一件复杂任务做完、尚未形成完成声明时，见 before-closing-entry 条目）：先看是否命中点位排除；**未命中**则询问 Human「这次复核做不做、由谁做」（三选一：安排代理复核／主控自查／跳过直接收口）。**调用须带去除首尾空白后 1–200 个字符的 `conclusion_summary`**（当前工作结论的摘要，按字符串长度计，写入 ask 题面供人自足作答——当前题面只有 task、看不到被复核的结论，故此字段不可省——并参与答复复用指纹）；**缺结论摘要或超限会被机械拒绝**，不发问、不派代理、不进静默模板；机械层只判断摘要存在与字符数，结论内容是否合格仍由主控与 Human 判断（与行动前 candidate_summary 对称）。**答复不构成收口前提**：请示不使收口暂停，未取得答复时按既有路径继续并如实说明（见 answer-means 条目）。");
  }
  lines.push("");
  lines.push("提请入口：`ldvh_review_ask`（读开关、记录答复、同一内容不重复提问）。");
  lines.push("**不要改用宿主 ask_user_question**：它不读这两个开关、也不记录答复——关着也会问、问过还会再问。");
  lines.push("**如实边界**：开关只决定「问不问」；「算不算复杂」由你判断，机械层不判定——判错或没判，本机制不会拦。故这不构成机械保障，只是按开关执行的自律 + 答复留痕。");
  return lines.join("\n");
}

import { adoptFinishedChild, createChildInstaller } from "./child.js";
import { resolveChildFromSessionRecord } from "./child-session-record.js";
import { ActivityLog, AgentLifecycle } from "./agent-lifecycle.js";
import { recordJudgementForGuard } from "./host-seams.js";
import { createExperienceArming } from "./experience-arming.js";
import { registerPitfallTools } from "./pitfall-tools.js";
import { registerFrictionChildSurface } from "./friction-tools.js";


function signatureOf(fn) {
  const src = String(fn);
  const open = src.indexOf("(");
  if (open < 0) return src;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(0, i + 1);
    }
  }
  return src.slice(0, open + 1);
}

const DISCRETION_NAMES = ["tier", "riskLayer", "fastPath", "precheckResult", "allowFastPath"];

export function probeFunctionForDiscretion(fn) {
  return probeStructuralFactsWith([["given", fn]]).discretionFound;
}

export function probeStructuralFacts() {


  return probeStructuralFactsWith([], DISCRETION_NAMES);
}

function probeStructuralFactsWith(targets, names = DISCRETION_NAMES) {
  const found = [];
  for (const [name, fn] of targets) {
    if (typeof fn !== "function") {
      found.push(`${name}::missing`);
      continue;
    }
    const signature = signatureOf(fn);
    for (const d of names) {
      const re = new RegExp(`(^|[^A-Za-z0-9_])${d}([^A-Za-z0-9_]|$)`);
      if (re.test(signature)) found.push(`${name}::${d}`);
    }
  }
  return {
    discretionFree: found.length === 0,
    discretionFound: found,
    checked: targets.map(([n]) => n),
    scope: "signature-only",
    at: new Date().toISOString(),
  };
}


export function createLifecycleRegistry(ctx, { dshHomePath, workspaceRoot, sessionScopes, hostSeams, getIdleSettings, getInjectionBudget, getReviewAskSettings }) {
  const agents = new Map();
  const agentEffects = new Map();
  let stopped = false;
  let stopPromise = null;
  const agentTimers = new Map();
  const children = new Map();
  const retiredChildren = new Map();
  const registryActivity = new ActivityLog();
  const experienceArming = createExperienceArming({ dshHomePath, logger: ctx.logger });
  void experienceArming.load().catch((error) => {
    ctx.logger.warn("[dsh-ldvh] experience arming load failed: %s", String(error?.message ?? error));
  });
  const installChild = createChildInstaller(ctx, {
    agents,
    children,
    sessionScopes,
    retiredChildren,
    experienceArming,
    registerChildSurface: (agent) => registerPitfallTools(agent.ctx, {
      dshHomePath,
      workspaceRoot,
      sessionPersistence: () => ctx.get("sessionPersistence"),
      experienceArming
    }, { surface: "child" }),
    registerFrictionChildSurface,
    frictionChildDeps: {
      dshHomePath,
      sessionPersistence: () => ctx.get("sessionPersistence"),
      resolveProjectId: async (agent) => {
        const cwd = agent?.session?.header?.cwd;
        if (typeof cwd !== "string" || cwd.length === 0) return null;
        try {
          const scope = await resolveGovernanceScope(dshHomePath, cwd);
          if (scope?.project?.id === undefined) return null;
          return { id: scope.project.id, path: scope.project.path };
        } catch {
          return null;
        }
      },
      isFrictionDiscoveryEnabled: () => {
        const s = getIdleSettings?.();
        return s ? s.enabled !== false && s.tasks?.["friction-discovery"] !== false : true;
      }
    },
    onEvent: (hook, detail) => registryActivity.record(hook, detail)
  });

  function agentIdOf(agent) {
    return agent?.id ?? agent?.session?.header?.id;
  }

  function sessionIdOf(agent) {
    return agent?.session?.header?.id;
  }

  async function resolve(cwd) {
    return resolveGovernanceScope(dshHomePath, cwd);
  }

  function syncTools(agent, scope) {
    if (stopped) return;
    const agentId = agentIdOf(agent);
    if (typeof agentId !== "string") return;
    const lifecycle = agents.get(agentId);
    if (lifecycle === undefined || agentEffects.get(agentId)?.agent !== agent) return;
    const shouldRegister = scope.state === "governed" && agent?.ctx !== undefined;
    if (shouldRegister && lifecycle.toolsDisposer === null) {
      try {
        lifecycle.toolsDisposer = registerLdvhTools(agent.ctx, {
          dshHomePath,
          workspaceRoot,
          getIdleSettings,
          getReviewAskSettings,
          sessionPersistence: () => ctx.get("sessionPersistence"),
          goals: () => ctx.get("goals"),
          readCurrentTurnText: (agent) => {
            const id = agentIdOf(agent);
            if (typeof id !== "string") return { ok: false, reason: "the calling agent exposes no id, so its live turn text cannot be located" };
            const timers = agentTimers.get(id);
            if (timers === undefined) return { ok: false, reason: "this agent has no live turn accumulator in the current process, so its current-turn text is unavailable (the session/event stream has not been wired for it yet)" };
            if (typeof timers.currentTurnText !== "function") return { ok: false, reason: "the live turn accumulator in this composition does not expose currentTurnText" };
            return timers.currentTurnText();
          },
          experienceArming,
          children,
          listChildren: childRecords,
          lookupChild,
          subagents: (() => {
            try { return agent?.ctx?.get?.("subagents") ?? null; } catch { return null; }
          })(),
          resolveChild,
          hostSeams
        });
        lifecycle.activity.record("tools/registered", { count: 8 });
        ctx.logger.info("[dsh-ldvh] registered LDVH tool batch (agent-scoped) for governed session %s", agentId);
      } catch (error) {
        const isDefect = error instanceof ReferenceError || error instanceof TypeError;
        const detail = String(error?.message ?? error);
        ctx.logger[isDefect ? "error" : "warn"](
          "[dsh-ldvh] tool registration %s for %s: %s",
          isDefect ? "DEFECT (wiring bug, not an environment refusal)" : "failed",
          agentId,
          detail
        );
        lifecycle.activity.record(isDefect ? "tools/registration-defect" : "tools/registration-failed", {
          state: scope.state,
          detail
        });
      }
    } else if (!shouldRegister && lifecycle.toolsDisposer !== null) {
      try { lifecycle.toolsDisposer(); } catch {   }
      lifecycle.toolsDisposer = null;
      lifecycle.activity.record("tools/unregistered", { state: scope.state });
      ctx.logger.info("[dsh-ldvh] unregistered LDVH tool batch (governance state: %s)", scope.state);
    }
    lifecycle.setScope(scope);
    recordJudgementForGuard(agent?.session?.header?.cwd, scope.state);
    propagateToChildren(scope.state, agentId);
  }

  function childRecords() {
    const live = [...children.values()].map(({ record }) => record);
    const done = [...retiredChildren.values()]
      .filter(({ record }) => !children.has(record.agentId))
      .map(({ record }) => record);
    return [...live, ...done];
  }

  function lookupChild(childId) {
    return children.get(childId)?.record ?? retiredChildren.get(childId)?.record ?? null;
  }

  async function resolveChild(childId, { parentSessionId } = {}) {
    const known = lookupChild(childId);
    if (known !== null) return { ok: true, record: known, source: "registry" };
    const resolved = await resolveChildFromSessionRecord({
      sessionPersistence: ctx.get("sessionPersistence"),
      childId,
      parentSessionId
    });
    if (resolved.ok !== true) {
      registryActivity.record("child/resolve-miss", {
        childId,
        parentSessionId: parentSessionId ?? null,
        reason: resolved.reason
      });
      return { ok: false, reason: resolved.reason };
    }
    const record = adoptFinishedChild({
      retiredChildren,
      header: resolved.header,
      conclusion: resolved.conclusion,
      source: "session-record",
      emit: (hook, detail) => registryActivity.record(hook, detail)
    });
    registryActivity.record("child/hydrated", {
      childId,
      parentId: resolved.header?.parentSession ?? null,
      conclusionChars: resolved.conclusion.length,
      ancestry: resolved.ancestry ?? []
    });
    return { ok: true, record, source: "session-record" };
  }

  function propagateToChildren(state, parentAgentId) {
    for (const [childId, { record }] of children) {
      if (record.parentAgentId !== parentAgentId) continue;
      const changed = record.applyParentScope(state, { source: "parent-propagation" });
      if (changed) {
        ctx.logger.info("[dsh-ldvh] propagated parent governance state %s to child %s (count: %d)",
          state ?? "none", childId, record.propagationCount);
      }
    }
  }

  function reprimeAgent(agentId, agent) {
    const lifecycle = agents.get(agentId);
    if (stopped || lifecycle === undefined || agentEffects.get(agentId)?.agent !== agent) return;
    lifecycle.preStep.primePending = true;
    lifecycle.activity.record("session/reprime", { source: "agent-created" });
    void resolve(agent?.session?.header?.cwd).then((scope) => {
      if (stopped || agents.get(agentId) !== lifecycle) return;
      const sessionId = sessionIdOf(agent);
      if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
      lifecycle.setScope(scope);
      propagateToChildren(scope?.state ?? null, agentId);
    }).catch((error) => {
      ctx.logger.warn("[dsh-ldvh] re-prime judgement failed for %s: %s", agentId, String(error?.message ?? error));
    });
  }

  function install(agent) {
    if (stopped) return;
    const agentId = agentIdOf(agent);
    if (typeof agentId !== "string") return;
    if (agents.has(agentId)) return;
    const header = agent?.session?.header;
    if (header?.origin === "subagent") {
      installChild(agent);
      return;
    }
    const parentSession = header?.parentSession;
    if (typeof parentSession === "string" && parentSession.trim().length > 0) {
      const seededRoot = header?.isSeeded === true && header?.delegationDepth === 0;
      if (!seededRoot) {
        installChild(agent);
        return;
      }
    }
    const agentsService = ctx.get("agents");
    if (agentsService === undefined) return;
    if (typeof agentsService.roots === "function" && !agentsService.roots().includes(agent)) return;

    const lifecycle = new AgentLifecycle(agent);
    agents.set(agentId, lifecycle);
    const ownedEffect = { agent, dispose: null };
    agentEffects.set(agentId, ownedEffect);

    try {
      ownedEffect.dispose = agent.ctx.effect(() => {
      void resolve(agent?.session?.header?.cwd).then((scope) => {
        if (stopped || agents.get(agentId) !== lifecycle) return;
        const sessionId = sessionIdOf(agent);
        if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
        lifecycle.lastScope = scope;
        syncTools(agent, scope);
      }).catch((error) => {
        ctx.logger.warn("[dsh-ldvh] initial governance judgement failed for %s: %s", agentId, String(error?.message ?? error));
      });

      const onAssemble = createAssembleHandler(agent, {
        resolve,
        syncTools: (scope) => syncTools(agent, scope),
        recordScope: (scope) => {
          if (stopped || agents.get(agentId) !== lifecycle) return;
          const sessionId = sessionIdOf(agent);
          if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
          lifecycle.noticeText = scope.noticeText ?? null;
          lifecycle.lastScope = scope;
        }
      });
      const onPreStep = createPreStepHandler(agent, {
        isGoverned: () => lifecycle.scopeState === "governed",
        channel: lifecycle.preStep,
        noticeText: () => lifecycle.noticeText ?? (lifecycle.lastScope !== undefined && lifecycle.lastScope !== null ? noticeTextFor(lifecycle.lastScope) : null),
        suppressUngovernedRow: () => lifecycle.scopeState !== "governed",
        noticeSummary: () => noticeSummaryFor(lifecycle.scopeState),
        recallRow: async ({ userText }) => {
          const needsLateResolve =
            lifecycle.scopeState !== "governed" ||
            typeof lifecycle.lastScope?.project?.path !== "string" ||
            lifecycle.lastScope.project.path.length === 0;
          if (needsLateResolve) {
            try {
              const cwd = agent?.session?.header?.cwd;
              if (typeof cwd === "string" && cwd.length > 0) {
                const late = await resolve(cwd);
                if (late !== undefined && late !== null) {
                  if (lifecycle.scopeState !== late.state) lifecycle.setScope?.(late);
                  if (lifecycle.lastScope === undefined || lifecycle.lastScope === null) {
                    lifecycle.lastScope = late;
                  }
                }
              }
            } catch (error) {
              agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: late scope resolve failed: ${String(error?.message ?? error)}`);
            }
          }
          if (lifecycle.scopeState !== "governed") return { inject: false, reason: "not-governed" };
          let projectPath = lifecycle.lastScope?.project?.path;
          if (typeof projectPath !== "string" || projectPath.length === 0) {
            try {
              const cwd = agent?.session?.header?.cwd;
              if (typeof cwd === "string" && cwd.length > 0) {
                const late = await resolve(cwd);
                if (late?.project?.path) {
                  projectPath = late.project.path;
                  if (lifecycle.lastScope === undefined || lifecycle.lastScope === null) lifecycle.lastScope = late;
                }
              }
            } catch (error) {
              agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: late scope resolve failed: ${String(error?.message ?? error)}`);
            }
          }
          if (typeof projectPath !== "string" || projectPath.length === 0) return { inject: false, reason: "no-project" };
          let recallBudget;
          let recallLimit;
          try {
            const resolved = getInjectionBudget?.();
            if (resolved?.ok === false) {
              agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: ${resolved.reason}`);
            }
            if (resolved?.bytes > 0) recallBudget = resolved.bytes;
            if (recallBudget !== undefined) recallLimit = recallLimitForBudget(recallBudget);
          } catch (error) {
            agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: budget resolve failed: ${String(error?.message ?? error)}`);
          }
          return buildRecallInjection({
            userText,
            projectRoot: projectPath,
            ...(recallBudget === undefined ? {} : { budgetBytes: recallBudget }),
            ...(recallLimit === undefined ? {} : { limit: recallLimit }),
          });
        },
        recallSummary: () => RECALL_SUMMARY,
        normDirectoryRow: async () => {
          const projectPath = lifecycle.lastScope?.project?.path ?? agent?.session?.header?.cwd;
          if (typeof projectPath !== "string" || projectPath === "") return null;
          const directory = await buildNormDirectoryForRoot({
            root: projectPath,
            budgetChars: NORM_DIRECTORY_BUDGET_CHARS,
          });
          if (directory.text === "") return null;
          return { inject: true, text: directory.text, digest: normDirectoryDigest(directory.text) };
        },
        normDirectorySummary: NORM_DIRECTORY_SECTION_NAME,
        reviewAskRow: async () => {
          try {
            if (lifecycle.scopeState !== "governed") {
              try {
                const cwd = agent?.session?.header?.cwd;
                if (typeof cwd === "string" && cwd.length > 0) {
                  const late = await resolve(cwd);
                  if (late !== undefined && late !== null && lifecycle.scopeState !== late.state) {
                    lifecycle.setScope?.(late);
                  }
                }
              } catch (error) {
                agent?.ctx?.logger?.warn?.(`[dsh-ldvh] review-ask: late scope resolve failed: ${String(error?.message ?? error)}`);
              }
            }
            if (lifecycle.scopeState !== "governed") {
              return { inject: false, reason: "not-governed" };
            }
            const settings = typeof getReviewAskSettings === "function" ? getReviewAskSettings() : null;
            if (settings === null) return { inject: false, reason: "settings-unavailable" };
            const preOn = settings.preAction === true;
            const postOn = settings.postWork === true;
            const consultOn = settings.researchConsult === true;
            if (!preOn && !postOn && !consultOn) return { inject: false, reason: "all-switches-off" };
            const text = buildReviewAskNotice({
              preOn,
              postOn,
              preKnown: settings.preActionKnown !== false,
              postKnown: settings.postWorkKnown !== false,
              consultOn,
              consultKnown: settings.researchConsultKnown !== false,
              silentOn: settings.silentRun === true,
            });
            return { inject: true, text, digest: text };
          } catch (error) {
            agent?.ctx?.logger?.warn?.(`[dsh-ldvh] review-ask row failed: ${String(error?.message ?? error)}`);
            return { inject: false, reason: "error" };
          }
        },
        reviewAskSummary: () => REVIEW_ASK_ROW_SUMMARY,
        captureRow: async () => {
          try {
            if (lifecycle.scopeState !== "governed") {
              try {
                const cwd = agent?.session?.header?.cwd;
                if (typeof cwd === "string" && cwd.length > 0) {
                  const late = await resolve(cwd);
                  if (late !== undefined && late !== null && lifecycle.scopeState !== late.state) {
                    lifecycle.setScope?.(late);
                  }
                }
              } catch (error) {
                agent?.ctx?.logger?.warn?.(`[dsh-ldvh] capture: late scope resolve failed: ${String(error?.message ?? error)}`);
              }
            }
            if (lifecycle.scopeState !== "governed") return { inject: false, reason: "not-governed" };
            const idle = typeof getIdleSettings === "function" ? getIdleSettings() : null;
            if (idle === null) return { inject: false, reason: "settings-unavailable" };
            const { experienceEnabled, frictionEnabled } = resolveCaptureSwitches(idle);
            const text = buildCaptureNotice({ experienceEnabled, frictionEnabled });
            if (text === "") return { inject: false, reason: "all-switches-off" };
            return { inject: true, text, digest: captureNoticeDigest(text) };
          } catch (error) {
            agent?.ctx?.logger?.warn?.(`[dsh-ldvh] capture row failed: ${String(error?.message ?? error)}`);
            return { inject: false, reason: "error" };
          }
        },
        captureSummary: () => CAPTURE_NOTICE_SUMMARY
      });
      lifecycle.preStepResetVisibility = () => onPreStep.resetVisibility();
      const turnTriggers = createTurnTriggers(agent, {
        registerDiagnostic: async (entry) => {
          await recordRun(dshHomePath, {
            ...entry,
            task: "diagnostic",
            tasks: ["diagnostic"],
            at: new Date().toISOString(),
          });
        },
        getScopeState: () => lifecycle.scopeState,
        turns: lifecycle.turns,
        activity: lifecycle.activity,
        log: ctx.logger,
      });
      agentTimers.set(agentId, turnTriggers);
      onPreStep.prime();
      const stops = [
        agent.ctx.on("system-prompt/assemble", (assembly, context, next) => onAssemble(assembly, context, next)),
        agent.ctx.on("agent/pre-step", (payload, next) => onPreStep.handler(payload, next), { prepend: true }),
        agent.ctx.on("agent/turn-stopping", (payload) => turnTriggers.onTurnStopping(payload)),
        agent.ctx.on("agent/status", (payload) => turnTriggers.onAgentStatus(payload)),
        agent.ctx.on("session/event", (session, event) => turnTriggers.onSessionEvent(session, event))
      ];

      return () => {
        const cleanupErrors = [];
        for (const stop of stops.reverse()) {
          try { stop(); } catch (error) { cleanupErrors.push(error); }
        }
        let timerDrain;
        try {
          timerDrain = turnTriggers.dispose();
          if (agentTimers.get(agentId) === turnTriggers) agentTimers.delete(agentId);
        } catch (error) {
          cleanupErrors.push(error);
          registryActivity.record("timers/dispose-failed", { agentId, message: String(error?.message ?? error), at: new Date().toISOString() });
          try { ctx.logger.warn("[dsh-ldvh] timer disposal failed for %s: %s", agentId, String(error?.message ?? error)); } catch {   }
        }
        if (lifecycle.toolsDisposer !== null) {
          try { lifecycle.toolsDisposer(); } catch (error) { cleanupErrors.push(error); }
          lifecycle.toolsDisposer = null;
        }
        if (agentEffects.get(agentId) === ownedEffect) {
          agentEffects.delete(agentId);
          const sessionId = sessionIdOf(agent);
          if (typeof sessionId === "string") sessionScopes.delete(sessionId);
        }
        if (agents.get(agentId) === lifecycle) agents.delete(agentId);
        return Promise.resolve(timerDrain).then(() => {
          if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `LDVH agent cleanup encountered errors: ${agentId}`);
        });
      };
    }, `dsh-ldvh: agent lifecycle ${agentId}`);
    } catch (error) {
      if (agentEffects.get(agentId) === ownedEffect) agentEffects.delete(agentId);
      if (agents.get(agentId) === lifecycle) agents.delete(agentId);
      throw error;
    }
  }

  return {
    start() {
      const clearsView = (source) => source === "clear" || source === "compact" || source === "resume" || source === "startup";
      const disposeCreated = ctx.on("agent/created", (payload) => {
        const agent = payload?.agent;
        const id = agentIdOf(agent);
        if (typeof id === "string" && agents.has(id)) {
          if (clearsView(payload?.source) && typeof agents.get(id)?.preStepResetVisibility === "function") {
            agents.get(id).preStepResetVisibility();
          }
          reprimeAgent(id, agent);
        } else install(agent);
      });
      const disposeSubagentEnd = ctx.on("subagent/end", (info) => {
        try {
          const childId = info?.id;
          if (typeof childId !== "string" || childId === "") return;
          const record = children.get(childId)?.record ?? retiredChildren.get(childId)?.record;
          if (record === undefined) return;
          const message = info?.lastAssistantMessage;
          if (!Array.isArray(message)) return;
          const text = message
            .filter((block) => block !== null && typeof block === "object" && block.type === "text")
            .map((block) => (typeof block.text === "string" ? block.text : ""))
            .join("");
          record.setConclusion(text);
        } catch (error) {
          ctx.logger.warn("[dsh-ldvh] subagent/end conclusion capture failed: %s", String(error?.message ?? error));
        }
      });
      const agentsService = ctx.get("agents");
      if (agentsService !== undefined) {
        const roster = typeof agentsService.list === "function"
          ? agentsService.list()
          : typeof agentsService.roots === "function"
            ? agentsService.roots()
            : [];
        for (const agent of roster) {
          const adopted = agentIdOf(agent);
          install(agent);
          registryActivity.record("root/adopt", { agentId: adopted ?? null });
        }
      }
      return () => {
        if (stopped) return stopPromise ?? Promise.resolve();
        stopped = true;
        agents.clear();
        const pendingDisposals = [];
        const disposalErrors = [];
        const reportDisposalFailure = (kind, agentId, error) => {
          const message = String(error?.message ?? error);
          disposalErrors.push(error instanceof Error ? error : new Error(message));
          registryActivity.record(`${kind}/dispose-failed`, { agentId, message });
          try { ctx.logger.warn("[dsh-ldvh] %s disposal failed for %s: %s", kind, agentId, message); } catch {   }
        };
        const observeDisposal = (value, kind, agentId) => {
          if (value && typeof value.then === "function") {
            pendingDisposals.push(Promise.resolve(value).catch((error) => reportDisposalFailure(kind, agentId, error)));
          }
        };
        try { observeDisposal(disposeCreated(), "agent-created-listener", null); } catch (error) { reportDisposalFailure("agent-created-listener", null, error); }
        try { observeDisposal(disposeSubagentEnd(), "subagent-end-listener", null); } catch (error) { reportDisposalFailure("subagent-end-listener", null, error); }
        const clearedChildren = [...children.keys()];
        for (const [childId, { dispose }] of children) {
          try { observeDisposal(dispose(), "child-effect", childId); } catch (error) { reportDisposalFailure("child-effect", childId, error); }
        }
        const clearedRetired = [...retiredChildren.keys()];
        children.clear();
        retiredChildren.clear();
        registryActivity.record("children/cleared", {
          clearedLive: clearedChildren,
          clearedRetired,
          at: new Date().toISOString()
        });
        const timerIds = [...agentTimers.keys()];
        for (const [agentId, ownedEffect] of agentEffects) {
          try {
            if (typeof ownedEffect.dispose === "function") observeDisposal(ownedEffect.dispose(), "agent-effect", agentId);
            else reportDisposalFailure("agent-effect", agentId, new Error("owned effect disposer unavailable"));
          } catch (error) {
            reportDisposalFailure("agent-effect", agentId, error);
          }
        }
        const disposedTimers = timerIds.filter((id) => !agentTimers.has(id));
        for (const [timerAgentId, triggers] of agentTimers) {
          try {
            observeDisposal(triggers.dispose(), "timer-drain", timerAgentId);
            disposedTimers.push(timerAgentId);
          } catch (error) {
            reportDisposalFailure("timer-drain", timerAgentId, error);
          }
        }
        registryActivity.record("timers/cleared", { disposed: disposedTimers, at: new Date().toISOString() });
        agentTimers.clear();
        stopPromise = Promise.all(pendingDisposals).then(() => {
          agentEffects.clear();
          if (disposalErrors.length > 0) throw new AggregateError(disposalErrors, "LDVH lifecycle cleanup encountered errors");
        });
        return stopPromise;
      };
    },
    installedAgentIds() {
      return [...agents.keys()];
    },
    snapshots() {
      return [...agents.values()].map((lifecycle) => lifecycle.snapshot());
    },
    snapshotOf(agentId) {
      return agents.get(agentId)?.snapshot();
    },
    childSnapshots() {
      return childRecords().map((record) => record.snapshot());
    },
    childActivityOf(childId) {
      return lookupChild(childId)?.activitySnapshot() ?? null;
    },
    resolveChild,
    childConclusionOf(childId) {
      return lookupChild(childId)?.conclusion ?? null;
    },
    registryActivitySnapshot() {
      return registryActivity.snapshot();
    }
  };
}
