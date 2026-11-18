
import { buildGuidance, guidanceSizeAlerts, reportGuidanceSize } from "./guidance-budget.js";
import { NORM_DIRECTORY_SECTION_NAME } from "./norm-directory.js";
import { currentUserText } from "./recall-injection.js";
import { GUIDANCE_SECTION_NAME, migrationLineFor, noticeTextFor } from "./guidance-text.js";
import { REVIEW_ASK_ROW_SUMMARY } from "./review-ask.js";

export function createAssembleHandler(agent, { resolve, syncTools, recordScope }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  let lastState = null;
  return async function onAssemble(assembly, context, next) {
    if (context?.agent === undefined || context.agent.id !== agentId) return next();
    if (context.signal?.aborted === true) return next();

    const cwd = agent?.session?.header?.cwd;
    let scope;
    try {
      scope = await resolve(cwd);
    } catch (error) {
      scope = { state: "unavailable", detail: String(error?.message ?? error) };
    }
    const guided = buildGuidance(scope.state);
    let text = guided.ok ? guided.text : "";
    if (!guided.ok) {
      scope.guidanceBudgetExceeded = guided.error.message;
    }
    const sizeReport = reportGuidanceSize(scope.state);
    scope.guidanceSizeReport = {
      state: sizeReport.state,
      length: sizeReport.length,
      budget: sizeReport.budget,
      ok: sizeReport.ok,
      withinEarlyWarning: sizeReport.withinEarlyWarning ?? null,
      drifted: sizeReport.drift.drifted,
      recorded: sizeReport.drift.recorded,
      delta: sizeReport.drift.delta,
    };
    const alerts = guidanceSizeAlerts(sizeReport);
    if (alerts.drift !== undefined) {
      scope.guidanceLengthDrift = alerts.drift;
      agent?.ctx?.logger?.warn?.(`ldvh: ${alerts.drift.message}`);
    }
    if (alerts.nearBudget !== undefined) {
      scope.guidanceNearBudget = alerts.nearBudget;
      agent?.ctx?.logger?.warn?.(`ldvh: ${alerts.nearBudget.message}`);
    }
    let noticeText = noticeTextFor(scope);
    if (lastState !== null && lastState !== scope.state) {
      const migrationLine = migrationLineFor(lastState, scope.state);
      text = `${migrationLine}\n${text}`;
      noticeText = `${migrationLine}\n${noticeText}`;
    }
    if (lastState === null) lastState = scope.state;
    else if (lastState !== scope.state) lastState = scope.state;
    scope.noticeText = noticeText;

    recordScope(scope);
    syncTools(scope);

    const assembled = await next();
    const sections = assembled.sections.filter((section) => section.name !== GUIDANCE_SECTION_NAME);
    if (text !== "") sections.push({ name: GUIDANCE_SECTION_NAME, text });
    return { ...assembled, sections };
  };
}

const LDVH_PLUGIN_SOURCE = "dsh-ldvh";

function isRecallMessage(message, recallSummary) {  if (!isOwnMessage(message)) return false;
  const summary = message?.source?.summary;
  if (typeof summary !== "string" || typeof recallSummary !== "string") return false;
  return summary === recallSummary;
}

function isOwnMessage(message) {
  const source = message?.source;
  return source?.plugin === LDVH_PLUGIN_SOURCE
    && (source?.kind === LDVH_PLUGIN_SOURCE || source?.kind === "plugin");
}

function noteOwnMessages(state, messages) {
  if (state.injectedIds === undefined) state.injectedIds = new Set();
  for (const message of messages) {
    if (isOwnMessage(message)) state.injectedIds.add(message.id);
  }
}

function createPluginMessage(text, summary) {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: LDVH_PLUGIN_SOURCE,
      plugin: LDVH_PLUGIN_SOURCE,
      form: "notice",
      summary
    }
  };
}

export function createPreStepHandler(agent, { isGoverned, channel, noticeText, noticeSummary, suppressUngovernedRow, onTurnStart, recallRow, recallSummary, reviewAskRow, reviewAskSummary, normDirectoryRow, normDirectorySummary } = {}) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  const state = channel ?? { primePending: false, lastDigest: null };
  const getNormDirectoryRow = typeof normDirectoryRow === "function" ? normDirectoryRow : null;
  const normDirectoryLabel = typeof normDirectorySummary === "string" && normDirectorySummary !== "" ? normDirectorySummary : null;
  const getNoticeText = typeof noticeText === "function" ? noticeText : () => null;
  const shouldSuppressRow = typeof suppressUngovernedRow === "function" ? suppressUngovernedRow : () => false;
  const runOnTurnStart = typeof onTurnStart === "function" ? onTurnStart : null;
  const getRecallRow = typeof recallRow === "function" ? recallRow : null;
  const recallLabel = typeof recallSummary === "function" ? recallSummary : () => recallSummary;
  const getReviewAskRow = typeof reviewAskRow === "function" ? reviewAskRow : null;
  const reviewAskLabel = typeof reviewAskSummary === "function" ? reviewAskSummary : () => reviewAskSummary;
  return {
    prime() { state.primePending = true; },
    resetVisibility() {
      state.injectedIds = new Set();
      state.lastDigest = null;
      state.lastRecallDigest = null;
      state.lastReviewAskDigest = null;
    },
    async handler(payload, next) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return next();
      const decision = await next();
      if (decision.kind === "reject" || payload.signal?.aborted === true) return decision;
      if (payload.step !== 1) return decision;
      if (runOnTurnStart !== null && isGoverned?.() === true) {
        try {
          await runOnTurnStart();
        } catch (error) {
          agent?.ctx?.logger?.warn?.(`ldvh: turn-start check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const currentNotice = getNoticeText();
      state.primePending = false;
      const suppressRow = shouldSuppressRow() === true;
      const noticeReady = currentNotice !== null && currentNotice !== "" && !suppressRow;
      if (suppressRow) state.lastDigest = null;
      const batch = Array.isArray(decision.messages) ? decision.messages : [];
      const currentRecallLabel = recallLabel() ?? "双源召回 · 行动前候选";
      const currentReviewAskLabel = reviewAskLabel() ?? REVIEW_ASK_ROW_SUMMARY;
      const isNoticeMessage = (message) => isOwnMessage(message)
        && !isRecallMessage(message, currentRecallLabel)
        && (message?.source?.summary ?? null) !== currentReviewAskLabel;
      const inBatch = batch.find(isNoticeMessage);
      noteOwnMessages(state, batch);
      const everInjected = state.injectedIds !== undefined && state.injectedIds.size > 0;
      const changed = noticeReady && currentNotice !== state.lastDigest;
      const extras = [];
      const alreadyHas = (text, summary) => batch.some((message) => {
        if (!isOwnMessage(message)) return false;
        if ((message?.source?.summary ?? null) !== summary) return false;
        const existing = Array.isArray(message.content)
          ? message.content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
          : "";
        return existing === text;
      });
      const noticeSummaryText = (typeof noticeSummary === "function" ? noticeSummary() : noticeSummary) ?? "LDVH 管辖判定";
      if (noticeReady && (!everInjected || changed)) {
        state.lastDigest = currentNotice;
        if (!alreadyHas(currentNotice, noticeSummaryText)) {
          extras.push(createPluginMessage(currentNotice, noticeSummaryText));
        }
      } else if (noticeReady && inBatch !== undefined) {
        inBatch.content = [{ type: "text", text: currentNotice }];
      }
      if (getRecallRow !== null) {
        let recall = null;
        try {
          recall = await getRecallRow({ userText: currentUserText(batch, isOwnMessage) });
        } catch (error) {
          agent?.ctx?.logger?.warn?.(`ldvh: recall injection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (recall !== null && recall?.inject === true && typeof recall.text === "string" && recall.text !== "") {
          const label = recallLabel() ?? "双源召回 · 行动前候选";
          const recallAlreadyInBatch = batch.some((message) => {
            if (!isOwnMessage(message)) return false;
            if ((message?.source?.summary ?? null) !== label) return false;
            const existing = Array.isArray(message.content)
              ? message.content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
              : "";
            return existing === recall.text;
          });
          if (recall.digest !== state.lastRecallDigest) {
            state.lastRecallDigest = recall.digest;
            if (!recallAlreadyInBatch) {
              extras.push(createPluginMessage(recall.text, label));
            }
          } else {
            const priorRecall = batch.find((m) => isRecallMessage(m, label));
            if (priorRecall !== undefined) {
              priorRecall.content = [{ type: "text", text: recall.text }];
            }
          }
        }
      }
      if (getReviewAskRow !== null) {
        let askRow = null;
        try {
          askRow = await getReviewAskRow({ userText: currentUserText(batch, isOwnMessage) });
        } catch (error) {
          agent?.ctx?.logger?.warn?.(`ldvh: review-ask injection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (askRow !== null && askRow?.inject === true && typeof askRow.text === "string" && askRow.text !== "") {
          const label = reviewAskLabel() ?? REVIEW_ASK_ROW_SUMMARY;
          const askAlreadyInBatch = batch.some((message) => {
            if (!isOwnMessage(message)) return false;
            if ((message?.source?.summary ?? null) !== label) return false;
            const existing = Array.isArray(message.content)
              ? message.content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
              : "";
            return existing === askRow.text;
          });
          if (askRow.digest !== state.lastReviewAskDigest) {
            state.lastReviewAskDigest = askRow.digest;
            if (!askAlreadyInBatch) {
              extras.push(createPluginMessage(askRow.text, label));
            }
          } else {
            const prior = batch.find((m) => isOwnMessage(m) && (m?.source?.summary ?? null) === label);
            if (prior !== undefined) {
              prior.content = [{ type: "text", text: askRow.text }];
            }
          }
        }
      }
      if (getNormDirectoryRow !== null) {
        let directoryRow = null;
        try {
          directoryRow = await getNormDirectoryRow({ userText: currentUserText(batch, isOwnMessage) });
        } catch (error) {
          agent?.ctx?.logger?.warn?.(`ldvh: norm-directory injection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (directoryRow !== null && directoryRow?.inject === true && typeof directoryRow.text === "string" && directoryRow.text !== "") {
          const label = normDirectoryLabel ?? NORM_DIRECTORY_SECTION_NAME;
          const directoryAlreadyInBatch = batch.some((message) => {
            if (!isOwnMessage(message)) return false;
            if ((message?.source?.summary ?? null) !== label) return false;
            const existing = Array.isArray(message.content)
              ? message.content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
              : "";
            return existing === directoryRow.text;
          });
          state.lastNormDirectoryDigest = directoryRow.digest;
          if (!directoryAlreadyInBatch) {
            extras.push(createPluginMessage(directoryRow.text, label));
          }
        }
      }
      if (extras.length > 0) {
        noteOwnMessages(state, extras);
        return { kind: "enter", messages: [...batch, ...extras] };
      }
      return decision;
    }
  };
}
