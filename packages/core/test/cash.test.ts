import { describe, it, expect } from 'vitest';
import {
  expectedCash, cashSessionSummary, requiresClosingNote,
  paymentBreakdown, isSessionStale,
} from '../src/cash.js';

describe('efectivo esperado', () => {
  it('suma inicial + ventas en efectivo + ingresos − egresos', () => {
    expect(expectedCash({
      openingAmount: 30000, cashSales: 162400, cashIn: 0, cashOut: 5000,
    })).toBe(187400);
  });
});

describe('resumen de caja', () => {
  it('detecta un faltante', () => {
    const s = cashSessionSummary({
      openingAmount: 30000, cashSales: 162400, cashIn: 0, cashOut: 5000,
      countedAmount: 185400, salesCount: 47, salesTotal: 226600,
    });
    expect(s.expectedAmount).toBe(187400);
    expect(s.difference).toBe(-2000);
    expect(s.status).toBe('faltante');
  });

  it('detecta un sobrante', () => {
    const s = cashSessionSummary({
      openingAmount: 30000, cashSales: 100000, cashIn: 0, cashOut: 0,
      countedAmount: 131000,
    });
    expect(s.difference).toBe(1000);
    expect(s.status).toBe('sobrante');
  });

  it('reconoce la caja cuadrada', () => {
    const s = cashSessionSummary({
      openingAmount: 30000, cashSales: 100000, cashIn: 0, cashOut: 0,
      countedAmount: 130000,
    });
    expect(s.difference).toBe(0);
    expect(s.status).toBe('cuadrada');
  });

  it('antes de contar no inventa una diferencia', () => {
    const s = cashSessionSummary({
      openingAmount: 30000, cashSales: 100000, cashIn: 0, cashOut: 0,
    });
    expect(s.countedAmount).toBeNull();
    expect(s.difference).toBeNull();
    expect(s.status).toBe('sin_contar');
  });

  it('calcula el ticket promedio', () => {
    const s = cashSessionSummary({
      openingAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0,
      salesCount: 47, salesTotal: 226600,
    });
    expect(s.averageTicket).toBe(4821);
  });

  it('no divide por cero sin ventas', () => {
    const s = cashSessionSummary({
      openingAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0,
      salesCount: 0, salesTotal: 0,
    });
    expect(s.averageTicket).toBe(0);
  });
});

describe('nota de cierre obligatoria', () => {
  it('la exige si hay diferencia (RF-M6-06)', () => {
    expect(requiresClosingNote(187400, 185400)).toBe(true);
    expect(requiresClosingNote(187400, 189000)).toBe(true);
  });

  it('no la exige si cuadra', () => {
    expect(requiresClosingNote(187400, 187400)).toBe(false);
  });
});

describe('desglose por medio de pago', () => {
  it('agrupa y deja en cero los medios no usados', () => {
    const r = paymentBreakdown([
      { method: 'efectivo', amount: 5000 },
      { method: 'efectivo', amount: 2000 },
      { method: 'debito', amount: 12000 },
    ]);
    expect(r).toEqual({ efectivo: 7000, debito: 12000, credito: 0, transferencia: 0 });
  });
});

describe('caja abierta demasiado tiempo', () => {
  it('alerta pasado el umbral (RF-M6-11)', () => {
    const abierta = new Date('2026-09-14T08:00:00');
    const ahora = new Date('2026-09-14T21:00:00');
    expect(isSessionStale(abierta, 12, ahora)).toBe(true);
    expect(isSessionStale(abierta, 24, ahora)).toBe(false);
  });
});
