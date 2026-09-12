/**
 * Goal 详情页（/goal）——25 号单例冻结锚的完整阅读面。
 *
 * Goal 不占七类事实对象的 tab/card（25 §5 单例三免：免候选召回、免目录基数
 * 校验），详情经 /api/cognition/goal 直读路由承载（25 §10 消费点直读）。
 * 页面结构对齐 ObjectDetail 的设计语言：ObjectIdentityHeader（Target/
 * emerald 类型徽章 + active/achieved 状态）+ FactReadingContent 共享阅读
 * 布局（GoalReadingLayout：目标陈述 → 子目标 → 修订史）。
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ObjectIdentityHeader, FactReadingContent, getAuxiliaryMetaEntries } from '@/pages/ObjectDetail';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { fetchCognitionGoal, ApiRequestError, type CognitionGoalData } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getLocalizedObjectTitle, getTypeLabel } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { getFactReadMeta } from '@/utils/factReadMeta';
import { getObjectUpdatedAt } from '@/utils/factChangeLog';

type GoalRecord = NonNullable<CognitionGoalData['goal']>;

export default function GoalDetail() {
  const { t, locale } = useI18n();
  const [goal, setGoal] = useState<GoalRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGoal(null);
    setMissing(false);
    setError(null);
    fetchCognitionGoal()
      .then((data) => {
        if (cancelled) return;
        if (data.goal) setGoal(data.goal);
        else if (data.code === 'goal_missing') setMissing(true);
        else setError(data.error ?? t('common.loadFailed'));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiRequestError && caught.code === 'goal_missing') setMissing(true);
        else setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (missing) {
    // goal.md 尚未创建是合法状态（项目初始化前，25 §7 允许）——如实说明，
    // 创建走 AI 受控写入路径，Web 不提供写入口。
    return (
      <div className="ldvh-page-frame">
        <div className="mx-auto max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-8 text-center">
          <ObjectTypeIcon type="goal" size={24} className="mx-auto mb-3 text-amber-500" />
          <p className="ldvh-card-title text-amber-700 dark:text-amber-300">{t('goalDetail.missingTitle')}</p>
          <p className="ldvh-body-muted mt-2">{t('goalDetail.missingBody')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ldvh-page-frame">
        <div className="mx-auto max-w-2xl rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-8 text-center">
          <p className="ldvh-body">{t('common.loadFailed')}</p>
          <p className="ldvh-meta mt-2 break-words text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
      </div>
    );
  }

  const obj = goal as unknown as Record<string, unknown>;
  const readMeta = getFactReadMeta(obj);
  const typeColor = CATEGORY_COLORS.goal;
  // 25 §5：单例路径即身份——canonical_path 固定 ldvh-base/goal.md，复制目标即路径。
  const copyTarget = goal.canonical_path ?? 'ldvh-base/goal.md';
  const title = getLocalizedObjectTitle(
    { title: goal.title, title_en: goal.title, title_zh: goal.title },
    locale,
    'goal',
  );

  return (
    <div className="ldvh-page-frame">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 border-b border-ldvh-border bg-ldvh-bg/95 px-6 pb-4 pt-4 backdrop-blur">
        <ObjectIdentityHeader
          title={title}
          id="goal"
          target={copyTarget}
          objectType="goal"
          typeColor={typeColor}
          typeLabel={getTypeLabel('goal', locale)}
          // Human 定案 2026-09-12：goal 不显示状态徽章——active/achieved 由
          // 阅读布局与近期动态的时间线承载，头部保持单例冻结锚的克制形态。
          source={obj}
          locale={locale}
          updated={<ObjectUpdatedMeta source={obj} updatedAt={getObjectUpdatedAt(obj)} />}
          auxiliaryMetaEntries={getAuxiliaryMetaEntries(obj, 'goal')}
          customMetaEntries={[]}
          extraBadges={undefined}
          copyLabel={t('common.copyObjectId')}
          copiedLabel={t('common.copiedObjectId')}
        />
      </div>
      <FactReadingContent
        obj={obj}
        objType="goal"
        locale={locale}
        objectPath={copyTarget}
        carrier={readMeta.carrier}
      />
    </div>
  );
}
