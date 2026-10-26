#!/usr/bin/env node
// 宿主能力**探针**（2026-10-26）。
//
// ## 为什么要有这个脚本
//
// §6.1 修订后，审核周期任务依赖宿主的两条能力：
//   ① `schedule.create(sessionId, { every_seconds, title, prompt })` —— 周期投递；
//   ② `sessionController.create({ cwd })` + `list()` 读投影标题 —— 专属会话的建立与查找。
//
// 这两条我此前**只在宿主包的声明里读到过**，没在真实宿主上跑通。若直接写进插件再发现
// 接口不匹配，返工成本高（插件里到处是接线）。故先单独验证：**只读 + 只创建一次**，
// 且创建的会话与任务在结束时**显式清理**。
//
// ## 运行方式
//
// 本脚本**不能**在普通 node 里跑——它需要宿主的 `ctx`（服务注册表）。故它是一份
// **在插件里可调用的探针函数**，由 `dsh` 侧的诊断入口或临时钩子触发。
// 这里提供 `probeHostAutomation(ctx, { projectRoot })`，返回结构化结果。
//
// **安全边界**：不写事实源、不改缓冲、不派发任何辅助任务。创建的东西全部登记，
// 供调用方决定是否清理（`cleanup` 字段给出确切的删除动作）。

/**
 * @param {object} ctx - 宿主 Cordis 上下文（须能 `ctx.get('schedule')` 等）。
 * @param {object} options
 * @param {string} options.projectRoot - 项目根（用作新会话的 cwd，验证「只在本项目内创建」）。
 * @param {string} [options.title] - 专属会话标题。
 * @param {boolean} [options.dryRun] - 只读探测，不创建任何东西（默认 true）。
 * @returns {Promise<object>} 结构化的探测结果。
 */
export async function probeHostAutomation(ctx, { projectRoot, title = "LDVH 经验审核 · 探针", dryRun = true } = {}) {
  const result = {
    at: new Date().toISOString(),
    dryRun,
    services: {},
    steps: [],
    created: { sessionId: null, scheduleId: null },
    cleanup: [],
    verdict: "unknown",
  };

  const step = (name, ok, detail) => result.steps.push({ name, ok, detail });

  // ── 1. 服务可用性（只读）──────────────────────────────────────────────
  const schedule = ctx.get("schedule");
  const sessionController = ctx.get("sessionController");
  result.services.schedule = schedule !== undefined && schedule !== null;
  result.services.sessionController = sessionController !== undefined && sessionController !== null;
  step("schedule 可取", result.services.schedule, result.services.schedule ? "ctx.get('schedule')" : "未装配");
  step("sessionController 可取", result.services.sessionController, result.services.sessionController ? "ctx.get('sessionController')" : "未装配");
  if (!result.services.schedule || !result.services.sessionController) {
    result.verdict = "services-missing";
    return result;
  }
  step("schedule.create 可调用", typeof schedule.create === "function", typeof schedule.create);
  step("schedule.delete 可调用", typeof schedule.delete === "function", typeof schedule.delete);
  step("sessionController.create 可调用", typeof sessionController.create === "function", typeof sessionController.create);
  step("sessionController.list 可调用", typeof sessionController.list === "function", typeof sessionController.list);

  // ── 2. 列会话并读标题（只读，验证「按固定标题查找」可行）──────────────
  try {
    const listed = await sessionController.list({}, new AbortController().signal);
    const items = Array.isArray(listed?.items) ? listed.items : [];
    step("list() 返回结构", items.length >= 0, `items=${items.length}`);
    // 关键验证：标题是否真的能从投影里读出来。
    const withTitle = items.filter((item) => {
      const t = item?.projections?.values?.title;
      return typeof t === "string" && t.length > 0;
    });
    step(
      "投影可读出 title",
      items.length === 0 || withTitle.length > 0,
      items.length === 0
        ? "无会话可验（样本为空，不作为「不可行」的证据）"
        : `${withTitle.length}/${items.length} 条会话有非空 title；示例=${JSON.stringify(withTitle[0]?.projections?.values?.title ?? null)}`,
    );
    // 顺带记录 cwd 是否可读（用于「只在本项目内创建」的核对）。
    const withCwd = items.filter((item) => typeof item?.cwd === "string" && item.cwd.length > 0);
    step("list() 可读出 cwd", withCwd.length > 0, `${withCwd.length}/${items.length} 条有 cwd`);
    const matching = items.filter((item) => item?.projections?.values?.title === title);
    step("按标题查找可行", true, `匹配 ${matching.length} 条（标题=${JSON.stringify(title)}）`);
  } catch (error) {
    step("list() 调用", false, String(error?.message ?? error));
  }

  if (dryRun) {
    result.verdict = "dry-run-complete";
    return result;
  }

  // ── 3. 创建专属会话（写；须清理）──────────────────────────────────────
  let sessionId = null;
  try {
    const created = await sessionController.create({ cwd: projectRoot });
    sessionId = created?.sessionId ?? null;
    result.created.sessionId = sessionId;
    step(
      "session/create 成功",
      sessionId !== null,
      sessionId === null ? "未返回 sessionId" : `sessionId=${sessionId}；cwd=${projectRoot}`,
    );
  } catch (error) {
    step("session/create 调用", false, String(error?.message ?? error));
  }

  // ── 4. 在该会话上建周期任务（写；须清理）──────────────────────────────
  if (sessionId !== null) {
    try {
      const record = await schedule.create(sessionId, {
        title,
        prompt: "[dsh-ldvh:experience-review-probe] 这是一次探针投递，请忽略。",
        every_seconds: 3600,
      });
      result.created.scheduleId = record?.id ?? null;
      step(
        "schedule/create(every) 成功",
        result.created.scheduleId !== null,
        `id=${result.created.scheduleId}；kind=${record?.kind}；everySeconds=${record?.everySeconds}`,
      );
      // 关键验证：kind 是否真的是 'every'（判别式是否被宿主接受）。
      step("返回记录 kind=every", record?.kind === "every", String(record?.kind));
    } catch (error) {
      step("schedule/create(every) 调用", false, String(error?.message ?? error));
    }
  }

  // ── 5. 清理指引（**不自动删**：删除动作留给调用方决定）────────────────
  if (result.created.scheduleId !== null) {
    result.cleanup.push({ kind: "schedule.delete", request: { sessionId, id: result.created.scheduleId } });
  }
  if (result.created.sessionId !== null) {
    result.cleanup.push({ kind: "session.delete", sessionId: result.created.sessionId });

    // 顺带核对：新建的会话是否真的落在指定 cwd（「只在本项目内创建」的机械证据）。
    try {
      const listed = await sessionController.list({}, new AbortController().signal);
      const mine = (listed?.items ?? []).find((item) => item?.sessionId === sessionId);
      step(
        "新会话的 cwd 与项目根一致",
        mine?.cwd === projectRoot,
        `期望 ${projectRoot}；实际 ${JSON.stringify(mine?.cwd ?? null)}`,
      );
    } catch (error) {
      step("核对新会话 cwd", false, String(error?.message ?? error));
    }
  }

  result.verdict =
    result.steps.every((s) => s.ok) ? "all-probes-passed" : "some-probes-failed";
  return result;
}

/** 把探测结果格式化成便于人读的报告。 */
export function formatProbeReport(result) {
  const lines = [];
  lines.push(`宿主能力探针 · ${result.at}${result.dryRun ? "（只读）" : "（含写入）"}`);
  lines.push("");
  lines.push(`服务：schedule=${result.services.schedule} sessionController=${result.services.sessionController}`);
  lines.push("");
  for (const step of result.steps) {
    lines.push(`${step.ok ? "✅" : "❌"} ${step.name}${step.detail ? ` — ${step.detail}` : ""}`);
  }
  lines.push("");
  lines.push(`结论：${result.verdict}`);
  if (result.cleanup.length > 0) {
    lines.push("");
    lines.push("须清理（脚本不自动删）：");
    for (const item of result.cleanup) {
      lines.push(`  · ${item.kind} ${JSON.stringify(item.request ?? item.sessionId)}`);
    }
  }
  return lines.join("\n");
}
