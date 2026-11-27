import {
  availableCreditCents,
  looksLikeCardNumber,
  nextDateOfDay,
  paymentToAvoidInterestCents,
  previousDateOfDay,
} from './card.calculator';

describe('card.calculator (requerimientos-backend.md §3.5)', () => {
  it('el siguiente corte cuenta hoy y pasa al mes siguiente si ya pasó', () => {
    expect(nextDateOfDay('2026-10-24', 12)).toBe('2026-11-12');
    expect(nextDateOfDay('2026-10-12', 12)).toBe('2026-10-12');
    expect(nextDateOfDay('2026-10-01', 12)).toBe('2026-10-12');
    expect(nextDateOfDay('2026-12-20', 2)).toBe('2027-01-02');
  });

  it('en meses más cortos usa el último día', () => {
    expect(nextDateOfDay('2026-02-10', 31)).toBe('2026-02-28');
    expect(nextDateOfDay('2026-02-28', 31)).toBe('2026-02-28');
    expect(nextDateOfDay('2026-04-30', 31)).toBe('2026-04-30');
    expect(nextDateOfDay('2026-01-31', 30)).toBe('2026-02-28');
  });

  it('el último corte es anterior a hoy, sin contar hoy', () => {
    expect(previousDateOfDay('2026-10-24', 12)).toBe('2026-10-12');
    expect(previousDateOfDay('2026-10-12', 12)).toBe('2026-09-12');
    expect(previousDateOfDay('2026-03-15', 31)).toBe('2026-02-28');
    expect(previousDateOfDay('2027-01-05', 20)).toBe('2026-12-20');
  });

  it('el pago para no generar intereses resta lo pagado desde el corte y no baja de 0', () => {
    expect(paymentToAvoidInterestCents(165_000, 0)).toBe(165_000);
    expect(paymentToAvoidInterestCents(165_000, 65_000)).toBe(100_000);
    expect(paymentToAvoidInterestCents(165_000, 200_000)).toBe(0);
    expect(paymentToAvoidInterestCents(0, 0)).toBe(0);
  });

  it('el crédito disponible sale negativo si se pasó del límite', () => {
    expect(availableCreditCents(700_000, 165_000)).toBe(535_000);
    expect(availableCreditCents(500_000, 520_000)).toBe(-20_000);
  });

  it('reconoce alias que parecen número de tarjeta (RNF3)', () => {
    expect(looksLikeCardNumber('4152 3138 0000 1234')).toBe(true);
    expect(looksLikeCardNumber('4152-3138-0000-1234')).toBe(true);
    expect(looksLikeCardNumber('BBVA Oro')).toBe(false);
    expect(looksLikeCardNumber('Nómina 7712')).toBe(false);
  });
});
