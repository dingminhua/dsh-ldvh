
export function normalizeQuotationText(value) {
  return String(value ?? "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/~~/g, "")
    .replace(/`/g, "")
    .trim();
}
