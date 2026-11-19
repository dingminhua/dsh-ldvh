export type ReportForm = 'research' | 'summary' | 'audit' | 'action' | 'reference';

type FormColorToken = 'emerald' | 'amber' | 'violet' | 'rose' | 'sky';

export interface FormPaletteEntry {
  text: string;
  bg: string;
  border: string;
  activeBg: string;
  activeBorder: string;
}

const TEXT_MIX = 100;
const BG_MIX = 13;
const BORDER_MIX = 45;
const ACTIVE_BG_MIX = 24;

function paletteOf(token: FormColorToken): FormPaletteEntry {
  const color = `var(--ldvh-pj-${token})`;
  return {
    text: color,
    bg: `color-mix(in oklab, ${color} ${BG_MIX}%, transparent)`,
    border: `color-mix(in oklab, ${color} ${BORDER_MIX}%, transparent)`,
    activeBg: `color-mix(in oklab, ${color} ${ACTIVE_BG_MIX}%, transparent)`,
    activeBorder: color,
  };
}

export const FORM_PALETTE: Record<ReportForm, FormPaletteEntry> = {
  research: paletteOf('emerald'),
  summary: paletteOf('amber'),
  audit: paletteOf('violet'),
  action: paletteOf('rose'),
  reference: paletteOf('sky'),
};

export const FORM_ORDER: ReportForm[] = ['research', 'summary', 'audit', 'action', 'reference'];
