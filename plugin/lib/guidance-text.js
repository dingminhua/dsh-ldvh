
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const GUIDANCE_SECTION_NAME = "ldvh:minimal-guidance";
export const GUIDANCE_SECTION_ORDER = 1550;

export const GUIDANCE_MODE_DEV = "dev";
export const GUIDANCE_MODE_RUNTIME = "runtime";

const modeCache = new Map();

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function hasIdentityMarker(root) {
  const manifestPath = join(root, "plugin", "package.json");
  if (!(await isFile(manifestPath))) return false;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return manifest?.name === "dsh-ldvh";
  } catch {
    return false;
  }
}

export async function resolveGuidanceMode(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") return GUIDANCE_MODE_RUNTIME;
  const cached = modeCache.get(projectRoot);
  if (cached !== undefined) return cached;
  const dev = (await hasIdentityMarker(projectRoot)) && (await isDirectory(join(projectRoot, "plugin-specs")));
  const mode = dev ? GUIDANCE_MODE_DEV : GUIDANCE_MODE_RUNTIME;
  modeCache.set(projectRoot, mode);
  return mode;
}

export function noticeTextFor(scope) {
  const state = scope?.state;
  const line = judgmentLineFor(state);
  if (state !== "governed") return scope?.detail ? `${line}\n原因：${scope.detail}` : line;
  const project = scope.project ?? {};
  const rows = [
    line,
    "",
    `项目：${project.name ?? project.id ?? "（未命名）"}（${project.path ?? "路径未知"}）`,
    `判定依据：会话工作目录命中登记项目（ldvh/governed-projects.yaml）`,
    `登记指纹：${scope.registrationFingerprint ?? "未知"}`,
    "",
    "管辖效果：",
    "- ldvh_* 工具已注册（管辖判定 / 能力发现 / 提交预检 / 子代理回收）",
    "- 工作引导每回合注入（开发期会话给开发约定锚点，运行期会话给载体定位）",
    "- 受控提交经 Git Gate 机械校验",
    "- 规则正文以随插件发布的运行时机制（plugin-specs/）为准；specs/ 只是开发需求文档，不是行动规则"
  ];
  if (project.description) rows.splice(2, 0, `描述：${project.description}`);
  return rows.join("\n");
}

export function noticeSummaryFor(state) {
  if (state === "governed") return "本会话受 LDVH 管辖";
  if (state === "unavailable") return "管辖登记不可读";
  return "本会话不受 LDVH 管辖";
}

export function judgmentLineFor(state) {
  if (state === "governed") return "【LDVH 管辖判定】governed —— 本会话受 LDVH 管辖。";
  if (state === "unavailable") return "【LDVH 管辖判定】unavailable —— 登记不可读，按不受辖处理。";
  return "【LDVH 管辖判定】not_governed —— 本会话不受 LDVH 管辖，LDVH 工具不注册。";
}

export function migrationLineFor(fromState, toState) {
  return `【LDVH 管辖状态变更】${fromState ?? "未知"} → ${toState} —— 本回合起按新状态执行，此前上下文中的 LDVH 信息可能已失效。`;
}

const GOVERNED_GUIDANCE_DEV = `本会话工作锚点（specs/00-理念与构成.md；这是开发约定，不是运行期规则）：
1. 身份块——每个 specs/ 载体首部 ldvh_spec/ldvh_attachment 声明身份、依据与关系
2. §1 核心价值——对齐 Vibe（人与 AI 对项目的由来、现状、去向形成一致认识）、协调 Coding（明晰权责、记录火花、确立规范、构建报告、积累经验、发现摩擦）
3. §2 方法与构成——根方案六条（§2.1）+ 能力承载（LDVH CLI 确定性服务/宿主原生机制，§2.3）+ 规范源与事实源（§2.4：开发规范是开发需求与开发约定，运行期规则由运行时机制承载）+ 检查机制（主控自查/机械校验/代理审核/代理复核，§2.5）+ 业务系统（目标规划/火花记录/把关请示/调研吸收/双源召回/经验积累/摩擦销账，§2.6 名录）+ 技术与机械保障（§2.7）+ 插件四种价值交付（§2.8）+ 下位承接（§2.9）
4. §3 Human 权利——根决定清单（§3.2）、Human Gate、受保护内容（§3.3）、可决提请与回应效力（§3.4）
5. §4 AI 责任与义务——主控发起的行动由单一主控 AI 最终负责、代理辅助任务由机械校验保障（00 §4.5）、非全知、委派不转责（代理辅助任务除外，00 §4.3）、反稀释（01 §5 第 13 项）；§4.6 据实声明、§4.7 必停情形与恢复、§4.8 交还与撤回
6. §5 价值纪律——机制准入（§5.1）、价值不因材料存在而成立（§5.2）、冲突与变更（§5.3）
能力发现：ldvh_discover_capabilities；受控提交前：ldvh_precheck_git_commit；
模型面提请：不经 LDVH 接缝、直接调用宿主 ask_user_question 时，question 长短不限，判断依据写进对话正文；detail 不随弹窗送达（宿主静默丢弃），凡需 Human 判读的内容一律写进对话正文；携带 detail 等未允许字段的提请会被本仓 guard 机械拒绝——「不写 detail」这一半有机械保障，且它只约束字段形状、不约束字数；
创建确认不重复：当该类型载体规定创建由人决定、且写入工具已内置该确认时，主控不就同一动作另发确认弹窗（spark-fact-type 的 ask-human、norm-fact-type 的 create-needs-human）；呈报要素在调用工具前逐项写进对话正文。本行只免同一动作的重复弹窗，不减任何类型的确认义务——无工具内部 Gate 的类型（如 subgoal-fact-type 的 create-human）仍按该类型载体提请；合并/拆分等组合处置按 spark-fact-type 的 ask-human 归属，逐步骤多出的询问属已知实现限制，须如实披露。此为对 AI 的指令、无机械保障（本仓 guard 只约束模型面提请的字段形状，不判弹窗次数）；
管辖状态：ldvh_resolve_governance_scope。本引导只给定位与必要要点，不复制条目正文。
运行期规则以随插件发布的运行时机制为准；定位信息由行动前召回段的「运行时机制：」段给出（spec_key／标题／路径／positioning／scope），需要条目正文时按该路径读取，项目根下没有 plugin-specs/ 时它在插件包目录内。specs/ 里描述运行期做法的文字是开发需求记录，不构成运行期规则。
若本仓库不是 LDVH 开发仓库（例如只是带了 specs/ 与 plugin-specs/ 副本的第三方项目），以上开发约定不适用，按运行期会话处理。`;

const GOVERNED_GUIDANCE_RUNTIME = `本会话的工作规则只来自两处：随插件发布的运行时机制（plugin-specs/*.yaml），与本项目事实源里的规范（ldvh-base/norms/）；其余文字（包括 LDVH 自己的开发需求文档）都不是行动规则（ldvh-root 的 rule-sources）。
定位：行动前召回段的「运行时机制：」段给出本轮相关载体的定位（spec_key／标题／路径／positioning／scope），需要条目正文时按该路径读取；项目根下没有 plugin-specs/ 时它在插件包目录内，安装形态下该段给可读绝对路径。未列出者不代表不存在：召回取值部分或不可用时，未命中不构成「无相关」的证据（rule-compliance-recall 的 incomplete-recall）。
底线：全部行动共用的底线在载体 ldvh-root（对齐 Vibe 与协调 Coding 的价值取向、谁发起谁负责、人的决定权、不知道就说不知道、必停与交还）；各领域要求在其对应载体里，按场景定位后读。
入口：能力发现 ldvh_discover_capabilities；受控提交前 ldvh_precheck_git_commit；管辖状态 ldvh_resolve_governance_scope。本引导只给定位与必要要点，不复制条目正文。`;

const UNAVAILABLE_GUIDANCE = `LDVH 管辖登记当前不可读取。本项目暂按不受管辖处理（与 not_governed 一致），但状态确为「不可用」而非「不受辖」，不得据此认定本项目不受辖。
- 行动：与不受辖一致——不启用 LDVH 受控操作，不声明本项目受辖；
- 原因与处理：检查 DSH 用户配置根下的 ldvh/governed-projects.yaml 是否可读且格式正确（常见原因：配置根不可用、登记载体不可读、权限未核验、访问被拒或 Schema 无效；成因清单记在开发需求文档 specs/07 §5.3），或在 DSH 设置页的管辖项目页查看具体原因。
规则正文以随插件发布的运行时机制为准，本引导不复制条目正文。`;

const NOT_GOVERNED_GUIDANCE = `本会话无 LDVH 工作要求；如被问及 LDVH，据实回答本会话不受管辖。`;

export function guidanceTextFor(state, mode = GUIDANCE_MODE_RUNTIME) {
  const line = judgmentLineFor(state);
  if (state === "governed") {
    const body = mode === GUIDANCE_MODE_DEV ? GOVERNED_GUIDANCE_DEV : GOVERNED_GUIDANCE_RUNTIME;
    return `${line}\n${body}`;
  }
  if (state === "unavailable") return `${line}\n${UNAVAILABLE_GUIDANCE}`;
  return `${line}\n${NOT_GOVERNED_GUIDANCE}`;
}
