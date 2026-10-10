import { Eye } from 'lucide-react';
import { useI18n } from '@/i18n/context';

/**
 * 26 §8 `occurrence.count`（重复观察次数）的卡头标签：类型 → 优先级 → SG →
 * **影响** → **重复观察** → 修改次数 序列中的一枚裸 chip（无字段名前缀）。
 *
 * ## 它为什么必须存在（消费方缺失的补足）
 *
 * §8 把 `occurrence` 定为**频次的机械权威源**，并明写「正文现象段的频次叙述是
 * 人类可读投影，**二者不一致时以本字段为准**」；§9.2 的两条关键流转都读它：
 * `observing → open` 的机械阈值（`count ≥ 3` 且 `human_return_at` 为空）与
 * `open → observing` 的回退护栏（`human_return_at`）。即：**它是机械通道唯一的
 * 自主流转判据**。
 *
 * 但在本组件出现之前，全前端没有任何一处渲染它——词条在（`TYPE_FIELD_LABEL_LOCALES`
 * 早已登记 `occurrence: { zh: '重复观察' }`）、契约在（`factFieldContract.ts` 登记为
 * object 字段）、数据也在（`FACT_LIST_FIELD_NAMES.friction` 含 `occurrence`，列表投影
 * 实际携带），**唯独没有消费方**。结果是 Human 在界面上读不到那个权威值。
 *
 * ## 为什么必须与「修改次数」分开呈现（不得合并）
 *
 * 卡头已有一枚 `History` 图标 chip，承载 `change_log.length`——那是**写入次数**
 * （改过几次）。它与本 chip 的 `occurrence.count`（**被观察到几次**）是**不同的量**：
 * 一条 open 账目可以只被观察 1 次却改过 7 次，也可以被观察 3 次却只改过 1 次。
 * 若二者混同，Human 会把「改过几次」读成「出现过几次」，而后者才是阈值判据。
 * 故本 chip 用**不同图标**（`Eye`）与**不同提示文案**明确区分，不复用 `History`。
 *
 * ## 呈现纪律（与 FrictionImpactBadge 同规格）
 *
 * 同一字段在三处出现（列表卡卡头 / 聚焦页 / 详情页身份头部），三处都必须**同形**：
 * 同位置、同尺寸（`ldvh-chip-sm` + 12px 图标）、同色相（`LDVH_ACCENT_CHIP_*`）。
 * 本组件是该字段呈现的**单一来源**：任何一处需要呈现 occurrence，都用它。
 *
 * ## 边界
 *
 * - `count` 非正整数即**不渲染**——闭集外的取值渲染成空 chip 会在界面上给出一个
 *   没有语义的色块（同 impact badge 对闭集外取值的处置）。
 * - §8 允许 `voided`（且来源为闭集收缩改判）缺 `occurrence`——此时不渲染，如实
 *   反映「该账目无观察证据可载」，不补零、不占位。
 * - 本 chip 只呈现**事实值**，不呈现阈值进度（不显示 `1/3`）。阈值 N=3 由 04 §8.4
 *   固定，把它印在卡面上会让「N 是多少」看起来是可变的呈现选择；且 N 的权威源是
 *   规范而非界面。
 */
export default function FrictionOccurrenceBadge({ value }: { value: unknown }) {
  const { t } = useI18n();
  if (typeof value !== 'object' || value === null) return null;
  const count = (value as { count?: unknown }).count;
  // 只接受正整数：§8 定义 count 为 `integer ≥ 1`。
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;

  return (
    <span
      className="ldvh-chip-sm shrink-0 gap-1 border-sky-400/35 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      title={t('cognition.recent.occurrenceCount', { count: String(count) })}
    >
      <Eye size={12} aria-hidden="true" />
      <span>{count}</span>
    </span>
  );
}
