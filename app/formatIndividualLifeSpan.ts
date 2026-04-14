import type { DateInfo } from '../types';

function yearToken(y?: number | null): string {
  if (typeof y === 'number' && !Number.isNaN(y)) return String(y);
  return '?';
}

/**
 * Ligne « naissance – décès » (années) pour menus déroulants, alignée sur la liste latérale.
 */
export function formatBirthDeathLine(birth?: DateInfo | null, death?: DateInfo | null): string {
  const by = birth?.year;
  const dy = death?.year;
  const hasB = typeof by === 'number' && !Number.isNaN(by);
  const hasD = typeof dy === 'number' && !Number.isNaN(dy);
  if (!hasB && !hasD) return '';
  if (hasB && hasD) return `${yearToken(by)} - ${yearToken(dy)}`;
  if (hasB) return `${yearToken(by)} -`;
  return `- ${yearToken(dy)}`;
}
