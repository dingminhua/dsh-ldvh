import { getFieldLabel, getFieldValueLabel } from '@/i18n/locales';
import { LDVH_ERROR_TEXT_CLASS } from '@/utils/semanticColors';


const UNPARSED_NOTE_TEXT_CLASS = 'text-amber-600 dark:text-amber-300';

export interface FieldReadNotesSource {
  read_status: string;
  field_issues?: Array<{ path: string; reason: string }>;
  unparsed_structures?: Array<{ path: string; reason: string }>;
}

export default function FieldReadNotes({
  source,
  locale,
  className = 'mt-1.5',
}: {
  source: FieldReadNotesSource;
  locale: string;
  className?: string;
}) {
  const fieldIssues = source.field_issues ?? [];
  const unparsed = source.unparsed_structures ?? [];
  if (source.read_status === 'readable' && fieldIssues.length === 0 && unparsed.length === 0) return null;
  return (
    <div className={`${className} grid min-w-0 gap-1`}>
      {source.read_status !== 'readable' && (
        <p className={`ldvh-caption ${LDVH_ERROR_TEXT_CLASS}`}>
          {getFieldLabel('read_status', locale)}: {getFieldValueLabel('read_status', source.read_status, locale)}
        </p>
      )}
      {fieldIssues.map((issue, index) => (
        <p key={`field-${index}`} className={`ldvh-caption break-words ${LDVH_ERROR_TEXT_CLASS}`}>
          {issue.path}: {getFieldValueLabel('field_issue_reason', issue.reason, locale)}
        </p>
      ))}
      {unparsed.map((structure, index) => (
        <p key={`unparsed-${index}`} className={`ldvh-caption break-words ${UNPARSED_NOTE_TEXT_CLASS}`}>
          {structure.path}: {structure.reason}
        </p>
      ))}
    </div>
  );
}
