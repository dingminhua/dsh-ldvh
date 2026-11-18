export type ReportForm = 'research' | 'summary' | 'audit';

export const FORM_PALETTE: Record<ReportForm, {
  text: string;
  bg: string;
  border: string;
  activeBg: string;
  activeBorder: string;
}> = {
  research: {
    text: '#0f766e', bg: 'rgba(13,148,136,0.13)', border: 'rgba(13,148,136,0.45)',
    activeBg: 'rgba(13,148,136,0.24)', activeBorder: '#0d9488',
  },
  summary: {
    text: '#b45309', bg: 'rgba(217,119,6,0.13)', border: 'rgba(217,119,6,0.45)',
    activeBg: 'rgba(217,119,6,0.24)', activeBorder: '#d97706',
  },
  audit: {
    text: '#6d28d9', bg: 'rgba(124,58,237,0.13)', border: 'rgba(124,58,237,0.45)',
    activeBg: 'rgba(124,58,237,0.24)', activeBorder: '#7c3aed',
  },
};

export const FORM_ORDER: ReportForm[] = ['research', 'summary', 'audit'];
