/**
 * Web 呈现偏好（项目颜色）——插件侧读写。
 *
 * 载体：dshHome 下 ldvh/web-preferences.yaml（与登记载体同目录），键为项目 ID，
 * 值必须为色板键名闭集成员。颜色是呈现偏好不是管辖事实：独立于
 * governed-projects.yaml（那是安装事务的地盘），Web 侧与插件设置卡共用本模块。
 */

/** 十色板键名闭集——与 plugin/web/shared/projectColors.ts 同源（两处闭集必须同步演进）。 */
export const PROJECT_COLOR_KEYS = Object.freeze([
  "emerald",
  "sky",
  "violet",
  "amber",
  "rose",
  "cyan",
  "indigo",
  "orange",
  "teal",
  "fuchsia",
]);

export function isProjectColorKey(value) {
  return typeof value === "string" && PROJECT_COLOR_KEYS.includes(value);
}

/** CSS 变量名（--ldvh-pj-<key>，亮暗值定义在 Web 的 index.css）。 */
export function projectColorVar(key) {
  return `var(--ldvh-pj-${key})`;
}

function preferencesPath(dshHomePath) {
  return dshHomePath("ldvh", "web-preferences.yaml");
}

function serializeYaml(colors) {
  const lines = ["# LDVH Web 呈现偏好（项目颜色）——由插件设置卡与 Web 设置页读写。", "project_colors:"];
  const ids = [...colors.keys()].sort();
  if (ids.length === 0) lines.pop();
  for (const id of ids) lines.push(`  ${id}: ${colors.get(id)}`);
  return `${lines.join("\n")}\n`;
}

function parseColors(content) {
  const colors = new Map();
  const pattern = /^\s{2}([A-Za-z0-9_.-]+):\s*([a-z]+)\s*$/;
  let inSection = false;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim().startsWith("#")) continue;
    if (/^project_colors:\s*$/.test(line)) { inSection = true; continue; }
    if (inSection) {
      const match = pattern.exec(line);
      if (match && isProjectColorKey(match[2])) colors.set(match[1], match[2]);
    }
  }
  return colors;
}

const { readFile, writeFile, rm } = await import("node:fs/promises");

export async function readProjectColors(dshHomePath) {
  try {
    return parseColors(await readFile(preferencesPath(dshHomePath), "utf8"));
  } catch {
    return new Map();
  }
}

/** 读登记项目（id/name/path）并合并颜色——供设置卡与 Web API 呈现。 */
export async function readGovernedProjectsWithColors(dshHomePath) {
  const [registration, colors] = await Promise.all([
    import("./governed-projects.js").then((m) => m.readGovernedProjects(dshHomePath)),
    readProjectColors(dshHomePath),
  ]);
  if (!registration.ok) return registration;
  const projects = registration.value.projects.map((project) => ({
    ...project,
    ...(colors.has(project.id) ? { color: colors.get(project.id) } : {}),
  }));
  return { ok: true, value: { ...registration.value, projects } };
}

/**
 * 更新单项目颜色。color 为 null/undefined 表示清除（回到按 ID 哈希的自动取色）。
 * 写入原子（临时文件+改名），全部清除时删除偏好文件。
 */
export async function updateProjectColor(dshHomePath, projectId, color) {
  if (color !== null && color !== undefined && !isProjectColorKey(color)) {
    return { ok: false, error: { code: "invalid_color", message: `颜色必须是预制色板键名：${PROJECT_COLOR_KEYS.join("/")}`, details: {} } };
  }
  const registration = await import("./governed-projects.js").then((m) => m.readGovernedProjects(dshHomePath));
  if (!registration.ok) return registration;
  if (!registration.value.projects.some((project) => project.id === projectId)) {
    return { ok: false, error: { code: "not_registered", message: `未登记的项目：${projectId}`, details: {} } };
  }
  const colors = await readProjectColors(dshHomePath);
  if (color) colors.set(projectId, color);
  else colors.delete(projectId);
  const filePath = preferencesPath(dshHomePath);
  const { dirname, join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  if (colors.size === 0) {
    await rm(filePath, { force: true });
  } else {
    const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, serializeYaml(colors), "utf8");
    const { rename } = await import("node:fs/promises");
    await rename(temporaryPath, filePath);
  }
  return readGovernedProjectsWithColors(dshHomePath);
}

function basename(filePath) {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}
