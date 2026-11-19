import { useEffect, useState } from 'react';
import { ObjectIdentityHeader, FactReadingContent, getAuxiliaryMetaEntries } from '@/pages/ObjectDetail';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { fetchCognitionGoal, ApiRequestError, type CognitionGoalData } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getLocalizedObjectTitle, getTypeLabel } from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { getFactReadMeta } from '@/utils/factReadMeta';
import { getObjectUpdatedAt } from '@/utils/factChangeLog';
import { LDVH_ERROR_SURFACE_CLASS, LDVH_ERROR_TEXT_CLASS, LDVH_WARN_SURFACE_STRONG_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';

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
    return (
      <div className="ldvh-page-frame">
        <div className={`mx-auto max-w-2xl rounded-lg border ${LDVH_WARN_SURFACE_STRONG_CLASS} px-5 py-8 text-center`}>
          <ObjectTypeIcon type="goal" size={24} className="mx-auto mb-3 text-amber-500" />
          <p className={`ldvh-card-title ${LDVH_WARN_TITLE_CLASS}`}>{t('goalDetail.missingTitle')}</p>
          <p className="ldvh-body-muted mt-2">{t('goalDetail.missingBody')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ldvh-page-frame">
        <div className={`mx-auto max-w-2xl rounded-lg border ${LDVH_ERROR_SURFACE_CLASS} px-5 py-8 text-center`}>
          <p className="ldvh-body">{t('common.loadFailed')}</p>
          <p className={`ldvh-meta mt-2 break-words ${LDVH_ERROR_TEXT_CLASS}`}>{error}</p>
        </div>
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="ldvh-spinner" />
      </div>
    );
  }

  const obj = goal as unknown as Record<string, unknown>;
  const readMeta = getFactReadMeta(obj);
  const typeColor = CATEGORY_COLORS.goal;
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
