// La BD guarda los valores de los enums en español y la API los expone en
// inglés (contrato §1, "Valores de los enums"). La traducción vive solo aquí.

export enum FlowType {
  INCOME = 'income',
  EXPENSE = 'expense',
}

export enum FlowSubtype {
  RECURRING = 'recurring',
  VARIABLE = 'variable',
  FIXED = 'fixed',
}

export enum PaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  CARD = 'card',
}

export enum CardType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum AccountType {
  CASH = 'cash',
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum Frequency {
  WEEKLY = 'weekly',
  SEMIMONTHLY = 'semimonthly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum PocketMovementType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
}

export enum AlertLevel {
  NONE = 'none',
  WARNING = 'warning',
  EXCEEDED = 'exceeded',
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export enum CategoryAppliesTo {
  INCOME = 'income',
  EXPENSE = 'expense',
  BOTH = 'both',
}

export enum PlanName {
  NORMAL = 'normal',
  PREMIUM = 'premium',
}

export const FLOW_TYPE_DB = {
  [FlowType.INCOME]: 'ingreso',
  [FlowType.EXPENSE]: 'gasto',
} as const satisfies Record<FlowType, string>;

export const FLOW_SUBTYPE_DB = {
  [FlowSubtype.RECURRING]: 'recurrente',
  [FlowSubtype.VARIABLE]: 'variable',
  [FlowSubtype.FIXED]: 'fijo',
} as const satisfies Record<FlowSubtype, string>;

export const PAYMENT_METHOD_DB = {
  [PaymentMethod.CASH]: 'efectivo',
  [PaymentMethod.TRANSFER]: 'transferencia',
  [PaymentMethod.CARD]: 'tarjeta',
} as const satisfies Record<PaymentMethod, string>;

export const CARD_TYPE_DB = {
  [CardType.CREDIT]: 'credito',
  [CardType.DEBIT]: 'debito',
} as const satisfies Record<CardType, string>;

export const ACCOUNT_TYPE_DB = {
  [AccountType.CASH]: 'efectivo',
  [AccountType.DEBIT]: 'debito',
  [AccountType.CREDIT]: 'credito',
} as const satisfies Record<AccountType, string>;

export const FREQUENCY_DB = {
  [Frequency.WEEKLY]: 'semanal',
  [Frequency.SEMIMONTHLY]: 'quincenal',
  [Frequency.MONTHLY]: 'mensual',
  [Frequency.YEARLY]: 'anual',
} as const satisfies Record<Frequency, string>;

export const POCKET_MOVEMENT_TYPE_DB = {
  [PocketMovementType.DEPOSIT]: 'abono',
  [PocketMovementType.WITHDRAWAL]: 'retiro',
} as const satisfies Record<PocketMovementType, string>;

export const ALERT_LEVEL_DB = {
  [AlertLevel.NONE]: 'ninguna',
  [AlertLevel.WARNING]: 'preventiva',
  [AlertLevel.EXCEEDED]: 'excedida',
} as const satisfies Record<AlertLevel, string>;

export const MESSAGE_ROLE_DB = {
  [MessageRole.USER]: 'usuario',
  [MessageRole.ASSISTANT]: 'asistente',
} as const satisfies Record<MessageRole, string>;

export const CATEGORY_APPLIES_TO_DB = {
  [CategoryAppliesTo.INCOME]: 'ingreso',
  [CategoryAppliesTo.EXPENSE]: 'gasto',
  [CategoryAppliesTo.BOTH]: 'ambos',
} as const satisfies Record<CategoryAppliesTo, string>;

export type DbFlowType = (typeof FLOW_TYPE_DB)[FlowType];
export type DbFlowSubtype = (typeof FLOW_SUBTYPE_DB)[FlowSubtype];
export type DbPaymentMethod = (typeof PAYMENT_METHOD_DB)[PaymentMethod];
export type DbCardType = (typeof CARD_TYPE_DB)[CardType];
export type DbAccountType = (typeof ACCOUNT_TYPE_DB)[AccountType];
export type DbFrequency = (typeof FREQUENCY_DB)[Frequency];
export type DbPocketMovementType =
  (typeof POCKET_MOVEMENT_TYPE_DB)[PocketMovementType];
export type DbAlertLevel = (typeof ALERT_LEVEL_DB)[AlertLevel];
export type DbMessageRole = (typeof MESSAGE_ROLE_DB)[MessageRole];
export type DbCategoryAppliesTo =
  (typeof CATEGORY_APPLIES_TO_DB)[CategoryAppliesTo];

/** El valor de la API para un valor de la BD, con el mismo mapa que va de la API a la BD. */
export function fromDb<TApi extends string>(
  map: Record<TApi, string>,
  dbValue: string,
): TApi {
  for (const [apiValue, mapped] of Object.entries(map) as [TApi, string][]) {
    if (mapped === dbValue) {
      return apiValue;
    }
  }
  throw new Error(`Unknown database enum value: ${dbValue}`);
}
