import { describe, it, expect } from 'vitest';
import {
  cartTotals, addToCart, setQuantity, removeFromCart, lineSubtotal,
  isDiscountAllowed, insufficientStock, estimatedProfit, type CartLine,
} from '../src/cart.js';

const linea = (id: string, price: number, qty = 1, extra: Partial<CartLine> = {}): CartLine => ({
  productId: id, name: `Producto ${id}`, unitPrice: price, quantity: qty, ...extra,
});

describe('totales del carrito', () => {
  it('suma precio por cantidad', () => {
    const t = cartTotals([linea('a', 1990, 2), linea('b', 3470, 1)]);
    expect(t.subtotal).toBe(7450);
    expect(t.total).toBe(7450);
    expect(t.itemCount).toBe(2);
    expect(t.unitCount).toBe(3);
  });

  it('descuenta por línea y global', () => {
    const t = cartTotals([linea('a', 1000, 2, { discountAmount: 200 })], 300);
    expect(t.subtotal).toBe(2000);
    expect(t.discountTotal).toBe(500);
    expect(t.total).toBe(1500);
  });

  it('nunca da un total negativo', () => {
    const t = cartTotals([linea('a', 1000, 1)], 5000);
    expect(t.total).toBe(0);
  });

  it('el carrito vacío da cero', () => {
    expect(cartTotals([]).total).toBe(0);
  });

  it('maneja cantidades decimales (venta por peso)', () => {
    const t = cartTotals([linea('granel', 3990, 0.25)]);
    expect(t.total).toBe(998);
  });
});

describe('lineSubtotal', () => {
  it('un descuento mayor al precio no regala plata', () => {
    expect(lineSubtotal(linea('a', 1000, 1, { discountAmount: 5000 }))).toBe(0);
  });
});

describe('agregar al carrito', () => {
  it('escanear dos veces el mismo producto suma cantidad, no duplica la línea', () => {
    // US-14: "Cuando escaneo dos veces el mismo producto, la línea muestra
    // cantidad 2, no dos líneas separadas"
    let carrito = addToCart([], linea('a', 1990));
    carrito = addToCart(carrito, linea('a', 1990));
    expect(carrito).toHaveLength(1);
    expect(carrito[0].quantity).toBe(2);
  });

  it('productos distintos crean líneas distintas', () => {
    let carrito = addToCart([], linea('a', 1990));
    carrito = addToCart(carrito, linea('b', 990));
    expect(carrito).toHaveLength(2);
  });

  it('no muta el arreglo original', () => {
    const original = [linea('a', 1990)];
    addToCart(original, linea('b', 990));
    expect(original).toHaveLength(1);
  });
});

describe('modificar el carrito', () => {
  it('cambia la cantidad', () => {
    const c = setQuantity([linea('a', 1990, 1)], 'a', 5);
    expect(c[0].quantity).toBe(5);
  });

  it('cantidad cero elimina la línea', () => {
    expect(setQuantity([linea('a', 1990, 1)], 'a', 0)).toHaveLength(0);
  });

  it('elimina por id', () => {
    expect(removeFromCart([linea('a', 1), linea('b', 2)], 'a').map((l) => l.productId))
      .toEqual(['b']);
  });
});

describe('límite de descuento por rol', () => {
  it('el vendedor no puede descontar nada por defecto', () => {
    expect(isDiscountAllowed(100, 10000, 'vendedor')).toBe(false);
    expect(isDiscountAllowed(0, 10000, 'vendedor')).toBe(true);
  });

  it('el supervisor puede hasta 10 %', () => {
    expect(isDiscountAllowed(1000, 10000, 'supervisor')).toBe(true);
    expect(isDiscountAllowed(1500, 10000, 'supervisor')).toBe(false);
  });

  it('el admin no tiene tope', () => {
    expect(isDiscountAllowed(10000, 10000, 'admin')).toBe(true);
  });

  it('tolera el redondeo de un 10 % sobre un precio impar', () => {
    // 10 % de $1.999 = 199,9 -> $200 = 10,005 %. Rechazarlo sería incomprensible.
    expect(isDiscountAllowed(200, 1999, 'supervisor')).toBe(true);
  });

  it('respeta los topes configurados del tenant', () => {
    expect(isDiscountAllowed(2000, 10000, 'vendedor', { vendedor: 25 })).toBe(true);
  });
});

describe('stock insuficiente', () => {
  it('informa las líneas sin stock sin bloquear la venta', () => {
    const c = [
      linea('a', 1000, 5, { stockAvailable: 2 }),
      linea('b', 1000, 1, { stockAvailable: 10 }),
      linea('c', 1000, 1),
    ];
    expect(insufficientStock(c).map((l) => l.productId)).toEqual(['a']);
  });
});

describe('utilidad estimada', () => {
  it('resta el costo del subtotal', () => {
    expect(estimatedProfit([linea('a', 1990, 2, { unitCost: 1200 })])).toBe(1580);
  });
});
