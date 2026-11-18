#!/usr/bin/env node

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
  step("schedule.edit 可调用", typeof schedule.edit === "function", typeof schedule.edit);
  step("sessionController.create 可调用", typeof sessionController.create === "function", typeof sessionController.create);
  step("sessionController.list 可调用", typeof sessionController.list === "function", typeof sessionController.list);

  try {
    const listed = await sessionController.list({}, new AbortController().signal);
    const items = Array.isArray(listed?.items) ? listed.items : [];
    step("list() 返回结构", items.length >= 0, `items=${items.length}`);
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

  if (sessionId !== null) {
    try {
      const record = await schedule.create({
        title,
        prompt: "[dsh-ldvh:experience-review-probe] 这是一次探针投递，请忽略。",
        timing: { kind: "every", every_seconds: 3600 },
        target: { kind: "session", sessionId },
      });
      result.created.scheduleId = record?.id ?? null;
      step(
        "schedule/create(every) 成功",
        result.created.scheduleId !== null,
        `id=${result.created.scheduleId}；kind=${record?.kind}；everySeconds=${record?.everySeconds}`,
      );
      step("返回记录 kind=every", record?.kind === "every", String(record?.kind));
    } catch (error) {
      step("schedule/create(every) 调用", false, String(error?.message ?? error));
    }
  }

  if (result.created.scheduleId !== null) {
    result.cleanup.push({ kind: "schedule.edit", request: { id: result.created.scheduleId, action: "delete" } });
  }
  if (result.created.sessionId !== null) {
    result.cleanup.push({ kind: "session.delete", sessionId: result.created.sessionId });

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
