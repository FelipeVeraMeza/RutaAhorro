/**
 * Arqueo de caja (módulo M6).
 * Réplica de `fn_cash_session_summary`. Ver cash.test.ts.
 */
import { clp } from './money.js';

export type PaymentMethod = 'efectivo' | 'debito' | 'credito' | 'transferencia';

export interface CashSessionInput {
  openingAmount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  countedAmount?: number | null;
  salesCount?: number;
  salesTotal?: number;
}

export interface CashSessionSummary {
  openingAmount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expectedAmount: number;
  countedAmount: number | null;
  difference: number | null;
  status: 'cuadrada' | 'faltante' | 'sobrante' | 'sin_contar';
  salesCount: number;
  salesTotal: number;
  averageTicket: number;
}

/** Efectivo esperado = inicial + ventas en efectivo + ingresos − egresos. */
export function expectedCash(input: CashSessionInput): number {
  return clp(input.openingAmount + input.cashSales + input.cashIn - input.cashOut);
}

export function cashSessionSummary(input: CashSessionInput): CashSessionSummary {
  const expected = expectedCash(input);
  const counted = input.countedAmount ?? null;
  const difference = counted === null ? null : clp(counted) - expected;

  let status: CashSessionSummary['status'] = 'sin_contar';
  if (difference !== null) {
    status = difference === 0 ? 'cuadrada' : difference < 0 ? 'faltante' : 'sobrante';
  }

  const salesCount = input.salesCount ?? 0;
  const salesTotal = input.salesTotal ?? 0;

  return {
    openingAmount: clp(input.openingAmount),
    cashSales: clp(input.cashSales),
    cashIn: clp(input.cashIn),
    cashOut: clp(input.cashOut),
    expectedAmount: expected,
    countedAmount: counted === null ? null : clp(counted),
    difference,
    status,
    salesCount,
    salesTotal: clp(salesTotal),
    averageTicket: salesCount > 0 ? clp(salesTotal / salesCount) : 0,
  };
}

/**
 * RF-M6-06: una caja descuadrada no se cierra sin explicación.
 * Es el control que convierte una diferencia en información en lugar de en un
 * misterio que nadie recuerda al día siguiente.
 */
export function requiresClosingNote(expected: number, counted: number): boolean {
  return clp(counted) !== clp(expected);
}

/** Desglose por medio de pago, con los cuatro medios siempre presentes. */
export function paymentBreakdown(
  payments: Array<{ method: PaymentMethod; amount: number }>,
): Record<PaymentMethod, number> {
  const base: Record<PaymentMethod, number> = {
    efectivo: 0, debito: 0, credito: 0, transferencia: 0,
  };
  for (const p of payments) base[p.method] = clp(base[p.method] + p.amount);
  return base;
}

/** ¿La caja lleva demasiado tiempo abierta? (RF-M6-11) */
export function isSessionStale(openedAt: Date, maxHours = 12, now = new Date()): boolean {
  return (now.getTime() - openedAt.getTime()) / 36e5 > maxHours;
}
