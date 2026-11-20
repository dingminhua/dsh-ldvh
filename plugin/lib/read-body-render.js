export const DEFAULT_READ_BODY_BYTE_LIMIT = 32768;

export function appendReadBody(lines, result, options = {}) {
  const body = result?.body;
  if (typeof body !== "string" || body.length === 0) return false;
  const limit = Number.isInteger(options.byteLimit) && options.byteLimit > 0
    ? options.byteLimit
    : DEFAULT_READ_BODY_BYTE_LIMIT;
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= limit) {
    lines.push("body: |");
    for (const line of body.split("\n")) lines.push(`  ${line}`);
    return true;
  }
  const truncated = truncateUtf8(body, limit);
  lines.push("body: |");
  for (const line of truncated.text.split("\n")) lines.push(`  ${line}`);
  lines.push(`body_truncated: true`);
  lines.push(`body_bytes: ${bytes} (limit ${limit}); omitted ${bytes - truncated.bytes} bytes`);
  lines.push(`not_completed: body 因字节上限截断——用 file 路径读取全文，或按 heading 分段后再读`);
  return true;
}

function truncateUtf8(text, limit) {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= limit) low = mid;
    else high = mid - 1;
  }
  const slice = text.slice(0, low);
  return { text: slice, bytes: Buffer.byteLength(slice, "utf8") };
}
