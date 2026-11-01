/**
 * Fact-object reference rendering (specs/02 §9.3 候选条款).
 *
 * 事实对象的指称形态：最小形态为「类型短名 + 短标识」（如 `friction-abf557e1`）；
 * 需要读者据此辨认对象时，紧随其标题（如 `friction-abf557e1 局部改动时以记忆或截断输出为数据源`）。
 *
 * 本模块是**唯一的形态生成点**：所有工具响应投影都从这里取，避免各渲染点自行拼
 * 类型短名而形成第二权威（`fact_type_key` 的值域登记在 02 §7.1，不在代码里）。
 *
 * 解析不到类型或标识时**如实退化**为原样输出，绝不猜造类型短名：猜造会让读者以为
 * 该对象属于一个它并不属于的类型——那比缺少类型更坏。
 */

/**
 * 类型短名的值域（02 §7.1 的 `fact_type_key` 值；此处只用于校验，不用于生成）。
 *
 * **本清单必须与 `source-recall.js` 的 `REGISTERED_FACT_TYPES` 逐项相等**——两处
 * 是同一事实（「哪些事实类型已登记」）的两个消费面：召回侧用它决定扫哪些目录，
 * 渲染侧用它决定要不要加类型前缀。二者**已经漂移过**：`subgoal` 在 2026-11-01
 * 成为 28 号类型时只同步了召回侧，本清单漏改，后果是所有子目标对象经
 * `objectRef()` 渲染成裸 8 位十六进制（读者认不出这是子目标），且没有用例报错。
 *
 * 修法不是「记得下次别忘」：`plugin/test/fact-type-registry-agreement.test.mjs`
 * 断言两集合相等，新增类型而不同步任一侧即转红。
 */
const FACT_TYPE_KEYS = new Set([
  "spark",
  "workcase",
  "adr",
  "pitfall",
  "friction",
  "research",
  "norm",
  "goal",
  "subgoal",
  "devlog",
]);

/** 供「两份清单须相等」的机械用例读取；业务调用方不得用它生成指称。 */
export const __FACT_TYPE_KEYS_FOR_TEST = FACT_TYPE_KEYS;

/** 短标识：`object_uid` 的前 8 位（小写十六进制）。 */
export function shortUid(objectUid) {
  if (typeof objectUid !== "string") return "";
  return objectUid.trim().slice(0, 8);
}

/**
 * 渲染一个事实对象的指称。
 *
 * @param {{object_uid?: string, fact_type_key?: string, title?: string}} item
 * @param {{withTitle?: boolean}} [options] - withTitle 默认 false：最小形态不自动带标题，
 *   由调用方按「读者是否要据此辨认对象」决定（02 §9.3 第 2 条是写作者的读者判断，
 *   机械层不判）。
 * @returns {string} `<type>-<8hex>`、`<8hex>`（类型缺失时退化）或 `""`（标识缺失）。
 */
export function objectRef(item, { withTitle = false } = {}) {
  const uid = shortUid(item?.object_uid);
  if (uid === "") return "";
  const typeKey = typeof item?.fact_type_key === "string" ? item.fact_type_key.trim() : "";
  const ref = FACT_TYPE_KEYS.has(typeKey) ? `${typeKey}-${uid}` : uid;
  const title = typeof item?.title === "string" ? item.title.trim() : "";
  return withTitle && title !== "" ? `${ref} ${title}` : ref;
}

/**
 * 用于**执行体提示词**的指称：短标识 + 标题 + 完整 `object_uid`。
 *
 * 执行体要把 `object_uid` 作为结构化字段回填（60 字符的上界由 schema 约束），
 * 故此处必须给出**完整** uid——截成 8 位会让执行体无从回填合法值。完整 uid 只
 * 落在提示词的括号里，读者辨认仍靠前段的「类型短名 + 短标识 + 标题」。
 *
 * @param {{object_uid?: string, fact_type_key?: string, title?: string}} item
 * @returns {string} `<type>-<8hex> <title> (<uid>)`
 */
export function promptObjectRef(item) {
  const uid = typeof item?.object_uid === "string" ? item.object_uid.trim() : "";
  if (uid === "") return "";
  const ref = objectRef(item, { withTitle: true });
  return `${ref} (${uid})`;
}

/**
 * 把 `object_uid` 换成指称形态；用于只持有 uid 与已知类型的渲染点。
 *
 * @param {string} objectUid
 * @param {string} factTypeKey - 取自 writer 的 `fact_type_key` 或该类型工具自己的类型常量
 * @param {{withTitle?: boolean, title?: string}} [options]
 * @returns {string}
 */
export function objectRefOf(objectUid, factTypeKey, { withTitle = false, title = "" } = {}) {
  return objectRef({ object_uid: objectUid, fact_type_key: factTypeKey, title }, { withTitle });
}
