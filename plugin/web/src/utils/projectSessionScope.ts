/**
 * 会话跟随的项目选择（07 §7，Human 裁定 2026-10-29）。
 *
 * 诉求：多项目并行时「当前会话是哪个项目，打开的就是哪个项目」，不再靠手切。
 * 宿主插件半（`plugin/lib/client.js`）把会话标识交给管辖判定的唯一入口
 * `/ldvh/state/governance`，取回该项目 id 后以 `?ldvhProject=` 带进 iframe 地址；
 * 本模块只负责**把那个参数落成选择结果**，不自行解析路径、不读登记载体（08 §5
 * 是判定的唯一权威，07 §7 要求 Web 经该职责消费）。
 *
 * 优先级次序是刻意的：
 *   参数命中登记列表 > 已选项目仍有效 > defaultProjectId > 首个登记项目。
 * 「命中才算数」让取消登记、拼错的 id 落回既有回退链，页面照常可用而不是空页；
 * 「只在首个载入读取参数」由调用方记账，之后的刷新不得压过用户手选的项目。
 */

/** 与宿主插件半约定的查询参数名（两处必须同源演进）。 */
export const PROJECT_URL_PARAM = 'ldvhProject';

export type ProjectSelectionInput = {
  /** 本次文档载入携带的 `?ldvhProject=` 值；缺失为空串。 */
  urlProjectId: string;
  /** 载入前的选择（localStorage 记忆）；无选择为空串。 */
  currentProjectId: string;
  /** 登记载体的默认项目 id；无默认为空串。 */
  defaultProjectId: string | null | undefined;
  /** 已登记的管辖项目 id 集合。 */
  registeredProjectIds: readonly string[];
};

/**
 * 解析首个载入应选中的项目 id。返回空串表示无任何可选项（与改造前一致）。
 *
 * 纯函数：不碰 window、不碰 React，参数是否「命中登记列表」只由
 * `registeredProjectIds` 决定——这让本决策可在无 DOM 的测试运行器里逐态验证。
 */
export function resolveInitialProjectId(input: ProjectSelectionInput): string {
  const registered = new Set(input.registeredProjectIds);
  if (input.urlProjectId !== '' && registered.has(input.urlProjectId)) return input.urlProjectId;
  if (input.currentProjectId !== '' && registered.has(input.currentProjectId)) return input.currentProjectId;
  if (input.defaultProjectId && registered.has(input.defaultProjectId)) return input.defaultProjectId;
  return input.registeredProjectIds[0] ?? '';
}
