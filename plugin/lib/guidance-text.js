// LDVH minimal rule-guidance text (candidate pending Human confirmation).
//
// Status: this text is the "插件 AI 面向语义文本" protected class (08 §7.6,
// decision #14). It ships as a CANDIDATE in this batch and must be confirmed
// by the Human (逐段同意) before any release; committing it inside the P0
// implementation commit marks it as implemented-as-candidate, not confirmed.
//
// Contract (specs/01 §10.4): the minimal guidance names the seven 00 anchors
// — identity block, §2 root scheme, §3.1 eight dimensions, §4 Human decision
// rights, §5 AI responsibilities, §6 dual-track values, §7 anti-self-deception/
// Stop/handover — WITHOUT copying rule text (no second rule source, 08 §5.3
// single-authority red line). Anchor names calibrate to the current 00 text.

export const GUIDANCE_SECTION_NAME = "ldvh:minimal-guidance";
export const GUIDANCE_SECTION_ORDER = 1550;

const GOVERNED_GUIDANCE = `【LDVH 管辖会话最小引导】
本项目受 LDVH 管辖（specs/00-理念与构成.md）。工作锚点：
1. 身份块——每个 specs/ 载体首部 ldvh_spec/ldvh_attachment 声明身份、依据与关系
2. §2 根方案——八维工作模型 + 三类语义构成要素 + 规范源/事实源 + 插件四种价值交付
3. §3.1 八维——读、写、遵守、审议、复核、执行、反思、沉淀
4. §4 Human 决定权——根决定清单、Human Gate 与受保护文档
5. §5 AI 责任——单一主控最终负责、非全知、委派不转责、反稀释
6. §6 双轨价值——V1–V8 / HV1–HV5
7. §7 防自欺、Stop Conditions 与交还——机械锚点、暂停条件、最小交还结构
规则读取：ldvh_read_specification_candidates / ldvh_read_specification_content（L0–L4 渐进披露）；
能力发现：ldvh_discover_capabilities；受控提交前：ldvh_precheck_git_commit；
管辖状态：ldvh_resolve_governance_scope。完整规则以规范源原文为准，本引导不复制规则正文。`;

const UNAVAILABLE_GUIDANCE = `【LDVH 管辖状态不可用】
LDVH 管辖登记当前不可读取。本项目暂按不受管辖处理（与 not_governed 一致），但状态确为「不可用」而非「不受辖」，不得据此认定本项目不受辖。
- 行动：与不受辖一致——不启用 LDVH 受控操作，不声明本项目受辖；
- 原因与处理：检查 DSH 用户配置根下的 ldvh/governed-projects.yaml 是否可读且格式正确（可能原因见 specs/07 §5.3：配置根不可用、登记载体不可读、权限未核验、访问被拒或 Schema 无效），或在 DSH 设置页的管辖项目页查看具体原因。
完整规则以规范源原文为准，本引导不复制规则正文。`;

/**
 * Guidance text for a governance state. not_governed returns "" — the empty
 * section is filtered out at assembly time, which IS the zero-interference
 * guarantee (§15 item 1).
 */
export function guidanceTextFor(state) {
  if (state === "governed") return GOVERNED_GUIDANCE;
  if (state === "unavailable") return UNAVAILABLE_GUIDANCE;
  return "";
}
