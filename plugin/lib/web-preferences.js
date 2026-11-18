
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
    const temporaryPath = join(dirname(filePath), `.${await basename(filePath)}.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, serializeYaml(colors), "utf8");
    const { rename } = await import("node:fs/promises");
    await rename(temporaryPath, filePath);
  }
  return readGovernedProjectsWithColors(dshHomePath);
}

async function basename(filePath) {
  const { basename: pathBasename } = await import("node:path");
  return pathBasename(filePath);
}
