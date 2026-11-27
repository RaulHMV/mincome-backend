import { Frequency } from '../common/enums';
import {
  firstOccurrenceOnOrAfter,
  nextOccurrence,
  occurrencesBetween,
  type RecurrenceRule,
} from './recurrence';

function rule(overrides: Partial<RecurrenceRule>): RecurrenceRule {
  return {
    frequency: Frequency.MONTHLY,
    startDate: '2026-08-01',
    dayOfMonth: 1,
    endDate: null,
    ...overrides,
  };
}

describe('recurrence (requerimientos-backend.md §2.4)', () => {
  it('semanal: cada 7 días desde el inicio', () => {
    const weekly = rule({
      frequency: Frequency.WEEKLY,
      startDate: '2026-10-05',
      dayOfMonth: null,
    });
    expect(firstOccurrenceOnOrAfter(weekly, '2026-10-01')).toBe('2026-10-05');
    expect(firstOccurrenceOnOrAfter(weekly, '2026-10-06')).toBe('2026-10-12');
    expect(firstOccurrenceOnOrAfter(weekly, '2026-10-12')).toBe('2026-10-12');
    expect(occurrencesBetween(weekly, '2026-10-25', '2026-11-10')).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
    ]);
  });

  it('quincenal: el 15 y el último día de cada mes', () => {
    const payroll = rule({
      frequency: Frequency.SEMIMONTHLY,
      startDate: '2026-10-01',
      dayOfMonth: null,
    });
    expect(occurrencesBetween(payroll, '2026-10-01', '2027-03-01')).toEqual([
      '2026-10-15',
      '2026-10-31',
      '2026-11-15',
      '2026-11-30',
      '2026-12-15',
      '2026-12-31',
      '2027-01-15',
      '2027-01-31',
      '2027-02-15',
      '2027-02-28',
    ]);
    expect(firstOccurrenceOnOrAfter(payroll, '2026-10-16')).toBe('2026-10-31');
  });

  it('mensual: usa el último día en meses más cortos', () => {
    const rent = rule({ startDate: '2026-01-31', dayOfMonth: 31 });
    expect(occurrencesBetween(rent, '2026-01-01', '2026-05-01')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    const thirty = rule({ startDate: '2028-01-30', dayOfMonth: 30 });
    expect(nextOccurrence(thirty, '2028-01-30')).toBe('2028-02-29');
  });

  it('mensual: la primera ocurrencia no es anterior al inicio', () => {
    const rent = rule({ startDate: '2026-11-10', dayOfMonth: 1 });
    expect(firstOccurrenceOnOrAfter(rent, '2026-11-10')).toBe('2026-12-01');
    expect(firstOccurrenceOnOrAfter(rule({}), '2026-11-01')).toBe('2026-11-01');
  });

  it('anual: el 29 de febrero cae el 28 en años no bisiestos', () => {
    const yearly = rule({
      frequency: Frequency.YEARLY,
      startDate: '2028-02-29',
      dayOfMonth: null,
    });
    expect(occurrencesBetween(yearly, '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('termina en la fecha fin', () => {
    const limited = rule({ endDate: '2026-10-15' });
    expect(occurrencesBetween(limited, '2026-08-01', '2026-12-31')).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(nextOccurrence(limited, '2026-10-01')).toBeNull();
  });
});
