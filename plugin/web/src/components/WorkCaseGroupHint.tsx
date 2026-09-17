import { useTheme } from '@/hooks/useTheme';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import type { WorkCaseV5Group } from '@/shared/workcaseLifecycle';
import { getStatusColor } from '@/utils/statusColors';

/**
 * WorkCase 派生分组的卡内状态提示行（列表卡 / 详情 / 收件箱共用）。
 *
 * 为什么需要它：同一张卡片上，派生分组的**徽标**经 `StatusBadge → getStatusColor`
 * 取色，而**卡内提示文字**此前各自硬编码 Tailwind 颜色类（`text-amber-*` /
 * `text-violet-*`）。两条互不相通的着色路径必然分歧——实际就出现过
 * `pending_gate1` 的徽标是紫、而它自己的提示文字是琥珀的矛盾：**同一张卡片里
 * 两种颜色说同一件事**。本组件让提示文字与徽标调用**同一个** `getStatusColor(group)`；
 * 同一函数、同一输入，配色不可能再分歧。
 *
 * 两个权威都是单一来源，本组件只消费、不重定义：
 * - 派生判据 → `shared/workcaseLifecycle.ts`（三态直读 + 四派生组）；
 * - 色值 → `utils/statusColors.ts`（`STATUS_COLORS`）。
 *
 * 10 §12.8：状态不得只由颜色承载。本组件的文字词条本身已区分两组
 * （「待批准执行」/「待批准关闭」），颜色只是加速扫读的辅助层。
 */
export default function WorkCaseGroupHint({
  group,
  messageKey,
  className = 'ldvh-caption',
}: {
  /**
   * 派生分组键——直接作为取色输入，**限定为 WorkCase 派生分组闭集**。
   *
   * 不用 `string`：拼错组名不会编译失败、不会测试失败，只会静默退化为
   * `getStatusColor` 的中性灰兜底（`statusColors.ts` 的未命中分支）——那正是
   * 「颜色悄悄失准」最不易察觉的形态（复核提示 2026-09-17）。
   */
  group: WorkCaseV5Group;
  /** 提示文案词条：各呈现面按自身语境选择用词，颜色则由 group 统一决定。 */
  messageKey: LocaleKey;
  /** 版式类（字号等）；**不含颜色**——颜色一律由 group 派生，不得在此覆盖。 */
  className?: string;
}) {
  // 与 StatusBadge 同款：主题解析值参与渲染，使色值随浅色/暗色切换更新。
  const { resolved } = useTheme();
  const { t } = useI18n();

  return (
    <p
      key={resolved}
      className={`${className} min-w-0`}
      style={{ color: getStatusColor(group) }}
    >
      {t(messageKey)}
    </p>
  );
}
