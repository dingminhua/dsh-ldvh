
export const COHERENCE_CLIP = 400;

export function clipped(text, max = COHERENCE_CLIP) {
  const value = typeof text === "string" ? text : String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}…（共 ${value.length} 字）` : value;
}

export function carrierCoherenceMessage({ section, field, declared, actual, clause, mode = "rejection" }) {
  const where = clause === undefined || clause.length === 0 ? "" : `, ${clause}`;
  const body = ` ${field}=${JSON.stringify(clipped(declared))}`
    + `; section=${JSON.stringify(clipped(actual))}`;
  if (mode === "divergence") {
    return `carrier coherence (reported, NOT blocking): ${section} section differs from ${field}`
      + ` (frontmatter is the index/summary layer and the body expands it${where}):`
      + body;
  }
  return `carrier coherence: ${section} section must contain ${field} verbatim`
    + ` (frontmatter is the single authoritative text${where}):`
    + body;
}
