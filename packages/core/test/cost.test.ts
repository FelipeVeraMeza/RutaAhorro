import { describe, it, expect } from 'vitest';
import {
  weightedAverageCost, costVariationPct,
  shouldWarnCostVariation, inventoryValue,
} from '../src/cost.js';

describe('costo promedio ponderado', () => {
  it('promedia ponderando por cantidad', () => {
    // 10 u a $1.000 + 10 u a $1.400 => $1.200
    expect(weightedAverageCost({
      currentStock: 10, currentAvgCost: 1000,
      incomingQty: 10, incomingUnitCost: 1400,
    })).toBe(1200);
  });

  it('pondera correctamente cuando las cantidades difieren', () => {
    // 90 u a $1.000 + 10 u a $2.000 => $1.100
    expect(weightedAverageCost({
      currentStock: 90, currentAvgCost: 1000,
      incomingQty: 10, incomingUnitCost: 2000,
    })).toBe(1100);
  });

  it('con stock cero adopta el costo de la compra', () => {
    expect(weightedAverageCost({
      currentStock: 0, currentAvgCost: 999999,
      incomingQty: 5, incomingUnitCost: 1500,
    })).toBe(1500);
  });

  it('con stock negativo adopta el costo de la compra', () => {
    // Puede pasar tras vender offline más de lo disponible (ADR-005).
    // Promediar contra un saldo negativo daría un costo sin sentido económico.
    expect(weightedAverageCost({
      currentStock: -3, currentAvgCost: 1000,
      incomingQty: 10, incomingUnitCost: 1500,
    })).toBe(1500);
  });

  it('sin cantidad entrante conserva el promedio', () => {
    expect(weightedAverageCost({
      currentStock: 10, currentAvgCost: 1000,
      incomingQty: 0, incomingUnitCost: 5000,
    })).toBe(1000);
  });

  it('devuelve siempre un entero (CLP no tiene decimales)', () => {
    const r = weightedAverageCost({
      currentStock: 3, currentAvgCost: 1000,
      incomingQty: 7, incomingUnitCost: 1333,
    });
    expect(Number.isInteger(r)).toBe(true);
  });
});

describe('variación de costo', () => {
  it('calcula el porcentaje de variación', () => {
    expect(costVariationPct(1000, 1400)).toBe(40);
    expect(costVariationPct(1000, 800)).toBe(-20);
  });

  it('advierte cuando supera el umbral, en alza o en baja', () => {
    expect(shouldWarnCostVariation(1000, 1400)).toBe(true);
    expect(shouldWarnCostVariation(1000, 800)).toBe(true);
    expect(shouldWarnCostVariation(1000, 1100)).toBe(false);
  });

  it('no advierte si no había costo previo', () => {
    expect(shouldWarnCostVariation(0, 1500)).toBe(false);
  });
});

describe('valorización', () => {
  it('multiplica stock por costo promedio', () => {
    expect(inventoryValue(12.5, 1200)).toBe(15000);
  });
});
