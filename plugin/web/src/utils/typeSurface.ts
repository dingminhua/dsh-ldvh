import type { CSSProperties } from 'react';
import { getCategoryColor } from './categoryColors.ts';


export const TYPE_SURFACE_BORDER_MIX = 30;
export const TYPE_SURFACE_BACKGROUND_MIX = 5;
export const TYPE_SURFACE_TEXT_MIX = 58;

function typeColorOf(type: string): string {
  return getCategoryColor(type);
}

export function getTypeSurfaceTint(type: string): { surface: CSSProperties; body: CSSProperties } {
  const color = typeColorOf(type);
  return {
    surface: {
      borderColor: `color-mix(in oklab, ${color} ${TYPE_SURFACE_BORDER_MIX}%, transparent)`,
      backgroundColor: `color-mix(in oklab, ${color} ${TYPE_SURFACE_BACKGROUND_MIX}%, transparent)`,
    },
    body: {
      color: `color-mix(in oklab, ${color} ${TYPE_SURFACE_TEXT_MIX}%, rgb(var(--ldvh-text-primary)))`,
    },
  };
}
