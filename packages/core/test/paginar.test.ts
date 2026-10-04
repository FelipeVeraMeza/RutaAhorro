import { describe, it, expect } from 'vitest';
import { todasLasPaginas } from '../src/paginar.js';

/** Una "API" que, como Supabase, nunca entrega más de 1.000 filas por consulta. */
function api(total: number) {
  const filas = Array.from({ length: total }, (_, i) => i);
  const pedidos: Array<[number, number]> = [];
  const pedir = async (desde: number, hasta: number) => {
    pedidos.push([desde, hasta]);
    return { data: filas.slice(desde, Math.min(hasta + 1, desde + 1000)), error: null };
  };
  return { pedir, pedidos };
}

describe('todas las páginas (docs/28, 120 a 126)', () => {
  it('trae más de 1.000 filas, que una sola consulta cortaría', async () => {
    const { pedir } = api(2500);
    const r = await todasLasPaginas(pedir);
    expect(r).toHaveLength(2500);
    expect(r[2499]).toBe(2499);
  });
  it('justo 1.000 pide una página más y para', async () => {
    const { pedir, pedidos } = api(1000);
    expect(await todasLasPaginas(pedir)).toHaveLength(1000);
    expect(pedidos).toEqual([[0, 999], [1000, 1999]]);
  });
  it('un error de la API no se traga: se lanza', async () => {
    await expect(todasLasPaginas(async () => ({ data: null, error: new Error('caída') }))).rejects.toThrow('caída');
  });
  it('respeta el máximo', async () => {
    const { pedir } = api(5000);
    expect(await todasLasPaginas(pedir, { maximo: 2000 })).toHaveLength(2000);
  });
});
