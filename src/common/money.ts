// La BD guarda los montos como NUMERIC y `pg` los entrega como texto. La
// aritmética de la aplicación va en centavos enteros, para no arrastrar los
// errores de redondeo de los números de punto flotante.

export function toCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Un NUMERIC de la BD como número JSON con 2 decimales (contrato §1, "Dinero"). */
export function toMoney(value: string | number): number {
  return fromCents(toCents(value));
}

export function toMoneyOrNull(
  value: string | number | null | undefined,
): number | null {
  return value === null || value === undefined ? null : toMoney(value);
}

/** Un monto en centavos como texto para un parámetro NUMERIC de la BD. */
export function centsToNumeric(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const units = Math.trunc(absolute / 100);
  const decimals = String(absolute % 100).padStart(2, '0');
  return `${sign}${units}.${decimals}`;
}
