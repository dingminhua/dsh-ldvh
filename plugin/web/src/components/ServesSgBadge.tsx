import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { getFieldLabel } from '@/i18n/locales';
import {
  normalizeServesList,
  useSubGoalIndex,
  type SubGoalIndex,
} from '@/hooks/useSubGoals';

/** 子目标 chip 的显示文本。
 *
 * `serves` 存的是 `object_uid`（28 §12.3，2026-11-01 废止 SG-n）。直接把 uid
 * 渲染成 chip 会让读者看到 `befe1735-1187-4d60-…`——那是身份，不是标签。
 *
 * **卡头 chip 显示 `order` 而不是标题**：chip 在卡头与状态徽标、修改次数抢同
 * 一行，而标题最长 40 字（28 §8）。实测把完整标题塞进 chip 会挤掉「待处理」，
 * 整行换行错位。`order` 正是为显示而设的字段（§8「显示次序」）——它接手了
 * 原 SG-n 在卡头的位置，语义也一致：这是第几条子目标。完整标题留在 `title`。
 *
 * `order` 缺失是合法状态（§8：可缺失），此时才回落截断的标题；两者都没有就
 * 回落 uid——显示空白会让一条真实引用看起来像坏了。
 */
function chipText(
  uid: string,
  index: SubGoalIndex,
): { text: string; title: string; resolved: boolean } {
  const ref = index.get(uid);
  if (!ref) return { text: uid, title: uid, resolved: false };
  if (typeof ref.order === 'number') return { text: String(ref.order), title: ref.title || uid, resolved: true };
  if (ref.title) return { text: ref.title, title: ref.title, resolved: true };
  return { text: uid, title: uid, resolved: false };
}

/** 子目标 chip：紧跟事实对象类型标签的 chip（卡片与详情头共用呈现）。
 *
 * 2026-11-01：从「显示 `serves` 原始值」改为「解析成子目标标题」。解析表来自
 * `/api/cognition/goal` 的 `sub_goals` 投影（本身由 `subgoals/*.md` 反查派生，
 * 不是第二权威）。已有子目标对象时 chip 可点下钻（28 §12.3 的派生反查入口）；
 * 解析不到就退化为不可点的纯文本 chip。
 *
 * **靶心图标为什么是 `size={11}` 而不是与邻居相同的 `12`**（Human 2026-10-05 指出
 * 「SG-3 的图标比别的大」后实测定案）：
 *
 * chip 内图标的**声明尺寸**原本全站统一为 `size={12}`，但 lucide 各图标的图形在
 * 24×24 viewBox 内的占比不同——`Target`（靶心，同心圆环）的 `getBBox()` 是 20×20，
 * `History`（活动数 chip 的时钟）是 18×18。于是同一 12px 框里：
 *   靶心墨迹 = 20/24 × 12 = **10.0px**，时钟 = 18/24 × 12 = **9.0px** —— 差 11%；
 * 且靶心是三层圆环（描边密集），视觉重量进一步放大，肉眼能一眼看出「它比较大」。
 *
 * 对齐到时钟的 9.0px 需 `9 × 24 / 20 = 10.8`；取整数 11 时墨迹 9.17px，与 9.0px
 * 差 1.9%（不可辨），故取 11。
 *
 * **单点登记**：全站 chip 内只有这两种图标（普查：`Target` 74 处、`History` 80 处），
 * 故只此处需补偿。将来若在 chip 内新增图标，须同样按**墨迹**（`getBBox()/24 × size`）
 * 而非声明尺寸对齐，否则会再现本处「声明一致而观感不一致」的形态。 */
export default function ServesSgBadge({ value, locale }: { value: unknown; locale: string }) {
  const subGoalIndex = useSubGoalIndex();
  const values = normalizeServesList(value);
  if (values.length === 0) return null;
  const label = getFieldLabel('serves', locale);

  return (
    <>
      {values.map((uid) => {
        const { text, title, resolved } = chipText(uid, subGoalIndex);
        const chipClass = 'ldvh-chip-sm gap-1 border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400';
        // 回落成标题时（`order` 缺失）才需要截断：标题最长 40 字（28 §8）。
        // 显示 `order` 时是纯数字，不占行宽——这正是 chip 留在卡头的前提。
        const body = (
          <>
            <Target size={11} aria-hidden="true" />
            <span className={text === uid || /^\d+$/.test(text) ? undefined : 'max-w-[9rem] truncate'}>{text}</span>
          </>
        );
        if (!resolved) {
          return (
            <span
              key={uid}
              className={chipClass}
              title={`${label} · ${uid}`}
            >
              {body}
            </span>
          );
        }
        return (
          <Link
            key={uid}
            to={`/objects/subgoal/subgoal-${uid}`}
            className={`${chipClass} hover:underline`}
            title={`${label} · ${title}`}
            onClick={(event) => event.stopPropagation()}
          >
            {body}
          </Link>
        );
      })}
    </>
  );
}
