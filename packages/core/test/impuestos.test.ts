import { describe, it, expect } from 'vitest';
import { desglosarImpuestos } from '../src/impuestos.js';
import { taxIncluded } from '../src/money.js';

const cuadra = (d: ReturnType<typeof desglosarImpuestos>) => d.neto + d.iva + d.totalAdicionales;

describe('desglosarImpuestos — sin impuestos adicionales', () => {
  it('es idéntico a lo de antes: IVA extraído del total', () => {
    for (const total of [3000, 1, 999, 12990, 57_843]) {
      const d = desglosarImpuestos([{ subtotal: total }], 19);
      expect(d.iva).toBe(taxIncluded(total, 19));
      expect(d.neto + d.iva).toBe(total);
      expect(d.adicionales).toEqual([]);
    }
  });
  it('la primera venta real: neto 2.521 + IVA 479 = 3.000', () => {
    const d = desglosarImpuestos([{ subtotal: 1500 }, { subtotal: 1500 }], 19);
    expect([d.neto, d.iva, d.total]).toEqual([2521, 479, 3000]);
  });
  it('varias líneas se calculan juntas, no con un redondeo por línea', () => {
    const d = desglosarImpuestos([{ subtotal: 999 }, { subtotal: 999 }, { subtotal: 999 }], 19);
    expect(d.iva).toBe(taxIncluded(2997, 19));
  });
});

describe('desglosarImpuestos — con impuesto adicional', () => {
  it('una bebida de $1.990 con IABA 18 %: neto × 1,37', () => {
    const d = desglosarImpuestos([{ subtotal: 1990, tasaAdicional: 18, nombreAdicional: 'IABA' }], 19);
    expect(d.neto).toBe(Math.round(1990 / 1.37)); // 1453
    expect(d.adicionales).toEqual([{ tasa: 18, nombre: 'IABA', neto: 1453, monto: Math.round(1453 * 0.18) }]);
    expect(cuadra(d)).toBe(1990);
    expect(d.total).toBe(1990);
  });
  it('mezcla de productos con y sin impuesto: cada grupo por su lado y todo cuadra', () => {
    const d = desglosarImpuestos([
      { subtotal: 3000 },
      { subtotal: 1990, tasaAdicional: 18 },
      { subtotal: 990, tasaAdicional: 10 },
      { subtotal: 5990, tasaAdicional: 31.5 },
    ], 19);
    expect(d.adicionales.map((a) => a.tasa)).toEqual([10, 18, 31.5]);
    expect(cuadra(d)).toBe(3000 + 1990 + 990 + 5990);
  });
  it('un descuento a la venta completa se reparte en proporción y el total sigue cuadrando', () => {
    const d = desglosarImpuestos([{ subtotal: 3000 }, { subtotal: 1000, tasaAdicional: 18 }], 19, 401);
    expect(d.total).toBe(4000 - 401);
    expect(cuadra(d)).toBe(3599);
  });
  it('un descuento mayor que la venta no deja montos negativos', () => {
    const d = desglosarImpuestos([{ subtotal: 500, tasaAdicional: 18 }], 19, 900);
    expect(d.total).toBe(0);
    expect(d.neto).toBe(0);
  });
  it('miles de totales al azar: neto + IVA + adicionales === total, siempre', () => {
    let semilla = 7;
    const azar = (n: number) => { semilla = (semilla * 48271) % 2147483647; return semilla % n; };
    const tasas = [0, 10, 18, 20.5, 31.5];
    for (let i = 0; i < 3000; i++) {
      const lineas = Array.from({ length: 1 + azar(6) }, () => ({ subtotal: 1 + azar(50_000), tasaAdicional: tasas[azar(5)] }));
      const suma = lineas.reduce((s, l) => s + l.subtotal, 0);
      const desc = azar(3) === 0 ? azar(suma) : 0;
      const d = desglosarImpuestos(lineas, 19, desc);
      expect(cuadra(d)).toBe(suma - desc);
      expect(d.iva).toBeGreaterThanOrEqual(0);
    }
  });
});
