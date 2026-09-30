import { describe, it, expect } from 'vitest';
import {
  serieCompleta, periodoAnterior, variacionPct, textoVariacion, diasEnRango, sumaTotales,
} from '../src/tendencia.js';
import { sugerirCompra, costoEstimado, textoPedido } from '../src/compras.js';

describe('RF-M7-10 · gráfico de los últimos 30 días', () => {
  it('rellena con cero los días sin ventas, en orden', () => {
    const s = serieCompleta([
      { fecha: '2026-09-28', total: 1000, ventas: 2 },
      { fecha: '2026-09-30', total: 3000, ventas: 1 },
    ], '2026-09-27', '2026-09-30');
    expect(s.map((p) => p.fecha)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
    expect(s.map((p) => p.total)).toEqual([0, 1000, 0, 3000]);
  });

  it('cruza fin de mes y de año sin saltarse días', () => {
    expect(serieCompleta([], '2026-12-30', '2027-01-02')).toHaveLength(4);
    expect(diasEnRango('2026-02-27', '2026-03-01')).toBe(3);
  });

  it('30 días son 30 puntos', () => {
    expect(serieCompleta([], '2026-09-01', '2026-09-30')).toHaveLength(30);
  });
});

describe('RF-M7-11 · comparación con el período anterior', () => {
  it('el período anterior mide lo mismo y queda pegado al actual', () => {
    expect(periodoAnterior('2026-10-08', '2026-10-14')).toEqual({ desde: '2026-10-01', hasta: '2026-10-07' });
    expect(periodoAnterior('2026-09-30', '2026-09-30')).toEqual({ desde: '2026-09-29', hasta: '2026-09-29' });
  });

  it('variación redondeada, y nada si antes no hubo ventas', () => {
    expect(variacionPct(112, 100)).toBe(12);
    expect(variacionPct(92, 100)).toBe(-8);
    expect(variacionPct(50, 0)).toBeNull();
    expect(textoVariacion(12)).toBe('+12 %');
    expect(textoVariacion(-8)).toBe('−8 %');
    expect(textoVariacion(0)).toBe('igual');
    expect(textoVariacion(null)).toBeNull();
  });

  it('suma totales y ventas', () => {
    expect(sumaTotales([{ fecha: 'a', total: 10, ventas: 1 }, { fecha: 'b', total: 5, ventas: 2 }])).toEqual({ total: 15, ventas: 3 });
  });
});

describe('RF-M3-11 · orden de compra sugerida', () => {
  const productos = [
    { id: 'a', nombre: 'Arroz', stock: 3, minimo: 10 },
    { id: 'b', nombre: 'Leche', stock: 0, minimo: 12, costo: 850 },
    { id: 'c', nombre: 'Azúcar', stock: 20, minimo: 8 },
    { id: 'd', nombre: 'Queso', stock: 0.4, minimo: 2, unidad: 'kg', costo: 9000 },
    { id: 'e', nombre: 'Sin mínimo', stock: 0, minimo: 0 },
  ];

  it('solo lo que está bajo el mínimo, lo agotado primero', () => {
    const s = sugerirCompra(productos);
    expect(s.map((l) => l.id)).toEqual(['b', 'd', 'a']);
  });

  it('pide hasta el doble del mínimo; entero por unidad, un decimal por kilo', () => {
    const s = Object.fromEntries(sugerirCompra(productos).map((l) => [l.id, l.pedir]));
    expect(s).toEqual({ a: 17, b: 24, d: 3.6 });
  });

  it('estima el costo con lo que tiene costo', () => {
    expect(costoEstimado(sugerirCompra(productos))).toBe(24 * 850 + Math.round(3.6 * 9000));
  });

  it('arma el texto para mandarle al proveedor', () => {
    const t = textoPedido(sugerirCompra(productos), 'RutaAhorro');
    expect(t.split('\n')[0]).toBe('Pedido de RutaAhorro:');
    expect(t).toContain('• 3,6 kg · Queso');
    expect(t).toContain('• 24 · Leche');
  });
});
