
const FACT_TYPE_KEYS = new Set([
  "spark",
  "pitfall",
  "friction",
  "report",
  "norm",
  "goal",
  "subgoal",
]);

export const __FACT_TYPE_KEYS_FOR_TEST = FACT_TYPE_KEYS;

export function shortUid(objectUid) {
  if (typeof objectUid !== "string") return "";
  return objectUid.trim().slice(0, 8);
}

export function objectRef(item, { withTitle = false } = {}) {
  const uid = shortUid(item?.object_uid);
  if (uid === "") return "";
  const typeKey = typeof item?.fact_type_key === "string" ? item.fact_type_key.trim() : "";
  const ref = FACT_TYPE_KEYS.has(typeKey) ? `${typeKey}-${uid}` : uid;
  const title = typeof item?.title === "string" ? item.title.trim() : "";
  return withTitle && title !== "" ? `${ref} ${title}` : ref;
}

export function promptObjectRef(item) {
  const uid = typeof item?.object_uid === "string" ? item.object_uid.trim() : "";
  if (uid === "") return "";
  const ref = objectRef(item, { withTitle: true });
  return `${ref} (${uid})`;
}

export function objectRefOf(objectUid, factTypeKey, { withTitle = false, title = "" } = {}) {
  return objectRef({ object_uid: objectUid, fact_type_key: factTypeKey, title }, { withTitle });
}
