import { useMemo } from 'react';
import { useI18n } from '@/i18n/context';
import { getFieldValueLabel } from '@/i18n/locales';
import { FORM_PALETTE, FORM_ORDER, type ReportForm } from '@/utils/reportFormPalette';


interface ReportFormFilterProps {
  activeForm: ReportForm | null;
  onChange: (form: ReportForm | null) => void;
  options?: Array<{ status: string; count: number }>;
  total?: number;
  loading?: boolean;
  className?: string;
}

function getButtonClass(active: boolean): string {
  return `ldvh-tab-button ${active ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`;
}

export default function ReportFormFilter({
  activeForm,
  onChange,
  options = [],
  total = 0,
  loading = false,
  className = '',
}: ReportFormFilterProps) {
  const { t, locale } = useI18n();

  const forms = useMemo(() => {
    const countOf = new Map(options.map((option) => [option.status, option.count]));
    return FORM_ORDER.map((form) => ({ form, count: countOf.get(form) ?? 0 }));
  }, [options]);

  return (
    <div className={`ldvh-tab-list ${className}`} aria-label={t('objectList.formFilter')}>
      { }
      {forms.map(({ form, count }) => (
        <button
          key={form}
          type="button"
          onClick={() => onChange(form)}
          style={{
            color: FORM_PALETTE[form].text,
            backgroundColor: activeForm === form ? FORM_PALETTE[form].activeBg : FORM_PALETTE[form].bg,
            borderColor: activeForm === form ? FORM_PALETTE[form].activeBorder : FORM_PALETTE[form].border,
          }}
          className={getButtonClass(activeForm === form)}
        >
          {getFieldValueLabel('report_form', form, locale)}
          <span className="ldvh-tab-count">{loading ? '·' : count}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={getButtonClass(activeForm === null)}
      >
        {t('objectList.all')}
        <span className="ldvh-tab-count">{loading ? '·' : total}</span>
      </button>
    </div>
  );
}
