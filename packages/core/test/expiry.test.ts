import { describe, it, expect } from 'vitest';
import {
  allocateFefo, sortFefo, daysToExpiry, expiryStatus,
  expiryAlerts, valueAtRisk, totalLotQuantity, type Lot,
} from '../src/expiry.js';

const HOY = new Date('2026-09-14T10:00:00-03:00');

const lote = (id: string, expiry: string, qty: number, cost = 1000, receivedAt?: string): Lot => ({
  id, expiryDate: expiry, quantity: qty, unitCost: cost, receivedAt,
});

describe('FEFO', () => {
  it('ordena por fecha de vencimiento ascendente', () => {
    const lots = [lote('c', '2026-12-01', 5), lote('a', '2026-09-20', 5), lote('b', '2026-10-15', 5)];
    expect(sortFefo(lots).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('desempata por fecha de recepción', () => {
    const lots = [
      lote('nuevo', '2026-10-01', 5, 1000, '2026-09-10'),
      lote('viejo', '2026-10-01', 5, 1000, '2026-09-01'),
    ];
    expect(sortFefo(lots).map((l) => l.id)).toEqual(['viejo', 'nuevo']);
  });

  it('consume primero el lote que vence antes', () => {
    const lots = [lote('b', '2026-12-01', 10), lote('a', '2026-09-20', 10)];
    const r = allocateFefo(lots, 6);
    expect(r.allocations).toEqual([{ lotId: 'a', quantity: 6, expiryDate: '2026-09-20' }]);
    expect(r.unallocated).toBe(0);
  });

  it('reparte entre varios lotes cuando uno no alcanza', () => {
    const lots = [lote('a', '2026-09-20', 4), lote('b', '2026-10-15', 10)];
    const r = allocateFefo(lots, 9);
    expect(r.allocations).toEqual([
      { lotId: 'a', quantity: 4, expiryDate: '2026-09-20' },
      { lotId: 'b', quantity: 5, expiryDate: '2026-10-15' },
    ]);
    expect(r.unallocated).toBe(0);
  });

  it('NO falla si no alcanza: informa el sobrante (ADR-005)', () => {
    // El local no deja de vender porque el sistema no cuadre.
    const r = allocateFefo([lote('a', '2026-09-20', 3)], 10);
    expect(r.allocations).toEqual([{ lotId: 'a', quantity: 3, expiryDate: '2026-09-20' }]);
    expect(r.unallocated).toBe(7);
  });

  it('ignora lotes vacíos', () => {
    const r = allocateFefo([lote('vacio', '2026-09-15', 0), lote('bueno', '2026-10-01', 5)], 3);
    expect(r.allocations).toEqual([{ lotId: 'bueno', quantity: 3, expiryDate: '2026-10-01' }]);
  });

  it('no deja residuos de punto flotante', () => {
    // 0.1 + 0.2 === 0.30000000000000004 dejaría un "unallocated" fantasma
    const r = allocateFefo([lote('a', '2026-10-01', 0.1), lote('b', '2026-10-02', 0.2)], 0.3);
    expect(r.unallocated).toBe(0);
  });

  it('sin lotes, todo queda sin asignar', () => {
    expect(allocateFefo([], 5)).toEqual({ allocations: [], unallocated: 5 });
  });
});

describe('estado de vencimiento', () => {
  it('cuenta los días restantes', () => {
    expect(daysToExpiry('2026-09-20', HOY)).toBe(6);
    expect(daysToExpiry('2026-09-14', HOY)).toBe(0);
    expect(daysToExpiry('2026-09-10', HOY)).toBe(-4);
  });

  it('clasifica según los días de alerta del producto', () => {
    expect(expiryStatus('2026-09-10', 30, HOY)).toBe('vencido');
    expect(expiryStatus('2026-09-20', 30, HOY)).toBe('por_vencer');
    expect(expiryStatus('2027-03-01', 30, HOY)).toBe('vigente');
  });

  it('el que vence hoy todavía no está vencido', () => {
    // Un yogur que vence hoy se puede vender hoy.
    expect(expiryStatus('2026-09-14', 30, HOY)).toBe('por_vencer');
  });

  it('respeta un umbral de alerta distinto', () => {
    expect(expiryStatus('2026-10-20', 7, HOY)).toBe('vigente');
    expect(expiryStatus('2026-10-20', 60, HOY)).toBe('por_vencer');
  });
});

describe('alertas de vencimiento', () => {
  it('lista solo lo que requiere atención, lo más urgente primero', () => {
    const lots = [
      lote('vigente', '2027-06-01', 10),
      lote('porvencer', '2026-09-25', 4, 2000),
      lote('vencido', '2026-09-01', 2, 3000),
    ];
    const alerts = expiryAlerts(lots, 30, HOY);
    expect(alerts.map((a) => a.lot.id)).toEqual(['vencido', 'porvencer']);
    expect(alerts[0].status).toBe('vencido');
  });

  it('informa el valor en riesgo en pesos', () => {
    expect(valueAtRisk(lote('x', '2026-09-20', 4, 2500))).toBe(10000);
  });

  it('ignora lotes sin stock', () => {
    expect(expiryAlerts([lote('a', '2026-09-01', 0)], 30, HOY)).toHaveLength(0);
  });
});

describe('totalLotQuantity', () => {
  it('suma el stock de los lotes sin residuo decimal', () => {
    expect(totalLotQuantity([lote('a', '2026-10-01', 0.1), lote('b', '2026-10-02', 0.2)])).toBe(0.3);
  });
});
