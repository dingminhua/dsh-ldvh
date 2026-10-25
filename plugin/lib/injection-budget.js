// 注入上下文总预算的**协调层**（2026-10-25，Human 决定）。
//
// ## 为什么需要这一层
//
// 此前两块注入面各有一个写死的魔法数字，且**互不知情**：
//   · 引导面（system-prompt/assemble）：`GUIDANCE_CHAR_BUDGET.governed = 1500`（**字符**）
//   · 召回面（agent/pre-step）：`RECALL_BYTE_BUDGET = 2400`（**字节**）
//
// 三个后果（实测 2026-10-25）：
//   1. **单位不同，无法同盘判断**：中文一字≈3 字节，1500 字符 ≈ 4500 字节上限，
//      而召回面 2400 字节上限——两块根本不在一个尺度上。
//   2. **一紧一松**：引导面实际只用 2675 字节（上限约 4500，宽裕），召回面在
//      2400 下常态裁掉 1–2 条候选（紧张）。同一回合里，一块浪费、一块不够。
//   3. **Human 无法调**：两个数字都在代码里，改任何一个都要发版。
//
// ## 协调规则
//
// 总预算按**档位**给出（`INJECTION_BUDGET_TIERS`，10/20/30/40/50 K 字节，见
// `source-recall.js`）。分配顺序体现优先级：
//   1. **引导面先取它实际需要的量**（不是它的上限）——引导面内容是固定的 00 七锚点，
//      实际用量稳定，且它是身份/规则入口，缺了整段引导就断（10 §10.1 第 3 项把
//      「引导体量超预算」列为必停情形，可见其刚性）。
//   2. **召回面取剩余**，但不少于其原有下限（`RECALL_BYTE_BUDGET`）——即档位
//      只会让召回面**变大**，不会因引导面占用而变小（避免"调了档位反而更糟"）。
//   3. 若总预算连引导面都装不下 → 如实报错，不静默裁剪（10 §9.1）。
//
// ## 规范依据
//   · `10 §5.3`：注入内容由 01 定义、注入形式与预算由 10 定义；体量以固定常量承载，
//     变更走受控提交；
//   · `10 §9.1` 第 2 项：改变引导面注入形式或预算边界须 Human 决定（本层即经此决定引入）；
//   · `34 §15.1` 第 5 项：是否提高召回的字节预算常量须 Human 决定（档位集合即常量）；
//   · `02 §9.1`：超预算必须分页、继续缩小或返回 partial，不得静默截断。
//
// ## 不做什么
//   · 不引入运行期任意数值：只能选已登记档位（可核对性）；
//   · 不改变任一注入面的**内容**：只决定各自可用的字节额度；
//   · 不建持久状态：每次注入现算（`34 §17` 第 1 项、`02 §16` 红线第 3 项）。

import { GUIDANCE_CHAR_BUDGET } from "./guidance-budget.js";
import { RECALL_BYTE_BUDGET } from "./recall-injection.js";

/** 字符→字节的保守估计系数（UTF-8 中文一字 3 字节；ASCII 一字 1 字节）。 */
const CHARS_TO_BYTES_CEILING = 3;

/**
 * 把引导面的**字符**预算折算成字节（保守上限）。
 *
 * 引导面按字符计量（`GUIDANCE_CHAR_BUDGET`），而档位按字节。折算用 3 倍系数
 * 取**上限**：宁可给引导面多留，也不能让它因折算不足而触发必停。
 *
 * @param {string} state - 管辖状态（governed / unavailable / not_governed）。
 * @returns {number} 字节上限。
 */
export function guidanceByteCeiling(state) {
  const chars = GUIDANCE_CHAR_BUDGET[state] ?? GUIDANCE_CHAR_BUDGET.not_governed;
  return chars * CHARS_TO_BYTES_CEILING;
}

/**
 * 在总预算内为两块注入面分配额度。
 *
 * @param {number} totalBytes - 档位给出的总字节预算。
 * @param {string} state - 管辖状态。
 * @returns {{ok: true, totalBytes: number, guidanceBytes: number, recallBytes: number, note: string}
 *          | {ok: false, reason: string, totalBytes: number, guidanceBytes: number, recallBytes: number}}
 */
export function allocateInjectionBudget(totalBytes, state) {
  const guidanceCeiling = guidanceByteCeiling(state);
  if (totalBytes < guidanceCeiling) {
    // 连引导面都装不下：如实拒绝（10 §9.1 第 2 项 / 02 §9.1 不得静默截断）。
    // 引导面不可裁——它是身份与规则入口（10 §10.1 第 3 项）。
    return {
      ok: false,
      reason:
        `注入总预算 ${totalBytes} 字节不足以容纳引导面上限 ${guidanceCeiling} 字节（${state}）；` +
        `请提高预算档位（属 Human 决定事项）`,
      totalBytes,
      guidanceBytes: guidanceCeiling,
      recallBytes: 0,
    };
  }
  // 引导面先取它**上限**所需的量（不是实际用量——实际用量要到渲染时才知道，
  // 这里做的是分配，不是计量）。
  const guidanceBytes = guidanceCeiling;
  // 召回面取剩余，但**不少于原有下限**：档位只应让它变大，不应因引导面占用而变小。
  // 若剩余不足，则总预算实际由「引导上限 + 召回下限」决定——如实说明，不硬裁。
  const remaining = totalBytes - guidanceBytes;
  const recallBytes = Math.max(remaining, RECALL_BYTE_BUDGET);
  const oversubscribed = guidanceBytes + recallBytes > totalBytes;
  return {
    ok: true,
    totalBytes,
    guidanceBytes,
    recallBytes,
    note: oversubscribed
      ? `总预算 ${totalBytes} 字节小于「引导上限 ${guidanceBytes} + 召回下限 ${RECALL_BYTE_BUDGET}」，` +
        `实际按 ${guidanceBytes + recallBytes} 字节执行（召回面不因引导面占用而低于原下限）`
      : `引导 ${guidanceBytes} + 召回 ${recallBytes} = ${guidanceBytes + recallBytes} ≤ 总预算 ${totalBytes}`,
  };
}
