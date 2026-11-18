
import { AUX_TASK_ORDER } from "./aux-task-registry.js";

export function readNumber(value, fallback) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function readPositiveNumber(value, fallback) {
  const n = readNumber(value, fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}


export function readBool(value, fallback) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  if (raw === undefined || raw === null) return fallback;
  return raw !== false;
}


export const IDLE_DEFAULTS = Object.freeze({});


export function resolveIdleSettings(config) {

  const tasks = {
    "experience-accumulation": readBool(config?.experienceAccumulationEnabled, true),
    "friction-discovery": readBool(config?.frictionDiscoveryEnabled, readBool(config?.idleCaptureEnabled, true)),
  };
  return {
    enabled: readBool(config?.proxyAssistEnabled, readBool(config?.idleAssistEnabled, true)),
    tasks,
  };
}




export function pickEnabledAuxTasks(settings) {
  if (settings === undefined || settings === null) {
    return { tasks: [...AUX_TASK_ORDER], reason: null };
  }
  if (settings.enabled === false) {
    return { tasks: [], reason: "idle-assist-disabled" };
  }
  const tasks = AUX_TASK_ORDER.filter((task) => settings.tasks?.[task] === true);
  return { tasks, reason: tasks.length === 0 ? "all-tasks-disabled" : null };
}

export { AUX_TASK_ORDER };

export function admitIdleDispatch({ settings, task }) {
  if (!settings?.enabled) return { admit: false, reason: "idle-assist-disabled" };
  if (settings.tasks?.[task] !== true) return { admit: false, reason: "task-disabled" };

  return { admit: true, reason: "admitted", evaluations: {} };
}

