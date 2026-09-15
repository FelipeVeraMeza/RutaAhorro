import { describe, it, expect } from 'vitest';
import {
  construirComprobante, comprobanteATexto, fechaComprobante, nombreMetodo,
} from '../src/comprobante.js';
import type { CartLine } from '../src/cart.js';

const linea = (id: string, price: number, qty = 1, extra: Partial<CartLine> = {}): CartLine => ({
  productId: id, name: `Producto ${id}`, unitPrice: price, quantity: qty, ...extra,
});

const efectivo = (monto: number, recibido?: number) => [
  { metodo: 'efectivo', monto, ...(recibido != null ? { recibido } : {}) },
];

describe('construcción del comprobante', () => {
  it('arma una línea por producto con su subtotal', () => {
    const c = construirComprobante({
      lineas: [linea('a', 1000, 2), linea('b', 890)],
      pagos: efectivo(2890),
    });
    expect(c.lineas).toHaveLength(2);
    expect(c.lineas[0]).toMatchObject({ cantidad: 2, precioUnitario: 1000, subtotal: 2000 });
    expect(c.total).toBe(2890);
  });

  it('descuenta por línea y global', () => {
    const c = construirComprobante({
      lineas: [linea('a', 1000, 2, { discountAmount: 200 })],
      descuentoGlobal: 300,
      pagos: efectivo(1500),
    });
    expect(c.subtotal).toBe(2000);
    expect(c.descuento).toBe(500);
    expect(c.total).toBe(1500);
  });

  it('nunca deja el total negativo aunque el descuento supere el bruto', () => {
    const c = construirComprobante({
      lineas: [linea('a', 1000)],
      descuentoGlobal: 5000,
      pagos: efectivo(0),
    });
    expect(c.total).toBe(0);
    expect(c.neto).toBe(0);
    expect(c.iva).toBe(0);
  });
});

describe('desglose de IVA', () => {
  it('extrae el IVA del total, no lo suma encima', () => {
    // $11.900 con IVA incluido → neto $10.000, IVA $1.900
    const c = construirComprobante({ lineas: [linea('a', 11900)], pagos: efectivo(11900) });
    expect(c.total).toBe(11900);
    expect(c.neto).toBe(10000);
    expect(c.iva).toBe(1900);
  });

  it('neto + IVA siempre da exactamente el total, sin un peso de diferencia', () => {
    // Esta es la invariante que importa: un descuadre de $1 en un documento de
    // venta es una observación, no un detalle de redondeo.
    for (let total = 0; total <= 5000; total++) {
      const c = construirComprobante({ lineas: [linea('a', total)], pagos: efectivo(total) });
      expect(c.neto + c.iva).toBe(c.total);
    }
  });

  it('respeta una tasa de IVA distinta a 19', () => {
    const c = construirComprobante({ lineas: [linea('a', 1000)], pagos: efectivo(1000), ivaPct: 0 });
    expect(c.iva).toBe(0);
    expect(c.neto).toBe(1000);
  });

  it('el comprobante nunca se declara documento tributario', () => {
    const c = construirComprobante({ lineas: [linea('a', 1000)], pagos: efectivo(1000) });
    expect(c.esDocumentoTributario).toBe(false);
  });
});

describe('vuelto y medios de pago', () => {
  it('calcula el vuelto cuando se paga en efectivo con más', () => {
    const c = construirComprobante({ lineas: [linea('a', 2890)], pagos: efectivo(2890, 5000) });
    expect(c.vuelto).toBe(2110);
  });

  it('no hay vuelto en débito, crédito ni transferencia', () => {
    const c = construirComprobante({
      lineas: [linea('a', 2890)],
      pagos: [{ metodo: 'debito', monto: 2890 }],
    });
    expect(c.vuelto).toBe(0);
  });

  it('el vuelto nunca es negativo si se recibió menos que el total', () => {
    const c = construirComprobante({ lineas: [linea('a', 5000)], pagos: efectivo(5000, 2000) });
    expect(c.vuelto).toBe(0);
  });

  it('traduce el medio de pago al nombre que se imprime', () => {
    expect(nombreMetodo('efectivo')).toBe('Efectivo');
    expect(nombreMetodo('transferencia')).toBe('Transferencia');
    // Un método desconocido se muestra tal cual antes que romper el ticket.
    expect(nombreMetodo('cheque')).toBe('cheque');
  });
});

describe('folio', () => {
  it('queda en null mientras la venta no se sincroniza', () => {
    const c = construirComprobante({ lineas: [linea('a', 1000)], pagos: efectivo(1000) });
    expect(c.folio).toBeNull();
  });

  it('toma el folio que asignó la base de datos', () => {
    const c = construirComprobante({ lineas: [linea('a', 1000)], pagos: efectivo(1000), folio: 1042 });
    expect(c.folio).toBe(1042);
  });
});

describe('fecha legible', () => {
  it('usa el formato chileno de día y hora', () => {
    expect(fechaComprobante('2026-09-15T20:31:00')).toBe('15-09-2026 20:31');
  });

  it('no revienta con una fecha inválida', () => {
    expect(fechaComprobante('no es fecha')).toBe('');
  });
});

describe('versión en texto para compartir', () => {
  const c = construirComprobante({
    lineas: [linea('a', 1000, 2), linea('b', 890)],
    pagos: efectivo(2890, 5000),
    folio: 42,
    local: 'Almacén RutaAhorro',
    cajero: 'María',
    fecha: '2026-09-15T20:31:00',
  });
  const texto = comprobanteATexto(c);

  it('advierte que no es un documento tributario', () => {
    expect(texto).toContain('NO ES DOCUMENTO TRIBUTARIO');
  });

  it('incluye el detalle, el desglose y el vuelto', () => {
    expect(texto).toContain('Almacén RutaAhorro');
    expect(texto).toContain('N° 42');
    expect(texto).toContain('Neto');
    expect(texto).toContain('IVA (19%)');
    expect(texto).toContain('TOTAL');
    expect(texto).toContain('Vuelto');
  });

  it('respeta el ancho del ticket en cada fila', () => {
    for (const fila of comprobanteATexto(c, 32).split('\n')) {
      expect(fila.length).toBeLessThanOrEqual(32);
    }
  });

  it('omite el descuento cuando no hay', () => {
    expect(texto).not.toContain('Descuento');
  });
});
