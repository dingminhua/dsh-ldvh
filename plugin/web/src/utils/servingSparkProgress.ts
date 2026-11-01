import type { ServingWorkItem } from '@/utils/api';

/**
 * 子目标「火花落实」比值的**单点派生**（Human 定案 2026-11-02）。
 *
 * Human 原话：「sg 需要呈现一个进度条件，分母是关联的所有 spark，待处理+已落实，
 * 分子是已落实」。
 *
 * ## 为什么这不违反 28 §8.1
 *
 * §8.1 禁止的是两件事，与这里都不同：
 * 1. **不得把拆解/落实情况存储为字段**——本函数与它的调用方都不写盘，分子分母
 *    每次都从 `serves` 反查的 `serving_work` 行现算（该派生本身也是读取时算的，
 *    `facts.ts` 的 `deriveServingWorkIndex` 就是唯一入口）。
 * 2. **不得把空集折算成「进度 0%」**——本函数刻意**不产出 0/0**：分母为 0 时返回
 *    `empty` / `allDiscarded` 两种不同状态，由呈现层分别说清「名下没有火花」与
 *    「火花全部已废弃」，而不是画一条空进度条。
 *
 * 「进度」在这里是**对已存在引用的计数**，不是对「还没拆解」的猜测。差别在于：
 * 前者每个数字都能由读者点开名下工作逐条核对，后者是一个无法核对的状态值。
 *
 * ## 为什么分母排除已废弃
 *
 * 20 §9：`discarded` 是「废弃/被合并/被拆分」——它结束了一条火花，但**不代表这条
 * 子目标少了一件该做的事**（责任已转移或明确放弃）。把它算进分母会让「废弃掉一半
 * 火花」显示成进度倒退，而那其实是处置进展。故分母只取 Human 指定的两态：
 * `open`（待处理）+ `implemented`（已落实）。
 *
 * ## 状态未知的处置
 *
 * Spark 的状态闭集只有三值。若某行带着闭集外的状态（载体不合规或规范漂移），
 * **不猜它属于哪一档、也不静默丢进分母**：该行被排除并由 `unknownStatus` 计数上报，
 * 呈现层如实说明「有 N 条未计入」。分母是一个会被读者当真的数字，少算一条也必须说出来。
 */
export type ServingSparkProgress =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'empty' }
  | { kind: 'allDiscarded'; sparkTotal: number }
  | {
    kind: 'ratio';
    sparkTotal: number;
    open: number;
    implemented: number;
    /** 分母＝open + implemented（Human 指定的「待处理+已落实」）。 */
    denominator: number;
    /** 状态在闭集外、被排除在分子分母之外的行数。 */
    unknownStatus: number;
  };

/** Spark 状态闭集（20 §9）。 */
const SPARK_STATUSES = ['open', 'implemented', 'discarded'] as const;

/**
 * 从名下工作行算出火花落实比值。
 *
 * `unreadable` 传 `serving_unreadable`：某类型读取失败时**不能**当作「没有」——
 * 那会把「读不到」显示成 0/N（00 §5.6 据实声明）。
 */
export function summarizeServingSparkProgress(
  rows: readonly Pick<ServingWorkItem, 'type' | 'status'>[],
  unreadable: readonly string[] = [],
): ServingSparkProgress {
  const sparkFailure = unreadable.find((entry) => entry.startsWith('spark'));
  if (sparkFailure) return { kind: 'unavailable', reason: sparkFailure };

  const sparks = rows.filter((row) => row.type === 'spark');
  if (sparks.length === 0) return { kind: 'empty' };

  let open = 0;
  let implemented = 0;
  let unknownStatus = 0;
  for (const spark of sparks) {
    const status = typeof spark.status === 'string' ? spark.status.trim() : '';
    // discarded 不计数：它既不进分子也不进分母。分支写成显式的一档，是为了让
    // 「闭集里确实有这一档、且我们刻意不计」在代码里可见——否则它会被并进 else
    // 与「状态在闭集外」混为一谈，而那两种情形要分别上报。
    if (status === 'open') open += 1;
    else if (status === 'implemented') implemented += 1;
    else if (status !== 'discarded') unknownStatus += 1;
  }

  // 全部已废弃：分母为 0，且这不是「还没拆解」的歧义——是「拆了、但都处置掉了」。
  // 两种都要说，但不共用一句话（它们的下一步动作完全不同）。
  if (open + implemented === 0 && unknownStatus === 0) {
    return { kind: 'allDiscarded', sparkTotal: sparks.length };
  }
  // 闭集外状态的行使分母可能为 0，却不该被读成「全部已废弃」——仍按 ratio 返回，
  // 由呈现层同时给出 unknownStatus 说明。
  if (open + implemented === 0) {
    return {
      kind: 'ratio',
      sparkTotal: sparks.length,
      open,
      implemented,
      denominator: 0,
      unknownStatus,
    };
  }

  return {
    kind: 'ratio',
    sparkTotal: sparks.length,
    open,
    implemented,
    denominator: open + implemented,
    unknownStatus,
  };
}

/** 供状态闭集断言使用：调用方不应硬编码这三值。 */
export const SERVING_SPARK_STATUSES = SPARK_STATUSES;
