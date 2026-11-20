import {
  addDays,
  addMonths,
  dayOfMonthIn,
  diffInDays,
  formatTime,
  formatTimestamp,
  isIsoDate,
  isIsoMonth,
  isValidTimeZone,
  lastDayOfMonth,
  todayIn,
} from './dates';

describe('dates', () => {
  it('valida fechas que existen en el calendario', () => {
    expect(isIsoDate('2026-10-24')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(isIsoMonth('2026-10')).toBe(true);
    expect(isIsoMonth('2026-00')).toBe(false);
  });

  it('suma días y meses cruzando meses y años', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(diffInDays('2026-10-24', '2026-11-02')).toBe(9);
  });

  it('usa el último día cuando el mes es más corto', () => {
    expect(dayOfMonthIn('2026-02', 31)).toBe('2026-02-28');
    expect(dayOfMonthIn('2028-02', 30)).toBe('2028-02-29');
    expect(dayOfMonthIn('2026-04', 31)).toBe('2026-04-30');
    expect(lastDayOfMonth('2026-11')).toBe('2026-11-30');
  });

  it('calcula "hoy" en la zona del usuario, no en la del servidor', () => {
    // 2026-10-25 01:00 UTC todavía es 24 de octubre en Ciudad de México.
    const now = new Date('2026-10-25T01:00:00Z');
    expect(todayIn('America/Mexico_City', now)).toBe('2026-10-24');
    expect(todayIn('UTC', now)).toBe('2026-10-25');
  });

  it('formatea TIMESTAMPTZ con el desfase de la zona', () => {
    const value = new Date('2026-10-24T20:20:00Z');
    expect(formatTimestamp(value, 'America/Mexico_City')).toBe(
      '2026-10-24T14:20:00-06:00',
    );
    expect(formatTimestamp(value, 'UTC')).toBe('2026-10-24T20:20:00+00:00');
    expect(
      formatTimestamp(new Date('2026-10-24T05:00:00Z'), 'Asia/Kolkata'),
    ).toBe('2026-10-24T10:30:00+05:30');
  });

  it('formatea TIME como HH:MM', () => {
    expect(formatTime('14:20:00')).toBe('14:20');
    expect(formatTime(null)).toBeNull();
  });

  it('acepta solo zonas horarias IANA', () => {
    expect(isValidTimeZone('America/Mexico_City')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Marte/Olimpo')).toBe(false);
    expect(isValidTimeZone('-06:00')).toBe(false);
  });
});
