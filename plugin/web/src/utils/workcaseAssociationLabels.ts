import type { LocaleKey } from '../i18n/locales';
import type { WorkCaseAssociationGroup } from './workcaseAssociationGroups';

type Translate = (key: LocaleKey, params?: Record<string, string>) => string;

/** Format only the meanings actually supplied by the grouped projections. */
export function workCaseAssociationLabels(group: WorkCaseAssociationGroup, t: Translate): Array<{ text: string; title?: string }> {
  const labels = group.meanings.map((meaning) => {
    if (meaning.kind === 'relation') {
      if (meaning.relationKey === 'routed-to' && group.inlineIndex !== null) {
        return { text: t('objectList.workcaseAssociation.routedTo'), title: t('objectList.workcaseAssociation.routedToCandidate') };
      }
      return { text: meaning.relationKey
        ? t('objectList.workcaseAssociation.relation', { key: meaning.relationKey })
        : t('objectList.workcaseAssociation.relationUnknown') };
    }
    return { text: t(meaning.kind === 'outgoing-ref'
      ? 'objectList.workcaseAssociation.outgoing'
      : 'objectList.workcaseAssociation.incoming') };
  });
  if (group.identityConflict) labels.push({ text: t('objectList.workcaseAssociation.identityConflict') });
  return labels;
}
