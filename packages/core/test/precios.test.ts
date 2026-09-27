import { describe, it, expect } from 'vitest';
import { precioPorCantidad, tramosVigentes, validarTramos, type TramoPrecio } from '../src/precios.js';

// El ejemplo del cliente, textual: «1 por $2.000 y si llevas 3 te llevas los 3 a $1.400 cada uno».
const CLIENTE: TramoPrecio[] = [{ desde: 3, precio: 1400 }];

describe('precioPorCantidad — el ejemplo del cliente', () => {
  it('1 y 2 unidades van a precio de lista', () => {
    expect(precioPorCantidad(2000, CLIENTE, 1)).toEqual({ precio: 2000, tramo: null });
    expect(precioPorCantidad(2000, CLIENTE, 2).precio).toBe(2000);
  });
  it('desde 3, TODAS las unidades van a $1.400 (no solo la tercera)', () => {
    const r = precioPorCantidad(2000, CLIENTE, 3);
    expect(r.precio).toBe(1400);
    expect(r.tramo).toEqual(CLIENTE[0]);
    expect(precioPorCantidad(2000, CLIENTE, 10).precio).toBe(1400);
  });
  it('la lista del cliente del 2026-09-19: «1 a 1.000 y desde 3 a 700»', () => {
    const t = [{ desde: 3, precio: 700 }];
    expect(precioPorCantidad(1000, t, 2).precio * 2).toBe(2000);
    expect(precioPorCantidad(1000, t, 3).precio * 3).toBe(2100);
  });
});

describe('precioPorCantidad — varios tramos', () => {
  const t: TramoPrecio[] = [{ desde: 12, precio: 1200 }, { desde: 3, precio: 1400 }, { desde: 6, precio: 1300 }];
  it('gana el tramo con la cantidad más alta que se alcanza, sin importar el orden', () => {
    expect(precioPorCantidad(2000, t, 5).precio).toBe(1400);
    expect(precioPorCantidad(2000, t, 6).precio).toBe(1300);
    expect(precioPorCantidad(2000, t, 11).precio).toBe(1300);
    expect(precioPorCantidad(2000, t, 12).precio).toBe(1200);
  });
  it('una cantidad fraccionaria también alcanza el tramo', () => {
    expect(precioPorCantidad(2000, t, 2.5).precio).toBe(2000);
    expect(precioPorCantidad(2000, t, 3.5).precio).toBe(1400);
  });
  it('sin tramos, precio de lista', () => {
    expect(precioPorCantidad(2000, [], 50).precio).toBe(2000);
    expect(precioPorCantidad(2000, null, 50).precio).toBe(2000);
  });
  it('nunca más caro que el de lista: si bajaron el precio normal, gana el menor', () => {
    expect(precioPorCantidad(1300, [{ desde: 3, precio: 1400 }], 5)).toEqual({ precio: 1300, tramo: null });
  });
  it('dos tramos con la misma cantidad (promoción sobre el precio por mayor): gana el menor', () => {
    const d = [{ desde: 3, precio: 1400 }, { desde: 3, precio: 1350, vigenteDesde: '2026-09-01', vigenteHasta: '2026-09-30' }];
    expect(precioPorCantidad(2000, d, 3, '2026-09-26').precio).toBe(1350);
    expect(precioPorCantidad(2000, d, 3, '2026-10-01').precio).toBe(1400);
  });
});

describe('precioPorCantidad — promociones con vigencia', () => {
  const promo: TramoPrecio[] = [{ desde: 1, precio: 1800, vigenteDesde: '2026-09-20', vigenteHasta: '2026-09-27' }];
  it('rige desde el primer día hasta el último, inclusive', () => {
    expect(precioPorCantidad(2000, promo, 1, '2026-09-19').precio).toBe(2000);
    expect(precioPorCantidad(2000, promo, 1, '2026-09-20').precio).toBe(1800);
    expect(precioPorCantidad(2000, promo, 1, '2026-09-27').precio).toBe(1800);
    expect(precioPorCantidad(2000, promo, 1, '2026-09-28').precio).toBe(2000);
  });
  it('sin día no se aplica una promoción con fechas (no se puede saber si rige)', () => {
    expect(precioPorCantidad(2000, promo, 1).precio).toBe(2000);
  });
  it('tramosVigentes muestra solo lo que rige, ordenado', () => {
    const todos = [...promo, { desde: 3, precio: 1400 }];
    expect(tramosVigentes(todos, '2026-09-30')).toEqual([{ desde: 3, precio: 1400 }]);
    expect(tramosVigentes(todos, '2026-09-21').map((x) => x.desde)).toEqual([1, 3]);
  });
});

describe('validarTramos', () => {
  it('acepta el ejemplo del cliente', () => {
    expect(validarTramos(CLIENTE, 2000)).toEqual([]);
  });
  it('rechaza una oferta que no es más barata que el precio normal', () => {
    expect(validarTramos([{ desde: 3, precio: 2000 }], 2000)[0].mensaje).toMatch(/menor/);
  });
  it('rechaza cantidades menores a 1 y precios no enteros o cero', () => {
    expect(validarTramos([{ desde: 0, precio: 100 }], 2000)).toHaveLength(1);
    expect(validarTramos([{ desde: 3, precio: 0 }], 2000)).toHaveLength(1);
    expect(validarTramos([{ desde: 3, precio: 99.5 }], 2000)).toHaveLength(1);
  });
  it('desde 1 sin fechas es cambiar el precio normal', () => {
    expect(validarTramos([{ desde: 1, precio: 1500 }], 2000)[0].mensaje).toMatch(/precio normal/);
  });
  it('fechas al revés y tramos repetidos', () => {
    expect(validarTramos([{ desde: 3, precio: 1000, vigenteDesde: '2026-10-01', vigenteHasta: '2026-09-01' }], 2000)).toHaveLength(1);
    expect(validarTramos([{ desde: 3, precio: 1400 }, { desde: 3, precio: 1300 }], 2000)[0].mensaje).toMatch(/Repite/);
  });
});

import { aplicarOfertas, addToCart, setQuantity, cartTotals } from '../src/cart.js';
import { construirComprobante, comprobanteATexto } from '../src/comprobante.js';

describe('el carrito con ofertas', () => {
  const jugo = { productId: 'j', name: 'Jugo', unitPrice: 2000, quantity: 1, precioLista: 2000, tramos: CLIENTE };
  it('al llegar a 3 unidades la línea entera baja a $1.400, y al volver a 2 sube', () => {
    let l = aplicarOfertas(addToCart([], jugo));
    l = aplicarOfertas(addToCart(l, jugo));
    expect(cartTotals(l).total).toBe(4000);
    l = aplicarOfertas(addToCart(l, jugo));
    expect(l[0].unitPrice).toBe(1400);
    expect(cartTotals(l).total).toBe(4200);
    l = aplicarOfertas(setQuantity(l, 'j', 2));
    expect(cartTotals(l).total).toBe(4000);
  });
  it('una línea sin precio de lista no se toca', () => {
    const fija = [{ productId: 'x', name: 'X', unitPrice: 500, quantity: 9 }];
    expect(aplicarOfertas(fija)).toBe(fija);
  });
  it('el comprobante dice cuánto se ahorró y desglosa el impuesto adicional', () => {
    const lineas = aplicarOfertas([
      { ...jugo, quantity: 3 },
      { productId: 'b', name: 'Bebida', unitPrice: 1990, quantity: 1, tasaAdicional: 18, nombreAdicional: 'IABA' },
    ]);
    const c = construirComprobante({ lineas, pagos: [{ metodo: 'efectivo', monto: 6190 }] });
    expect(c.total).toBe(6190);
    expect(c.lineas[0].ahorroOferta).toBe(1800);
    expect(c.adicionales).toHaveLength(1);
    expect(c.neto + c.iva + c.totalAdicionales).toBe(6190);
    const texto = comprobanteATexto(c);
    expect(texto).toMatch(/ahorra \$1\.800/);
    expect(texto).toMatch(/IABA 18%/);
  });
});
