// requerimientos-backend.md §3.4.

export const MAX_ACTIVE_POCKETS = 10;

/** Los íconos del selector de Apartados (requerimientos-backend.md §7). */
export const POCKET_ICONS = [
  'ahorro',
  'home',
  'shield',
  'travel',
  'car',
  'tech',
  'leisure',
  'education',
  'health',
  'gift',
] as const;

/** Truncado, como los presupuestos; null si no tiene meta. */
export function pocketProgress(
  balanceCents: number,
  targetCents: number | null,
): number | null {
  return targetCents === null
    ? null
    : Math.floor((balanceCents * 100) / targetCents);
}

/** "En progreso": activo, con meta y sin cumplirla. */
export function isPocketInProgress(pocket: {
  isActive: boolean;
  balanceCents: number;
  targetCents: number | null;
}): boolean {
  return (
    pocket.isActive &&
    pocket.targetCents !== null &&
    pocket.balanceCents < pocket.targetCents
  );
}
