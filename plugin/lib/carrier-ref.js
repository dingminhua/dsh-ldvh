

export const CARRIER_ENTRY_REF_PATTERN = /([a-z][a-z0-9-]*) 的 ([a-z][a-z0-9-]*)(?: 与 ([a-z][a-z0-9-]*))? 条目/g;

export function carrierEntryRef(carrier, entryId) {
  return `${carrier} 的 ${entryId} 条目`;
}

export function carrierEntryRefList(carrier, entryIds) {
  return entryIds.map((entryId) => carrierEntryRef(carrier, entryId)).join("、");
}
