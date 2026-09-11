/**
 * dsh-ldvh — authoritative signature channel (specs/03 §6.1 + specs/09 机械签名).
 *
 * change_log 流水的 provider/model 署名是 Code 托管字段：只能由 Code 从 DSH
 * 权威会话/请求记录取得，不允许 AI 自填、用部署默认值替代或由调用方覆盖
 * (specs/09)。本模块把该契约做成机械边界：
 *
 *   - tools 层（research-tools.js 等）经 signatureFor() 读到权威路由后，用
 *     authoritativeSignature() 包装成带品牌（module-private Symbol）的载体——
 *     这是 writer 会落章的唯一形态。
 *   - writer 端用 resolveAuthoritativeSignature() 解析入参：非品牌载体
 *     （普通对象、字符串、任意手工构造值）一律解析为 null，流水条目按
 *     「路由不可用」的既定渲染写成无 provider/model——权威署名由 Git Gate
 *     在提交时以 trailer 附上（specs/06 §6.1）。
 *
 * 对直调 writer 的调用方（测试夹具、一次性脚本、绕过工具面的代理）的后果：
 * 机械上无法自填署名——普通对象签名被忽略，条目无署名。刻意伪造者需要
 * import 本工厂本身，在代码评审（09 质量链）中可见，而非偶然路径。
 *
 * 安全降级特性：若未来 tools 层重构误传原始路由对象（未走工厂），流水
 * 退化为无署名（安全侧失败），而不是落错值。
 */

const BRAND = Symbol("ldvh/authoritative-signature");

/**
 * Tools-layer factory: wrap a route record { provider, model } into the
 * branded carrier the writers will stamp into change_log.
 * Returns null for anything that is not a valid route record — the caller
 * then omits the signature entirely (unsigned entry).
 */
export function authoritativeSignature(route) {
  if (typeof route !== "object" || route === null) return null;
  if (typeof route.provider !== "string" || route.provider.length === 0) return null;
  if (typeof route.model !== "string" || route.model.length === 0) return null;
  return { [BRAND]: { provider: route.provider, model: route.model } };
}

/**
 * Writer-side resolver: branded carrier → { provider, model };
 * anything else (plain object, null, forged shape) → null, i.e. the
 * change_log entry renders without provider/model (the deterministic
 * "route unavailable" outcome, specs/09).
 */
export function resolveAuthoritativeSignature(arg) {
  if (typeof arg !== "object" || arg === null) return null;
  const value = arg[BRAND];
  if (typeof value !== "object" || value === null) return null;
  if (typeof value.provider !== "string" || value.provider.length === 0) return null;
  if (typeof value.model !== "string" || value.model.length === 0) return null;
  return { provider: value.provider, model: value.model };
}
