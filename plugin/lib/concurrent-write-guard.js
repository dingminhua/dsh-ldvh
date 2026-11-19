
export function decideMutationWrite({ currentContent, lastWrittenContent = null } = {}) {
  const current = typeof currentContent === "string" ? currentContent : null;
  const last = typeof lastWrittenContent === "string" ? lastWrittenContent : null;

  if (last === null) return { ok: true, ownsWrite: true };

  if (current === null) {
    return {
      ok: false,
      code: "concurrent-write/gone",
      reason: "the file disappeared after this process wrote it — refusing to recreate a file someone else removed",
    };
  }

  if (current !== last) {
    return {
      ok: false,
      code: "concurrent-write/detected",
      reason: "the file was modified after this process wrote it — refusing to overwrite another writer's in-flight change",
    };
  }

  return { ok: true, ownsWrite: true };
}

export const decideMutationRestore = decideMutationWrite;
