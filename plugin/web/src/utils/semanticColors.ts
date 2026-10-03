/**
 * 横切语义色原子（单一来源）——docs/01「色彩和状态」节（行 303-311）的类串收敛。
 *
 * 分工边界（三个颜色源各管一层）：
 * - statusColors.ts：状态点/状态文本的 hex 内联色（STATUS_COLORS + getStatusColor）；
 * - categoryColors.ts：对象类型色（识别「这是什么对象」）；
 * - 本模块：错误 / 警告 / 信息 / 达成四族**横切语义**在多文件重复出现的
 *   Tailwind 类串。此前同一语义在 16 个文件各抄一份且带微漂移
 *   （border /20 /25 /30、bg /5 /10 /[0.07]、文字 /90 后缀、green 与 emerald
 *   家族混用并存）——批次 B 统一收敛到这里。
 *
 * 规范锚点（docs/01 行 303-311）：
 * - 行 305：颜色表达状态和语义，不作为装饰性主角；
 * - 行 306：精确语义映射——阻塞/错误/风险用对应警示色；
 * - 行 308：红色只用于错误、风险、失败或阻断，不用于普通关闭或退出；
 * - 行 311：彩色语义面的标题/正文/背景必须同色相。
 *
 * 例外（不经本模块，登记于设计语言文档）：
 * - diff 语法高亮（增删行、hunk 头、diff 统计色调）——代码高亮豁免（docs/01 §1.4）；
 * - 图表内色段（CognitionCenter 度量条等）——图表豁免；
 * - 域内单源表：workcaseCheckState / objectSignals / WorkCaseClosedStatusBadge /
 *   WorkCaseGistLine / WorkCaseCriteriaList（WorkCase 域 600 系强 chip 档，
 *   与本模块横切档刻意不同密度）；
 * - 文件内一次性映射（ObjectList 状态图标 map、Friction 决策面板、Spark 紫块等）。
 *
 * 几何（padding/radius/尺寸）不进本模块——只收敛色相决策，几何由使用处自带。
 */

/** 行内错误文本与错误图标（红 400 档）。 */
export const LDVH_ERROR_TEXT_CLASS = 'text-red-400';

/** 错误面板色相对：边框红 500/30 + 底红 500/10（多数派定案）。 */
export const LDVH_ERROR_SURFACE_CLASS = 'border-red-500/30 bg-red-500/10';

/** 错误面板标题/强文本。 */
export const LDVH_ERROR_TITLE_CLASS = 'text-red-700 dark:text-red-300';

/** 错误面板次级正文（弱一档，元信息行）。 */
export const LDVH_ERROR_BODY_CLASS = 'text-red-700/80 dark:text-red-300/80';

/** 嵌入式提示面：边框琥珀 500/25 + 底琥珀 500/5——详情页内联警示（多数派）。 */
export const LDVH_WARN_SURFACE_CLASS = 'border-amber-500/25 bg-amber-500/5';

/** 独立警示盒：边框琥珀 500/30 + 底琥珀 500/10——页面级告警/缺内容盒。 */
export const LDVH_WARN_SURFACE_STRONG_CLASS = 'border-amber-500/30 bg-amber-500/10';

/** 警示标题/强文本。 */
export const LDVH_WARN_TITLE_CLASS = 'text-amber-700 dark:text-amber-300';

/** 信息 chip 色相——天蓝族（docs/01 行 306「推进中使用天蓝色系」）。 */
export const LDVH_INFO_CHIP_HUE_CLASS = 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400';

/** 待办/注意 chip 色相——琥珀族，共享独立警示盒的色相对。 */
export const LDVH_WARN_CHIP_HUE_CLASS = `${LDVH_WARN_SURFACE_STRONG_CLASS} text-amber-600 dark:text-amber-400`;

/** 达成 chip 色相——祖母绿族（docs/01 行 306 正向达成语义）。 */
export const LDVH_SUCCESS_CHIP_HUE_CLASS = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
