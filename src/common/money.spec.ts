import {
  centsToNumeric,
  fromCents,
  toCents,
  toMoney,
  toMoneyOrNull,
} from './money';

describe('money', () => {
  it('convierte NUMERIC de la BD a centavos sin errores de punto flotante', () => {
    expect(toCents('1650.00')).toBe(165000);
    expect(toCents('0.10') + toCents('0.20')).toBe(30);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents('-800.50')).toBe(-80050);
  });

  it('regresa números JSON con 2 decimales', () => {
    expect(toMoney('14950.50')).toBe(14950.5);
    expect(fromCents(30)).toBe(0.3);
    expect(toMoneyOrNull(null)).toBeNull();
  });

  it('escribe centavos como texto para un parámetro NUMERIC', () => {
    expect(centsToNumeric(165000)).toBe('1650.00');
    expect(centsToNumeric(5)).toBe('0.05');
    expect(centsToNumeric(-80050)).toBe('-800.50');
    expect(centsToNumeric(0)).toBe('0.00');
  });
});
