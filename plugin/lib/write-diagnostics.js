export function repairedLengthMessage(label, value, max, rule) {
  const count = typeof value === "string" ? Array.from(value).length : 0;
  const head = `${label}: must be ≤ ${max} characters (${rule}), got ${count}`;
  if (count <= max) return head;
  const overBy = count - max;
  const candidate = Array.from(value).slice(0, max).join("");
  return `${head} (over by ${overBy}) — 机械截取候选值（前 ${max} 字，须自行确认语义与载体内聚后再回填）: "${candidate}"`;
}
