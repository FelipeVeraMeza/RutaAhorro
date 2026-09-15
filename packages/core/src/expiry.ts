/**
 * Lotes y vencimiento — FEFO (First Expired, First Out).
 * Ver ADR-007. Réplica de `fn_consume_lots`.
 */
import { clp } from './money.js';

export type ExpiryStatus = 'vigente' | 'por_vencer' | 'vencido';

export interface Lot {
  id: string;
  lotCode?: string | null;
  expiryDate: string;   // ISO 'YYYY-MM-DD'
  quantity: number;
  unitCost: number;
  receivedAt?: string;
}

export interface LotAllocation {
  lotId: string;
  quantity: number;
  expiryDate: string;
}

export interface AllocationResult {
  allocations: LotAllocation[];
  unallocated: number;
}

/** Días hasta el vencimiento. Negativo si ya venció. */
export function daysToExpiry(expiryDate: string, today = new Date()): number {
  const expiry = new Date(`${expiryDate}T00:00:00`);
  const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((expiry.getTime() - ref.getTime()) / 864e5);
}

export function expiryStatus(expiryDate: string, alertDays = 30, today = new Date()): ExpiryStatus {
  const days = daysToExpiry(expiryDate, today);
  if (days < 0) return 'vencido';
  if (days <= alertDays) return 'por_vencer';
  return 'vigente';
}

/** Ordena FEFO: vence antes, sale antes. Empate → lo recibido primero. */
export function sortFefo(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => {
    const byExpiry = a.expiryDate.localeCompare(b.expiryDate);
    if (byExpiry !== 0) return byExpiry;
    return (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '');
  });
}

/**
 * Reparte una cantidad vendida entre los lotes, del que vence antes al que
 * vence después.
 *
 * Si no alcanza, NO falla: devuelve el sobrante en `unallocated`. Coherente con
 * ADR-005 — el local no deja de vender porque el sistema no cuadre; el
 * descuadre queda visible y se corrige después.
 */
export function allocateFefo(lots: Lot[], quantity: number): AllocationResult {
  const allocations: LotAllocation[] = [];
  let pending = quantity;

  for (const lot of sortFefo(lots)) {
    if (pending <= 0) break;
    if (lot.quantity <= 0) continue;
    const take = Math.min(lot.quantity, pending);
    allocations.push({ lotId: lot.id, quantity: take, expiryDate: lot.expiryDate });
    pending -= take;
  }

  // Redondeo a 3 decimales: es la precisión de numeric(14,3) en la base.
  // Sin esto, 0.1 + 0.2 dejaría un "unallocated" de 2.7e-17.
  return { allocations, unallocated: Math.max(Math.round(pending * 1000) / 1000, 0) };
}

/** Valor en pesos que se pierde si el lote vence sin venderse. */
export function valueAtRisk(lot: Lot): number {
  return clp(lot.quantity * lot.unitCost);
}

export interface ExpiryAlert {
  lot: Lot;
  status: ExpiryStatus;
  daysToExpiry: number;
  valueAtRisk: number;
}

/** Lotes que requieren atención, los más urgentes primero (RF-M4-18). */
export function expiryAlerts(lots: Lot[], alertDays = 30, today = new Date()): ExpiryAlert[] {
  return lots
    .filter((l) => l.quantity > 0)
    .map((lot) => ({
      lot,
      status: expiryStatus(lot.expiryDate, alertDays, today),
      daysToExpiry: daysToExpiry(lot.expiryDate, today),
      valueAtRisk: valueAtRisk(lot),
    }))
    .filter((a) => a.status !== 'vigente')
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}

/** Suma del stock por lote. Debe coincidir con stock_levels.quantity. */
export function totalLotQuantity(lots: Lot[]): number {
  return Math.round(lots.reduce((s, l) => s + l.quantity, 0) * 1000) / 1000;
}
