import CopyPathButton from '@/components/CopyPathButton';
import { useI18n } from '@/i18n/context';
import { formatObjectReference } from '@/utils/objectReference';

export default function ObjectReferenceCopyButton({
  objectId,
  projectId,
  className,
  label,
  copiedLabel,
}: {
  objectId?: string;
  projectId?: string;
  className?: string;
  label?: string;
  copiedLabel?: string;
}) {
  const { t } = useI18n();
  const reference = formatObjectReference(projectId, objectId);

  return <CopyPathButton
    path={reference}
    className={className}
    label={label ?? t('common.copyObjectId')}
    copiedLabel={copiedLabel ?? t('common.copiedObjectId')}
  />;
}
