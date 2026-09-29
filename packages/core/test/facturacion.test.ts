import { describe, it, expect } from 'vitest';
import {
  montoLinea, resumenFactura, precioConIva, partirRut, planFacturaPortal,
} from '../src/facturacion.js';
import { cifrar, descifrar, generarLlaveCifrado, aBase64, desdeBase64 } from '../src/cifrado.js';

describe('resumenFactura', () => {
  it('suma catálogo y línea libre, y neto + IVA = total (como la base: 14.900)', () => {
    const r = resumenFactura([
      { productId: 'p', nombre: 'Pan', cantidad: 3, precio: 1000 },
      { nombre: 'Flete a domicilio', cantidad: 1, precio: 11900 },
    ]);
    expect(r.total).toBe(14900);
    expect(r.neto + r.iva).toBe(14900);
    expect(r.iva).toBe(14900 - Math.round(14900 / 1.19));
    expect(r.errores).toEqual([]);
  });

  it('decimales por kilo redondean igual que la base: 0,35 × 9.990 = 3.497', () => {
    expect(montoLinea({ nombre: 'Queso', cantidad: 0.35, precio: 9990 })).toBe(3497);
  });

  it('dice qué falta, línea por línea', () => {
    const r = resumenFactura([
      { nombre: ' ', cantidad: 1, precio: 100 },
      { nombre: 'Algo', cantidad: 0, precio: 100 },
      { nombre: 'Otra', cantidad: 1, precio: 100, descuento: 500 },
    ]);
    expect(r.errores).toEqual([
      'Línea 1: falta qué se factura',
      'Línea 2: la cantidad tiene que ser mayor que cero',
      'Línea 3: el descuento es mayor que la línea',
    ]);
    expect(resumenFactura([]).errores).toEqual(['Agrega al menos una línea']);
  });

  it('con impuesto adicional, el desglose lo separa', () => {
    const r = resumenFactura([{ nombre: 'Bebida', cantidad: 1, precio: 1370, tasaAdicional: 18, nombreAdicional: 'IABA 18%' }]);
    expect(r.totalAdicionales).toBeGreaterThan(0);
    expect(r.neto + r.iva + r.totalAdicionales).toBe(r.total);
    expect(r.iva).toBe(Math.round(r.neto * 0.19));
  });

  // El portal del SII (y cualquier DTE 33) calcula el IVA desde un neto
  // entero. Un total de $22 no existe en una factura: neto 18 → $21, neto 19 → $23.
  it('el IVA sale del neto, como en el SII: $22 con IVA se factura en $21', () => {
    const r = resumenFactura([{ nombre: 'Flete', cantidad: 1, precio: 22 }]);
    expect([r.neto, r.iva, r.total, r.ajuste]).toEqual([18, 3, 21, -1]);
  });

  it('para cualquier total, IVA = neto × 19 % redondeado, y el ajuste es de a lo más $1', () => {
    let ajustados = 0;
    for (let precio = 1; precio <= 20000; precio++) {
      const r = resumenFactura([{ nombre: 'X', cantidad: 1, precio }]);
      expect(r.iva).toBe(Math.round(r.neto * 0.19));
      expect(r.neto + r.iva).toBe(r.total);
      expect(r.total - precio).toBe(r.ajuste);
      expect(Math.abs(r.ajuste)).toBeLessThanOrEqual(1);
      if (r.ajuste) ajustados++;
    }
    expect(ajustados).toBeGreaterThan(0);
  });
});

describe('precioConIva y partirRut', () => {
  it('un flete de $10.000 + IVA son $11.900', () => {
    expect(precioConIva(10000)).toBe(11900);
    expect(precioConIva(1000, 19, 18)).toBe(1370);
  });
  it('parte el RUT en cuerpo y dígito, con o sin puntos', () => {
    expect(partirRut('76.086.428-5')).toEqual({ cuerpo: '76086428', dv: '5' });
    expect(partirRut('12345678k')).toEqual({ cuerpo: '12345678', dv: 'K' });
    expect(partirRut('')).toBeNull();
  });
});

describe('planFacturaPortal', () => {
  const r = resumenFactura([
    { nombre: 'Pan', cantidad: 3, precio: 1000 },
    { nombre: 'Flete', cantidad: 1, precio: 11900 },
  ]);

  it('reparte el neto entre las líneas y el portal suma el mismo neto', () => {
    const plan = planFacturaPortal(
      [{ nombre: 'Pan', cantidad: 3, monto: 3000, unidad: 'unidad' }, { nombre: 'Flete', cantidad: 1, monto: 11900 }],
      r.neto, r.iva, r.total);
    const netoPortal = plan.lineas.reduce((s, l) => s + Math.round(Number(l.cantidad) * Number(l.precioNeto)), 0);
    expect(netoPortal).toBe(r.neto);
    expect(plan.lineas[0].unidad).toBe('UN');
    expect(plan.lineas[0].cantidad).toBe('3');
  });

  it('con 200 facturas al azar, cada línea del portal vuelve a su neto exacto', () => {
    for (let k = 0; k < 200; k++) {
      const lineas = Array.from({ length: 1 + (k % 7) }, (_, i) => ({
        nombre: `L${i}`, cantidad: 1 + ((k * 7 + i * 3) % 13), precio: 50 + ((k * 131 + i * 977) % 20000),
      }));
      const res = resumenFactura(lineas);
      const plan = planFacturaPortal(lineas.map((l) => ({ ...l, monto: montoLinea(l) })), res.neto, res.iva, res.total);
      for (const l of plan.lineas) expect(Math.round(Number(l.cantidad) * Number(l.precioNeto))).toBe(l.netoLinea);
      expect(plan.lineas.reduce((s, l) => s + l.netoLinea, 0)).toBe(res.neto);
    }
  });

  it('una factura con ajuste del IVA también se puede emitir, y el portal llega a su total', () => {
    const r = resumenFactura([{ nombre: 'Flete', cantidad: 1, precio: 22 }, { nombre: 'Pan', cantidad: 3, precio: 1000 }]);
    const plan = planFacturaPortal(
      [{ nombre: 'Flete', cantidad: 1, monto: 22 }, { nombre: 'Pan', cantidad: 3, monto: 3000 }], r.neto, r.iva, r.total);
    const neto = plan.lineas.reduce((s, l) => s + Math.round(Number(l.cantidad) * Number(l.precioNeto)), 0);
    expect(neto + Math.round(neto * 0.19)).toBe(r.total);
  });

  it('no arma el plan de una factura con impuesto adicional ni con montos que no cuadran', () => {
    expect(() => planFacturaPortal([{ nombre: 'Bebida', cantidad: 1, monto: 1370, tasa: 18 }], 1000, 190, 1370))
      .toThrow('PORTAL_SIN_IMPUESTO_ADICIONAL');
    expect(() => planFacturaPortal([{ nombre: 'Pan', cantidad: 1, monto: 1000 }], 840, 159, 1000))
      .toThrow('PORTAL_MONTOS_NO_CUADRAN');
    // Cuadra la suma, pero el portal calcularía 160 de IVA: no se manda.
    expect(() => planFacturaPortal([{ nombre: 'Pan', cantidad: 1, monto: 999 }], 840, 159, 999))
      .toThrow('PORTAL_MONTOS_NO_CUADRAN');
  });
});

describe('cifrado de las credenciales del SII', () => {
  it('ida y vuelta, con tildes y símbolos', async () => {
    const llave = generarLlaveCifrado();
    const c = await cifrar('Clave#Ñandú 2026', llave);
    expect(c).toMatch(/^v1:/);
    expect(c).not.toContain('Ñandú');
    expect(await descifrar(c, llave)).toBe('Clave#Ñandú 2026');
  });

  it('cada cifrado es distinto aunque el texto sea el mismo', async () => {
    const llave = generarLlaveCifrado();
    expect(await cifrar('x', llave)).not.toBe(await cifrar('x', llave));
  });

  it('otra llave o un texto alterado fallan, no devuelven basura', async () => {
    const llave = generarLlaveCifrado();
    const c = await cifrar('secreto', llave);
    await expect(descifrar(c, generarLlaveCifrado())).rejects.toThrow('CIFRADO_INVALIDO');
    // Con la llave correcta, pero un byte cambiado: GCM lo detecta.
    const [v, iv, d] = c.split(':');
    const bytes = desdeBase64(d);
    bytes[0] ^= 1;
    await expect(descifrar(`${v}:${iv}:${aBase64(bytes)}`, llave)).rejects.toThrow('CIFRADO_INVALIDO');
  });

  it('una llave que no es de 32 bytes se rechaza', async () => {
    await expect(cifrar('x', aBase64(new Uint8Array(16)))).rejects.toThrow('LLAVE_CIFRADO_INVALIDA');
  });

  it('base64 igual al de Node', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
      const b = aBase64(bytes);
      expect(b).toBe(Buffer.from(bytes).toString('base64'));
      expect([...desdeBase64(b)]).toEqual([...bytes]);
    }
  });
});
