import { useState } from 'react';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';
import type { ObjectItem } from '@/utils/api';
import { stripCardMarkdown } from '@/utils/cardText';
import {
  FACT_ASSOCIATION_ROWS_LIST_CLASS,
  FACT_ASSOCIATION_ROWS_ZONE_CLASS,
  FactAssociationCardRow,
  refSourceToAssociation,
} from '@/pages/ObjectList';
import {
  WORKCASE_CHECK_TAG_BASE,
  WORKCASE_COLLAPSED_RESIDUAL,
  WORKCASE_RESIDUAL_BLOCK_CLASS,
  WORKCASE_RESIDUAL_ROW_CLASS,
  WORKCASE_RESIDUAL_TAG_CLASS,
  WORKCASE_DIRECTION_BLOCK_BASE_CLASS,
  WORKCASE_DIRECTION_BLOCK_BG_CLASS,
  WORKCASE_DIRECTION_TITLE_CLASS,
  WORKCASE_DIRECTION_TITLE_ROW_CLASS,
  WORKCASE_DIRECTION_GROUP_ROW_CLASS,
  WORKCASE_DIRECTION_ROW_BULLET_CLASS,
  WORKCASE_DIRECTION_ROW_INSET_CLASS,
  workCaseAdviceTagClass,
  workCaseDirectionRows,
  groupDirectionRows,
} from '@/utils/workcaseCheckState';

/**
 * WorkCase「已关闭」卡主体（Human 2026-09-24 定，方案 A；2026-09-28 二次修订）。
 *
 * 呈现**一块**（另有一块按条件出现），均**无标题栏**（与「待批准关闭」同一形态纪律）：
 * 1. **去向**——逐条去向（去向标记 + 正文）；「转入 Spark」项**就地渲染为目标关联行**
 *    （图标 + 标题 + 目标状态，可点开面板），指向由 `relations.routed-to`。
 * 2. **取消记录**（仅 `outcome = cancelled`）——理由 + 未发生的范围（取消对象没有
 *    核对结论可报，故以本块取代）。
 *
 * **已被 Human 裁定去掉的两块**（沿革如实保留，避免后人以为"漏了"）：
 * - **结论行**（2026-09-29 去掉）：`outcome` 徽标 + `核对 N/M 达成`。其 `outcome` 现由
 *   **卡头**承载（10 §5.5「卡头的 `outcome` 徽标」，2026-09-30：放卡头、不做展开）；
 *   核对计数不再单列。
 * - **逐条核对**（2026-09-30 去掉）：原为 `[达成／未达成／未记录] plan[N].step` 四行。
 *   去掉的理由：**计划步骤名与「计划」重复、状态已由卡头 `outcome` 徽标与去向块表达**，
 *   读者无须在关闭卡上再数一遍。核对结果与证据仍完整呈现在**语义详情**（10 §5.3）——
 *   去掉的是同一批信息的**第二次呈现**，**不等于核对未发生**。
 *
 * **按决定 A 不再呈现残留**（`10 §5.5`，Human 裁定 2026-09-28）：去向不再是独立的一段，
 * 而是**长在每条残留里面**（`21 §8` 合并式）——「还剩什么」与「打算怎么办」是同一个
 * **不可分离的单元**。故只画读者需要执行的那一半，残留不再重复出现。**这不是删除信息**：
 * 残留与其去向在**载体**中仍是同一个单元，收窄只发生在**呈现**层。此前两期各画一遍
 * （残留一块 + 去向一块）使同一条信息在扫读窗口里被同一件事占两行；合并式消除了重复的
 * **根源**，A 再进一步只留去向。**结论行也随之去掉「残留 K 条」**——同一收窄的一部分。
 *
 * ⚠️ **不得声称本收窄的前提已全部满足**（`21 §15.2` 已登记该缺口，2026-09-28 独立对抗
 * 复核后更正）：A 的适用以两个前提为限，**两者强度不同**——①「该对象每条残留都带有去向
 * 子项」是**结构判据**，机械可判（本组件消费的 `closure_narrows_residual` 就是它）；
 * ②「去向正文**自足**」（离开残留也能读懂）是**语义判据**，`21 §8` 与 `§15.1` 软约束均
 * 明确归 **AI 语义审核与 Human 阅读**，**机械层不判定**，本组件也不判定。**前提② 目前
 * 零样本**：实测 17 份 closed 的 56 条去向条目**全部**带 `出自「…」` 尾注（即靠复述残留
 * 原文建立回指），新形态下的自足去向正文**从无一份实例**。故：**实现前提①不等于实现
 * A 的适用条件**；在取得自足去向正文的实例之前，**不得声称关闭后「只呈现去向」在任何
 * 现存对象上已可如实执行**（`21 §15.2` 的禁令原文）。本组件只实现结构面。
 *
 * **条件豁免（必须与上条合读，不作为「都不呈现残留」的许可）**：A 的适用以两个前提为限
 * ——① 该对象采用**合并式**形态（**每条**残留都带有去向子项）；② 去向正文满足 `21 §8` 的
 * **自足**要求。**不满足者不得套用 A**：存量分离式对象不受新形态约束（`21 §15.3`），其中
 * 实测 6 份建议段条数**少于** `result.residual` 长度（合计 22 条残留当年就没有去向），若
 * 一律按 A 隐藏残留，这些残留会从卡面**静默消失**。故判据是「该对象每条残留都带有去向
 * 子项」——满足则只画去向，不满足则**如实保留残留块**（并保持与去向块各自呈现）。
 *
 * **本判据与 `21 §15.1` 门禁③ 同源但不等价**（`10 §5.5` 明文，不得混同）：门禁③ 要求
 * 「**恰有**一个」，多于一个即拒；本判据问的是「**都带有**」，只处理有无、不处理重复。
 * 且**存量对象的可收窄性不适用 `21 §15.1` 门禁整体**——`§15.3` 存量豁免使该门禁对存量
 * 不生效，故本判据对存量只是**呈现选择**，不是门禁③的结果。
 *
 * 判据是**机械可判**的（`10 §5.5`：与 `21 §15.1` 门禁③同口径，不是语义判断），且由
 * 投影层经 `workCaseClosureNarrowsResidual` **单点算出**后以 `closure_narrows_residual`
 * 传来——**本组件不自行解析正文**：详情面读的是**同一个值**，两处判据因此必然同源
 *（`10 §5.5` 明文「判据与卡面同源…不得两处各写一套」）。
 *
 * 数据来源与边界：
 * - `plan` 由投影层补入（closed 期此前不投影 `plan`，卡上因此拿不到步骤标题——
 *   `21 §8` 的 `criteria_checks[]` 只有 `{satisfied, evidence}`，不含判据文本）；
 * - 核对状态只认 `21 §8` 登记的三词映射（达成 ⇔ `true`；未达成 ⇔ `false`；缺失 ⇒
 *   未记录），复用 `@/utils/workcaseCheckState` 的单一实现，不另造一套；
 * - **卡面按纯文本渲染**：`residual`、`achieved_scope` 与去向正文里的 Markdown 标记
 *   不解析、直接显示。写作侧纪律见 `21 §8`（去向子项同纪律）。
 */


/** 取消记录的行标记：与状态标记同族（行内、宽度自适应），取中性色。 */
const CANCEL_TAG_CLASS =
  'mr-1.5 inline-block shrink-0 rounded border border-ldvh-border bg-ldvh-bg px-1.5 text-[10px] font-semibold leading-4 text-ldvh-text-secondary';

/**
 * One source in the read-time reverse `refs` projection.  This row deliberately
 * uses neutral association language: a source declaring a reference is not
 * evidence that the closed WorkCase advice was carried out.
 */
export interface WorkCaseClosedSummaryProps {
  obj: ObjectItem;
  className?: string;
}

export default function WorkCaseClosedSummary({ obj, className = '' }: WorkCaseClosedSummaryProps) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const residual = Array.isArray(obj.result?.residual) ? obj.result.residual : [];
  const cancellation = obj.cancellation ?? null;
  // 去向（`21 §8` 残留段的**去向子项**）：与「待批准关闭」期**同一处承载**（正文，关闭
  // 不删正文）。语义是「提请时如实说明的打算」，**不因关闭而被批准**（§10.2，Human
  // 2026-09-24）——故此处用中性表述呈现，不写「后续去向」一类暗示已批准的措辞。
  const advice = workCaseDirectionRows(obj.advice);
  // 事后补记声明（`21 §8`）：让卡面读者知道这段去向不是关闭当时的提请内容。
  const adviceNote = typeof obj.advice_note === 'string' ? obj.advice_note : null;
  const refSources = Array.isArray(obj.factRefSources) ? obj.factRefSources : [];
  // `routed-to` 的目标关联行（`10 §5.5`「已关闭」卡表：去向项中「转入 Spark」项**就地
  // 渲染为目标关联行**——图标 + 标题 + 目标状态，可点开面板）。指向的唯一承载是
  // `relations.routed-to`（`21 §12`：对象标识问题，不靠散文回指）。
  //
  // 顺序依据是**写法约定、非机械可核验事实**（`§15.1` 明文）：去向子项不携带目标标识，
  // 机械层只能数出「各有几条」。故此处按序**陈列**候选配对，不得把它表述为
  // 「已验证的对应关系」（`§13` 对呈现层的同款禁令）。
  const routedTo = Array.isArray(obj.factAssociations)
    ? obj.factAssociations.filter((association) => association.relationKey === 'routed-to')
    : [];

  // 决定 A 的**条件豁免**（`10 §5.5` / `21 §15.3`）：判据由投影层单点算出，与详情面
  // 同源。**只在为 `true` 时**收窄——`false` 时如实保留残留块，否则存量那 22 条当年
  // 就没有去向的残留会从卡面静默消失（`§15.3` 明文禁止该后果）。
  //
  // 判据缺失（`undefined`）时**按不收窄处理**（fail closed）：未知不等于满足前提。
  const narrowsResidual = obj.closure_narrows_residual === true;

  if (
    cancellation === null &&
    residual.length === 0 &&
    advice.length === 0 &&
    refSources.length === 0
  ) {
    return null;
  }

  const hidden = Math.max(0, residual.length - WORKCASE_COLLAPSED_RESIDUAL);
  const visibleResidual = expanded ? residual : residual.slice(0, WORKCASE_COLLAPSED_RESIDUAL);

  return (
    <div className={`${className} grid min-w-0 gap-1.5`.trim()}>
      {/* ①（原「结论行」块已于 2026-09-30 删除）
          `outcome` 现由**卡头**承载（10 §5.5「卡头的 `outcome` 徽标」，Human 裁定
          2026-09-30：放卡头、不做展开）；核对计数不单列（逐条核对块已逐步给出状态）。
          本组件因此只余两块：逐条核对 → 去向（+ cancelled 的取消记录块）。 */}

      {/* ②' 取消记录（21 §8，仅 cancelled）：理由 + 未发生的范围。
          取代逐条核对块——取消对象没有核对结论可报。用中性灰，与 outcome 徽标同色系，
          不与「核对」的绿/琥珀/红抢语义。 */}
      {cancellation !== null && (
        <div className="min-w-0 rounded-md border border-ldvh-border bg-ldvh-bg/60 px-2.5 py-2">
          {cancellation.reason && (
            <div className="py-1 first:pt-0.5 ldvh-caption text-ldvh-text-primary">
              <span className={CANCEL_TAG_CLASS}>{t('objectList.workcaseCancelReason')}</span>
              <span>{cancellation.reason}</span>
            </div>
          )}
          {cancellation.unstartedScope && (
            <div className="border-t border-ldvh-border/60 py-1 ldvh-caption text-ldvh-text-primary">
              <span className={CANCEL_TAG_CLASS}>{t('objectList.workcaseCancelUnstarted')}</span>
              <span>{cancellation.unstartedScope}</span>
            </div>
          )}
        </div>
      )}

      {/* ②（原「逐条核对」块已于 2026-09-30 删除）
          该块原为 `[达成／未达成／未记录] plan[N].step` 四行；Human 裁定去掉整块：
          计划步骤名与「计划」重复、状态由**卡头 outcome 徽标**与**去向块**表达，读者
          无须在关闭卡上再数一遍。核对结果与证据仍完整呈现在**语义详情**（10 §5.3）；
          去掉的是同一批信息的**第二次呈现**，不等于核对未发生。 */}

      {/* ② 残留——**条件豁免成立时保留**（`10 §5.5`「条件豁免」/`21 §15.3`）。
          决定 A 规定关闭后只呈现去向，但 A 以「该对象每条残留都带有去向子项」为前提；
          存量分离式对象不满足该前提（实测 6 份的建议段条数少于 residual 长度、合计
          22 条残留当年就没有去向，且补写即属编造），若一律隐藏，那些残留会从卡面
          **静默消失**。故此处只在 `narrowsResidual === false` 时渲染本块。
          Human 2026-09-24 裁定排在去向之上：残留是「还剩什么」、去向是「打算怎么办」；
          先陈述事实、再给去向。 */}
      {!narrowsResidual && residual.length > 0 && (
        <div className={WORKCASE_RESIDUAL_BLOCK_CLASS}>
          {visibleResidual.map((item, index) => (
            <div
              key={index}
              className={WORKCASE_RESIDUAL_ROW_CLASS}
            >
              {/* 与核对、去向一致的「[标记] 正文」行结构（Human 裁定逐条加标记） */}
              <span className={`${WORKCASE_CHECK_TAG_BASE} ${WORKCASE_RESIDUAL_TAG_CLASS}`}>
                {t('objectList.workcaseResidualTag')}
              </span>
              <span>{stripCardMarkdown(typeof item === 'string' ? item : String(item))}</span>
            </div>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="ldvh-meta-muted mt-1 block cursor-pointer text-left hover:text-ldvh-text-primary"
            >
              {expanded
                ? t('objectList.workcaseFlowCollapse')
                : t('objectList.workcaseFlowMore', { count: String(hidden) })}
            </button>
          )}
        </div>
      )}

      {/* ②'' 去向（`21 §8` 残留段的去向子项）：与「待批准关闭」期同一处承载。
          名称用中性「去向」——§10.2 明写批准对象只有「关闭」与 outcome，
          去向不因关闭而成为承诺，故不得写成「后续去向」一类暗示已批准的措辞。

          `10 §5.5`：已关闭期因残留一侧不再呈现，去向条**提升为平级行**
          （`21 §8` 要求其正文自足，正是为该期可独立阅读）——故此处用平级行样式，
          不用开放期的缩进从属行样式。

          **2026-09-30 起按去向词分区**（Human：「接受现状提出来变成一个 title，
          下面不再重复」+「接受现状和转入 Spark 要 2 个区域」）：去向词从**逐条重复
          的行内标记**提为**分区标题**，每个去向词一个**独立块**，组内条目只留正文。
          同一对象有 5 条「接受现状」时，词从屏上出现 5 次降为 1 次。

          **信息未增未减**：条目数、条目顺序、条目正文与逐条呈现时逐字相同——
          去掉的只是重复的词，这是纯粹的**去重与分区**（`21 §15.1` 呈现层不替作者
          修正形态：不合并、不排序、不丢弃判不出词的条目）。 */}
      {advice.length > 0 && (
        <div className="grid min-w-0 gap-1.5">
          {adviceNote && (
            <div className="ldvh-meta-muted px-0.5">{stripCardMarkdown(adviceNote)}</div>
          )}
          {groupDirectionRows(advice).map((group) => {
            // 「转入 Spark」的分区标题下**就地渲染为目标关联行**（`10 §5.5` 已关闭卡表）。
            //
            // **按序配对**：第 k 条「转入 Spark」陈列第 k 条 `routed-to`。该顺序是
            // **写法约定、非机械可核验事实**（`§15.1` 明文：去向子项不携带目标标识，
            // 机械层只能数出「各有几条」），故这里只作**候选配对**呈现——不得表述为
            // 「已验证的对应关系」（`§13` 对呈现层的同款禁令）。
            //
            // 为什么是「第 k 条」而不是「每条都列出全部目标」：后者会让同一个目标在
            // 卡片上重复出现 N 次（N = 转入条数），与 `§13`「每条建议 ↔ 一条关系」
            // 的陈列口径不符，也会把「有几条去向」这一信息淹没。
            //
            // 计数不一致时（`§15.1` 门禁④已拒绝该形态，故正常不可达）**不多画**：
            // 只画能配上的那几条，缺失即缺失——不猜、也不复制最后一条。
            const isSpark = group.kind === '转入 Spark';
            return (
              <div
                key={group.kind ?? 'unclassified'}
                data-workcase-advice-group={group.kind ?? 'unclassified'}
                className={`${WORKCASE_DIRECTION_BLOCK_BASE_CLASS} ${
                  WORKCASE_DIRECTION_BLOCK_BG_CLASS[group.kind ?? ''] ?? ''
                }`.trim()}
              >
                <div className={WORKCASE_DIRECTION_TITLE_ROW_CLASS}>
                  <span
                    className={`${WORKCASE_DIRECTION_TITLE_CLASS} ${workCaseAdviceTagClass(group.kind)}`}
                  >
                    {group.kind
                      ? t(`objectList.workcaseAdvice.${group.kind}` as LocaleKey)
                      : t('objectList.workcaseAdvice.unclassified')}
                  </span>
                </div>
                {group.rows.map((item, index) => {
                  const target = isSpark ? routedTo[index] : undefined;
                  return (
                    <div
                      key={`${item.kind ?? 'other'}-${index}`}
                      data-workcase-advice-kind={item.kind ?? 'unclassified'}
                      className={`${WORKCASE_DIRECTION_ROW_INSET_CLASS} ${WORKCASE_DIRECTION_GROUP_ROW_CLASS}`}
                    >
                      {/* 项目符号：去向词提到块首后，组内各条只剩正文，行首若无符号会
                          彼此糊成一段（原来行首的标记顺带起了分隔作用）。用与标记同族的
                          小圆点，纯装饰、不承载语义，故 aria-hidden。
                          绝对定位摆放（不是 flex 流内元素）：间距与垂直位置各由一处决定，
                          不出现「gap 与 margin 叠加」「符号偏高」两个已实测的偏差——取值
                          依据见 `WORKCASE_DIRECTION_ROW_BULLET_CLASS` 的登记。 */}
                      <span aria-hidden="true" className={WORKCASE_DIRECTION_ROW_BULLET_CLASS} />
                      <span>{stripCardMarkdown(item.text)}</span>
                      {target && (
                        <div className="mt-0.5 grid min-w-0 gap-0.5">
                          {/* 行式由**统一关联行**给出（10 §5.5：同类信息只有一处行式）——
                              此前本组件自建 WorkCaseRoutedToRow（图标 12px、无类型色、状态写成
                              文字），与统一行（图标 13px、类型色、行末状态图标）不一致。 */}
                          <FactAssociationCardRow
                            association={target}
                            locale={locale}
                            unavailableLabel={t('objectList.workcaseRoutedToUnavailable')}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ③ 反向普通引用：只呈现「哪些可读事实对象声明引用了本 WC」。
          这是实时反查得到的可见性线索，不是建议履行、语义覆盖或关闭证明。
          不与上面的 outgoing factRefs / formal relations 合并。

          **无标题、无块边框（Human 2026-09-30：「那就不要标题，学习 spark 的做法」）**：
          区域形态与 Spark 卡的引用区**同一处来源**（`FACT_ASSOCIATION_ROWS_ZONE_CLASS`／
          `FACT_ASSOCIATION_ROWS_LIST_CLASS`，在 `ObjectList.tsx` 单点给出）——顶部分割线
          + 行间分割线，没有标题、没有块边框、没有底色。

          为什么去掉标题：行本身**自描述**（类型图标说出对象类型、行末状态图标说出状态），
          旧标题「声明引用此工单的对象」是一句规范腔长句，不增加行所没有的信息，却制造
          命名难题——任何概括词要么太长、要么冒领方向语义（如误写成「转入 Spark」会宣称
          本单残留已转入该 Spark，而它的承载是**本单的** `relations.routed-to`；反向引用
          是**别人**的 `refs`，方向相反，见 `10 §5.5` 与 `api/services/facts.ts` 的登记）。
          无标题即无冒领面。 */}
      {refSources.length > 0 && (
        <section data-workcase-ref-sources className={FACT_ASSOCIATION_ROWS_ZONE_CLASS}>
          <div className={FACT_ASSOCIATION_ROWS_LIST_CLASS}>
            {refSources.map((source) => (
              // 行式由**统一关联行**给出（Human 2026-09-30：「学习 spark 的引用方案」）——
              // 此前本组件自建一套行式，与 Spark/关联块不一致。此处只做形状适配。
              <FactAssociationCardRow
                key={source.objectUid}
                association={refSourceToAssociation(source)}
                locale={locale}
                unavailableLabel={t('objectList.workcaseRefSourceUnavailable')}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
