import { isPocketInProgress, pocketProgress } from './pocket.calculator';

describe('pocket.calculator (requerimientos-backend.md §3.4)', () => {
  it('el progreso se trunca y es null sin meta', () => {
    expect(pocketProgress(400_000, 1_000_000)).toBe(40);
    expect(pocketProgress(999_999, 1_000_000)).toBe(99);
    expect(pocketProgress(1_200_000, 1_000_000)).toBe(120);
    expect(pocketProgress(50_000, null)).toBeNull();
  });

  it('en progreso: activo, con meta y sin cumplirla', () => {
    expect(
      isPocketInProgress({ isActive: true, balanceCents: 1, targetCents: 2 }),
    ).toBe(true);
    expect(
      isPocketInProgress({ isActive: true, balanceCents: 2, targetCents: 2 }),
    ).toBe(false);
    expect(
      isPocketInProgress({
        isActive: true,
        balanceCents: 1,
        targetCents: null,
      }),
    ).toBe(false);
    expect(
      isPocketInProgress({ isActive: false, balanceCents: 1, targetCents: 2 }),
    ).toBe(false);
  });
});
