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
 * 机械上无法自填署名——普通对象签名被忽略。直调若要落章，正规通道是
 * session-signature.js 的 shellAuthoritativeSignature()（DSH shell 子进程
 * 中从自己继承的会话环境解析权威路由并产出品牌载体）：值全程 Code→Code，
 * 代理不经手。刻意伪造者需要 import 本工厂本身，在代码评审（09 质量链）
 * 中可见，而非偶然路径。
 *
 * 安全降级特性：若未来 tools 层重构误传原始路由对象（未走工厂），流水
 * 退化为无署名（安全侧失败），而不是落错值。
 */

const BRAND = Symbol("ldvh/authoritative-signature");
const IDENTITY_BRAND = Symbol("ldvh/authoritative-session-identity");

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

/**
 * Writer-side GATE: a change_log entry must carry the authoritative signature.
 *
 * Human requirement (2026-09-12): "changelog 和提交都要机械署名，不能署名的
 * 要报告 human". The commit half is already enforced (06 §6.1 trailer rules are
 * `blocking`); this is the object half.
 *
 * `03 §6.1` says the entry's `at`, signature and identity are filled BY CODE —
 * it never permits omitting the signature. `09` adds that unavailable-signature
 * situations (blank/historical session, model switch) must have a
 * "确定性取值与不可用结果" — i.e. a DEFINITE unavailable outcome, not a silent
 * unsigned write.
 *
 * So the writer refuses to write when no signature can be resolved, and returns
 * a precise, Human-reportable reason. The caller must surface it (not retry,
 * not fill a placeholder — `09` forbids AI self-signing or deployment defaults).
 *
 * @returns {{ ok: true, signature: {provider, model} } | { ok: false, code, message }}
 */
export function requireAuthoritativeSignature(carrier, { context = "change_log entry" } = {}) {
  const signature = resolveAuthoritativeSignature(carrier);
  if (signature !== null) return { ok: true, signature };
  return {
    ok: false,
    code: "signature_unavailable",
    message: `refusing to write ${context} without the authoritative provider/model: `
      + "no branded session signature was supplied (09 机械签名 requires Code to obtain it from the DSH "
      + "authoritative session record; AI must not self-fill, use a deployment default, or have a caller override it). "
      + "REPORT TO HUMAN: this write cannot be signed, so it must not be recorded as a stable fact."
  };
}

// ---------------------------------------------------------------------------
// Authoritative SESSION IDENTITY channel (WorkCase 关闭侧身份比对)
// ---------------------------------------------------------------------------
//
// 需求来源：`workcase-2be11478`（Human 2026-09-19 裁定）——WorkCase 关闭前必须存在
// 至少一条由**独立于实施者的会话**产出的复核记录，低风险工单不豁免。
//
// 为什么不能复用 provider/model 署名：`resolveAuthoritativeSignature` 的值取自会话
// **路由**记录（session-signature.js 尾读 `model/selection`/`request/context`），它是
// 「这次跑在哪个 provider/model 上」，不是「这是哪个会话」。同一路由下的两个不同
// 会话会盖出**完全相同**的署名——实测为证：`workcase-4005b67b`（2026-09-17 另一会话
// 写入）与 `workcase-2be11478`（2026-09-19 本会话）的署名同为
// `provider: workbuddy, model: deepseek-v4.1-flash`。故署名**不能**支撑「复核者 ≠
// 实施者」的比对，必须另立身份通道。
//
// 为什么需要品牌（BRAND）而不是普通字段：与署名通道同一纪律——身份只能由 Code 从
// DSH 会话记录取得。普通对象、字符串、任意手工构造值一律解析为 null，使 AI 无法
// 自填一个「不同的会话 id」来通过门禁。刻意伪造者需要 import 本工厂本身，在代码
// 评审（09 质量链）中可见，而非偶然路径。
//
// 取值来源（经实测确认，2026-09-19）：DSH 权威会话记录的 `session` 首行，其
// `id` 即该会话自己的标识；子代理会话另有 `origin: "subagent"`、`parentSession`
// 与 `delegationDepth` 字段。父会话 id 不在子会话的 shell 环境里，须从该记录读。

/**
 * 会话身份载体：{ sessionId, source, origin, parentSession, delegationDepth }。
 *
 * `source` 是**可信度**标记，不是装饰：
 *   - `"host"`：身份由宿主执行上下文取得（`currentSessionIdentity(sessionPersistence, agent)`，
 *     `agent` 来自 DSH 的工具执行/装配上下文，**不由工具参数或环境变量控制**）；
 *   - `"shell"`：身份由 `shellAuthoritativeSessionIdentity()` 从**环境变量 + 日志文件**取得。
 *
 * **为什么必须区分（独立对抗复核实测发现，2026-09-19）**：shell 路径逐字采信
 * `DSH_SESSION_JSONL`/`DSH_HOME`+`DSH_SESSION_ID`，而这两者对调用者（AI 的一次 bash
 * 调用）是**可设置的**。实测：`DSH_SESSION_JSONL=/tmp/forged.jsonl`（内容仅一行
 * `{"type":"session","id":"session-ANYTHING"}`）即铸出**真品牌**身份，无需 import 本
 * 工厂。故 `"shell"` 来源的身份**可被实施者伪造**，不能作为关闭侧独立性的证据；
 * WorkCase 写入器对复核身份只接受 `"host"` 来源（见 workcase-writer 的关闭门禁）。
 *
 * 本字段不改「品牌」纪律（普通对象/字符串仍解析为 null），只是把 shell 通道的
 * **可信度上限**如实标出——原注释「刻意伪造者需要 import 本工厂本身」是**过度声明**，
 * 已据实测更正。
 */
function identityRecord({ sessionId, source = null, origin = null, parentSession = null, delegationDepth = null }) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const record = { sessionId };
  if (source === "host" || source === "shell") record.source = source;
  if (typeof origin === "string" && origin.length > 0) record.origin = origin;
  if (typeof parentSession === "string" && parentSession.length > 0) record.parentSession = parentSession;
  if (Number.isInteger(delegationDepth) && delegationDepth >= 0) record.delegationDepth = delegationDepth;
  return { [IDENTITY_BRAND]: Object.freeze(record) };
}

/**
 * Tools-layer factory: wrap a session-identity record into the branded carrier
 * the WorkCase writer accepts for `attempt.session_id` / `reviews[].session_id`.
 * Returns null for anything that is not a usable identity — the caller then
 * omits it (and the close gate fails closed rather than guessing).
 */
export function authoritativeSessionIdentity(record) {
  if (typeof record !== "object" || record === null) return null;
  return identityRecord(record);
}

/**
 * Writer-side resolver: branded carrier → identity record;
 * anything else (plain object, string, forged shape) → null.
 */
export function resolveAuthoritativeSessionIdentity(arg) {
  if (typeof arg !== "object" || arg === null) return null;
  const value = arg[IDENTITY_BRAND];
  if (typeof value !== "object" || value === null) return null;
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return null;
  const record = { sessionId: value.sessionId };
  if (value.source === "host" || value.source === "shell") record.source = value.source;
  if (typeof value.origin === "string" && value.origin.length > 0) record.origin = value.origin;
  if (typeof value.parentSession === "string" && value.parentSession.length > 0) record.parentSession = value.parentSession;
  if (Number.isInteger(value.delegationDepth) && value.delegationDepth >= 0) record.delegationDepth = value.delegationDepth;
  return record;
}
