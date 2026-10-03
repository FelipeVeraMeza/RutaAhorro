import { describe, it, expect } from 'vitest';
import { calcularCombos, validarCombo, type Combo } from '../src/combos.js';
import { aplicarCombos, aplicarOfertas, cartTotals, lineSubtotal } from '../src/cart.js';
import { construirComprobante, comprobanteATexto } from '../src/comprobante.js';

// «2 bebidas + 1 pan por $3.000»: por separado, 2 × $1.200 + $1.000 = $3.400.
const COMBO: Combo = { id: 'c1', nombre: 'Once', precio: 3000, items: [{ productId: 'beb', cantidad: 2 }, { productId: 'pan', cantidad: 1 }] };
const linea = (productId: string, quantity: number, unitPrice: number) =>
  ({ productId, name: productId, quantity, unitPrice, precioLista: unitPrice });

describe('calcularCombos', () => {
  it('se aplica las veces que cabe y reparte el ahorro en pesos enteros', () => {
    const r = calcularCombos([{ productId: 'beb', cantidad: 5, precio: 1200 }, { productId: 'pan', cantidad: 3, precio: 1000 }], [COMBO]);
    expect(r).toHaveLength(1);
    expect(r[0].veces).toBe(2); // 5 bebidas alcanzan para 2 combos
    expect(r[0].ahorro).toBe(800);
    expect(r[0].porProducto.beb + r[0].porProducto.pan).toBe(800);
  });
  it('sin todos sus productos, no se aplica', () => {
    expect(calcularCombos([{ productId: 'beb', cantidad: 2, precio: 1200 }], [COMBO])).toEqual([]);
    expect(calcularCombos([{ productId: 'beb', cantidad: 1, precio: 1200 }, { productId: 'pan', cantidad: 1, precio: 1000 }], [COMBO])).toEqual([]);
  });
  it('no se suma a otra rebaja: si la línea ya está más barata que el combo, no ahorra nada', () => {
    // Con precio de cliente, 2 × $1.000 + $900 = $2.900: el combo de $3.000 no conviene.
    expect(calcularCombos([{ productId: 'beb', cantidad: 2, precio: 1000 }, { productId: 'pan', cantidad: 1, precio: 900 }], [COMBO])).toEqual([]);
  });
  it('entre dos combos que compiten por el mismo producto, primero el que más ahorra', () => {
    const otro: Combo = { id: 'c2', nombre: 'Pan y queso', precio: 2500, items: [{ productId: 'pan', cantidad: 1 }, { productId: 'queso', cantidad: 1 }] };
    const r = calcularCombos([
      { productId: 'beb', cantidad: 2, precio: 1200 }, { productId: 'pan', cantidad: 1, precio: 1000 },
      { productId: 'queso', cantidad: 1, precio: 2000 },
    ], [COMBO, otro]);
    // Pan y queso ahorra $500; la once, $400. El único pan va al de $500.
    expect(r.map((x) => x.comboId)).toEqual(['c2']);
  });
  it('respeta las fechas', () => {
    const promo = { ...COMBO, vigenteDesde: '2026-10-01', vigenteHasta: '2026-10-07' };
    const ls = [{ productId: 'beb', cantidad: 2, precio: 1200 }, { productId: 'pan', cantidad: 1, precio: 1000 }];
    expect(calcularCombos(ls, [promo], '2026-09-30')).toEqual([]);
    expect(calcularCombos(ls, [promo], '2026-10-01')).toHaveLength(1);
    expect(calcularCombos(ls, [promo])).toEqual([]);
  });
  it('con kilos: 0,3 kg × 3 no se pierde por el punto flotante', () => {
    const kilos: Combo = { id: 'k', nombre: 'Asado', precio: 9000, items: [{ productId: 'carne', cantidad: 0.3 }, { productId: 'carbon', cantidad: 1 }] };
    const r = calcularCombos([{ productId: 'carne', cantidad: 0.9, precio: 20000 }, { productId: 'carbon', cantidad: 3, precio: 4000 }], [kilos]);
    expect(r[0].veces).toBe(3);
  });
});

describe('el carrito con combos', () => {
  it('el total baja lo que ahorra el combo y la línea dice cuál es', () => {
    let l = aplicarOfertas([linea('beb', 2, 1200), linea('pan', 1, 1000)]);
    l = aplicarCombos(l, [COMBO]);
    expect(cartTotals(l).total).toBe(3000);
    expect(l.find((x) => x.productId === 'beb')!.comboNombre).toBe('Once');
    expect(l.reduce((s, x) => s + lineSubtotal(x), 0)).toBe(3000);
  });
  it('al quitar el pan, el combo se va', () => {
    let l = aplicarCombos([linea('beb', 2, 1200), linea('pan', 1, 1000)], [COMBO]);
    l = aplicarCombos(l.filter((x) => x.productId !== 'pan'), [COMBO]);
    expect(cartTotals(l).total).toBe(2400);
    expect(l[0].descuentoCombo).toBe(0);
  });
  it('el comprobante dice el combo y cuadra neto + IVA = total', () => {
    const l = aplicarCombos([linea('beb', 2, 1200), linea('pan', 1, 1000)], [COMBO]);
    const c = construirComprobante({ lineas: l, pagos: [{ metodo: 'efectivo', monto: 3000 }] });
    expect(c.total).toBe(3000);
    expect(c.neto + c.iva).toBe(3000);
    expect(comprobanteATexto(c)).toMatch(/combo Once/);
  });
});

describe('validarCombo', () => {
  const precio = (id: string) => ({ beb: 1200, pan: 1000 } as Record<string, number>)[id];
  it('acepta el combo del ejemplo', () => {
    expect(validarCombo(COMBO, precio)).toBeNull();
  });
  it('rechaza lo que no es un combo', () => {
    expect(validarCombo({ ...COMBO, items: [{ productId: 'beb', cantidad: 3 }] }, precio)).toMatch(/dos productos/);
    expect(validarCombo({ ...COMBO, precio: 3400 }, precio)).toMatch(/menos que sus productos/);
    expect(validarCombo({ ...COMBO, nombre: ' ' }, precio)).toMatch(/nombre/);
    expect(validarCombo({ ...COMBO, items: [...COMBO.items, { productId: 'pan', cantidad: 1 }] }, precio)).toMatch(/repetido/);
  });
});

describe('validarCombo · por unidad (8ª ronda)', () => {
  const precio = (id: string) => ({ beb: 1200, pan: 1000 } as Record<string, number>)[id];
  it('rechaza "1,5 × Pan"', () => {
    expect(validarCombo({ ...COMBO, items: [{ productId: 'beb', cantidad: 2 }, { productId: 'pan', cantidad: 1.5 }] }, precio))
      .toMatch(/por unidad/);
  });
});
