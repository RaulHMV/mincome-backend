import {
  ACCOUNT_TYPE_DB,
  AccountType,
  type DbAccountType,
} from '../common/enums';

export interface AccountBalance {
  accountId: string;
  type: DbAccountType;
  /** saldo_inicial + ingresos − gastos + traspasos que entran − los que salen − abonos + retiros. */
  balanceCents: number;
}

export interface BalanceSummary {
  /** Saldo Libre: cuentas de efectivo y débito. */
  freeBalanceCents: number;
  /** Crédito Utilizado: el saldo de las cuentas de crédito con el signo invertido. */
  creditUsedCents: number;
  /** Capital en Apartados. */
  pocketsBalanceCents: number;
  /**
   * Patrimonio neto (decisión D2): Saldo Libre + Apartados − deuda de
   * tarjetas. Es lo mismo que saldos iniciales + ingresos − gastos: los
   * traspasos y los apartados no lo mueven.
   */
  netWorthCents: number;
}

/** requerimientos-backend.md §3.1. */
export function summarizeBalances(
  accounts: readonly AccountBalance[],
  pocketsBalanceCents: number,
): BalanceSummary {
  let freeBalanceCents = 0;
  let creditBalanceCents = 0;
  for (const account of accounts) {
    if (account.type === ACCOUNT_TYPE_DB[AccountType.CREDIT]) {
      creditBalanceCents += account.balanceCents;
    } else {
      freeBalanceCents += account.balanceCents;
    }
  }
  return {
    freeBalanceCents,
    // 0 - x y no -x: sin deuda queda 0 y no -0.
    creditUsedCents: 0 - creditBalanceCents,
    pocketsBalanceCents,
    netWorthCents: freeBalanceCents + creditBalanceCents + pocketsBalanceCents,
  };
}
