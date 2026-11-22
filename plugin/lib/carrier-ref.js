
// 运行期来源指针的统一写法。
//
// 运行期规则正文以随插件发布的运行时机制载体（plugin-specs/<spec_key>.yaml）为准，
// 因此代码里对「这条要求出自哪里」的指称必须指向载体条目，不得指向开发规范章节号
// （开发规范是需求文档，不是运行期规则来源，且不随包发布）。
//
// 指针形态：`<spec_key> 的 <entry_id> 条目`；需要指到条目内某一处时追加 `（第 N 条）`。
// 校验入口见 plugin/test/carrier-ref.test.mjs。

export const CARRIER_ENTRY_REF_PATTERN = /([a-z][a-z0-9-]*) 的 ([a-z][a-z0-9-]*)(?: 与 ([a-z][a-z0-9-]*))? 条目/g;

export function carrierEntryRef(carrier, entryId) {
  return `${carrier} 的 ${entryId} 条目`;
}

export function carrierEntryRefList(carrier, entryIds) {
  return entryIds.map((entryId) => carrierEntryRef(carrier, entryId)).join("、");
}
