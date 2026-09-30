import { describe, it, expect } from 'vitest';
import {
  redondeoEfectivo, montoRecibidoAtipico, cantidadAtipica, precioConRedondeo,
  DENOMINACIONES_CLP, totalArqueo, calidadCatalogo, sugerirReposicion, clasificacionABC,
  horaLocal, ventasPorHora,
} from '../src/operacion.js';

describe('RF-M5-28 · redondeo del efectivo (Ley 20.956)', () => {
  it('1 a 5 baja a la decena, 6 a 9 sube, 0 queda', () => {
    expect([1990, 1991, 1995, 1996, 1999].map(redondeoEfectivo)).toEqual([1990, 1990, 1990, 2000, 2000]);
    expect(redondeoEfectivo(3)).toBe(0);
    expect(redondeoEfectivo(6)).toBe(10);
  });
});

describe('RF-M5-26 · monto recibido que parece error de tecleo', () => {
  it('avisa con un cero de más, no con un billete grande normal', () => {
    expect(montoRecibidoAtipico(100_000, 9_990)).toBe(true);
    expect(montoRecibidoAtipico(20_000, 1_990)).toBe(false);  // pagar $1.990 con $20.000 es normal
    expect(montoRecibidoAtipico(50_000, 4_990)).toBe(true);
    expect(montoRecibidoAtipico(600_000, 590_000)).toBe(true);
    expect(montoRecibidoAtipico(0, 1000)).toBe(false);
  });
});

describe('RF-M5-27 · cantidad que parece error de tecleo', () => {
  it('100 unidades o 50 kg', () => {
    expect(cantidadAtipica(12)).toBe(false);
    expect(cantidadAtipica(120)).toBe(true);
    expect(cantidadAtipica(0.35, 'kg')).toBe(false);
    expect(cantidadAtipica(50, 'kg')).toBe(true);
  });
});

describe('RF-M2-21 · precio que obliga a redondear', () => {
  it('avisa si no termina en 0', () => {
    expect(precioConRedondeo(1990)).toBe(false);
    expect(precioConRedondeo(1995)).toBe(true);
    expect(precioConRedondeo(0)).toBe(false);
  });
});

describe('RF-M6-13 · arqueo por billetes y monedas', () => {
  it('las denominaciones chilenas vigentes, de mayor a menor', () => {
    expect(DENOMINACIONES_CLP[0]).toBe(20000);
    expect(DENOMINACIONES_CLP.at(-1)).toBe(10);
  });
  it('suma lo contado e ignora negativos y fracciones', () => {
    expect(totalArqueo({ 20000: 2, 1000: 3, 100: 7, 10: 4 })).toBe(43_740);
    expect(totalArqueo({ 5000: -1, 500: 2.7 })).toBe(1000);
    expect(totalArqueo({})).toBe(0);
  });
});

describe('RF-M2-18 · calidad del catálogo', () => {
  const ps = [
    { id: 'a', nombre: 'A', codigos: ['1'], costo: 100, stockMinimo: 5, categoriaId: 'c', precio: 990, perecible: false },
    { id: 'b', nombre: 'B', codigos: [], costo: 0, stockMinimo: 0, categoriaId: null, precio: 995, perecible: true },
  ];
  it('cuenta lo que falta y cuántos están completos', () => {
    const r = calidadCatalogo(ps, true);
    expect(r.completos).toBe(1);
    expect(r.porProducto.get('b')).toEqual(['sin_codigo', 'sin_costo', 'sin_minimo', 'sin_categoria', 'precio_con_redondeo']);
    expect(r.conteo.sin_codigo).toBe(1);
  });
  it('sin permiso de costos no reporta el costo', () => {
    expect(calidadCatalogo(ps, false).porProducto.get('b')).not.toContain('sin_costo');
  });
});

describe('RF-M4-21 · qué pasar de la bodega a la sala', () => {
  const ps = [
    { id: 'a', nombre: 'Arroz', sala: 0, bodega: 30, minimo: 10 },
    { id: 'b', nombre: 'Bebida', sala: 4, bodega: 2, minimo: 10 },
    { id: 'c', nombre: 'Cloro', sala: 20, bodega: 5, minimo: 10 },
    { id: 'd', nombre: 'Detergente', sala: 0, bodega: 7, minimo: 0 },
    { id: 'e', nombre: 'Queso', sala: 0.2, bodega: 3.5, minimo: 1, unidad: 'kg' },
  ];
  it('lo vacío primero, hasta el doble del mínimo, sin pasarse de la bodega', () => {
    expect(sugerirReposicion(ps).map((p) => [p.id, p.mover])).toEqual([
      ['a', 20], ['d', 7], ['b', 2], ['e', 1.8],
    ]);
  });
});

describe('RF-M7-14 · clasificación ABC', () => {
  it('A hasta el 80 %, B hasta el 95 %, C el resto', () => {
    const r = clasificacionABC([
      { id: 'x', ingresos: 10 }, { id: 'y', ingresos: 700 }, { id: 'z', ingresos: 150 }, { id: 'w', ingresos: 140 },
    ]);
    expect(r.map((f) => [f.id, f.clase])).toEqual([['y', 'A'], ['z', 'A'], ['w', 'B'], ['x', 'C']]);
    expect(r.at(-1)?.acumuladoPct).toBe(100);
  });
});

describe('RF-M7-13 · ventas por hora del día', () => {
  it('usa la hora del local, no la de UTC', () => {
    // 2026-09-30 13:05 UTC = 10:05 en Santiago (UTC-3 en horario de verano)
    expect(horaLocal('2026-09-30T13:05:00Z', 'America/Santiago')).toBe(10);
    expect(horaLocal('2026-07-01T13:05:00Z', 'America/Santiago')).toBe(9);
  });
  it('24 horas, con cero las que no vendieron', () => {
    const h = ventasPorHora([
      { fecha: '2026-09-30T13:05:00Z', total: 1000 },
      { fecha: '2026-09-30T13:55:00Z', total: 500 },
    ], 'America/Santiago');
    expect(h).toHaveLength(24);
    expect(h[10]).toEqual({ hora: 10, ventas: 2, total: 1500 });
    expect(h[11].ventas).toBe(0);
  });
});
