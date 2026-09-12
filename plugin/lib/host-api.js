import { inspectCandidate, installProject, readGovernedProjects, unregisterProject, uninstallHook } from "./governed-projects.js";
import { readGovernedProjectsWithColors, updateProjectColor } from "./web-preferences.js";

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createGovernanceHandler(options) {
  return async function governanceHandler(req, res) {
    const rawPath = new URL(req.url ?? "/", "http://ldvh.local").pathname;
    const prefix = "/ldvh/api";
    const path = rawPath === prefix ? "/" : (rawPath.startsWith(`${prefix}/`) ? rawPath.slice(prefix.length) : rawPath);
    try {
      if (path === "/governed-projects" && req.method === "GET") return json(res, 200, await readGovernedProjects(options.dshHomePath));
      // Web 呈现偏好（项目颜色）：插件设置卡与 Web 设置页共用的读写面。
      if (path === "/governed-projects/with-colors" && req.method === "GET") return json(res, 200, await readGovernedProjectsWithColors(options.dshHomePath));
      if (path === "/governed-projects/color" && req.method === "POST") {
        const input = await readJson(req);
        return json(res, 200, await updateProjectColor(options.dshHomePath, input.projectId, input.color === undefined ? null : input.color));
      }
      if (path === "/governed-projects/inspect" && req.method === "POST") {
        const input = await readJson(req);
        return json(res, 200, await inspectCandidate(input.path));
      }
      // 07 §5.4/§5.6: the install transaction registers the project (plus hook
      // and fact source), so the request must carry the Human's intent
      // explicitly — the settings-page click supplies it on the Web path.
      if (path === "/governed-projects/install" && req.method === "POST") {
        const input = await readJson(req);
        if (input?.human_confirmed !== true) {
          return json(res, 200, { ok: false, error: { code: "human_intent_required", message: "07 §5.6 requires explicit Human intent: the request must carry human_confirmed: true", details: { field: "human_confirmed" } } });
        }
        return json(res, 200, await installProject(options.dshHomePath, input, { runnerPath: options.runnerPath, workspaceRoot: options.workspaceRoot }));
      }
      // Removing the managed hook weakens a live protection while the project
      // stays governed, so it carries the same intent requirement.
      if (path === "/governed-projects/uninstall-hook" && req.method === "POST") {
        const input = await readJson(req);
        if (input?.human_confirmed !== true) {
          return json(res, 200, { ok: false, error: { code: "human_intent_required", message: "07 §5.6 requires explicit Human intent: the request must carry human_confirmed: true", details: { field: "human_confirmed" } } });
        }
        return json(res, 200, await uninstallHook(input.path));
      }
      if (path === "/governed-projects/unregister" && req.method === "POST") {
        const input = await readJson(req);
        // 07 §5.6: cancellation requires explicit Human intent. The Web surface
        // IS the Human-facing entry (07 §5.4 item 2), so a UI action carries
        // that intent — but it must be carried EXPLICITLY in the request, not
        // assumed merely because the route was reached.
        if (input?.human_confirmed !== true) {
          return json(res, 200, { ok: false, error: { code: "human_intent_required", message: "07 §5.6 requires explicit Human intent: the request must carry human_confirmed: true", details: { field: "human_confirmed" } } });
        }
        return json(res, 200, await unregisterProject(options.dshHomePath, input));
      }
      return false;
    } catch (error) {
      return json(res, 400, { ok: false, error: { code: "request_failed", message: String(error?.message || error), details: {} } });
    }
  };
}
