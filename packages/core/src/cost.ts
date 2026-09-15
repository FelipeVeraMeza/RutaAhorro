/**
 * Costo promedio ponderado (RF-M3-06).
 *
 * Réplica exacta de lo que hace `fn_confirm_receipt` en la base de datos.
 * Existe aquí para poder mostrarle al bodeguero, ANTES de confirmar, cómo va a
 * quedar el costo — y para poder probar la fórmula sin levantar Postgres.
 * Si esta función y la de la base divergen, es un error: la prueba
 * `cost.test.ts` documenta los casos que ambas deben respetar.
 */
import { clp } from './money.js';

export interface AvgCostInput {
  currentStock: number;
  currentAvgCost: number;
  incomingQty: number;
  incomingUnitCost: number;
}

export function weightedAverageCost(input: AvgCostInput): number {
  const { currentStock, currentAvgCost, incomingQty, incomingUnitCost } = input;

  // Con stock cero o negativo el promedio anterior no significa nada: promediar
  // contra un saldo negativo daría un número sin sentido económico. El costo
  // pasa a ser el de esta compra.
  if (currentStock <= 0) return clp(incomingUnitCost);
  if (incomingQty <= 0) return clp(currentAvgCost);

  const totalValue = currentStock * currentAvgCost + incomingQty * incomingUnitCost;
  const totalQty = currentStock + incomingQty;
  return clp(totalValue / totalQty);
}

/** Variación porcentual del costo de compra respecto del promedio vigente. */
export function costVariationPct(oldCost: number, newCost: number): number {
  if (oldCost <= 0) return 0;
  return Math.round(((newCost - oldCost) / oldCost) * 1000) / 10;
}

/** ¿Hay que advertir al bodeguero antes de confirmar? (RF-M3-08) */
export function shouldWarnCostVariation(
  oldCost: number,
  newCost: number,
  thresholdPct = 20,
): boolean {
  if (oldCost <= 0) return false;
  return Math.abs(costVariationPct(oldCost, newCost)) >= thresholdPct;
}

/** Valorización del inventario: stock × costo promedio. */
export function inventoryValue(quantity: number, avgCost: number): number {
  return clp(quantity * avgCost);
}
