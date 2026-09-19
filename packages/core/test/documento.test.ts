import { describe, it, expect } from 'vitest';
import {
  documentoPorOmision, documentosDisponibles, validarDocumento,
  normalizarReceptor, pagadaConTarjeta, NOMBRE_DOCUMENTO,
  type DocumentoVenta,
} from '../src/documento.js';
import { construirComprobante, comprobanteATexto } from '../src/comprobante.js';
import type { CartLine } from '../src/cart.js';

const efectivo = [{ metodo: 'efectivo', monto: 1000 }];
const transferencia = [{ metodo: 'transferencia', monto: 1000 }];
const debito = [{ metodo: 'debito', monto: 1000 }];
const credito = [{ metodo: 'credito', monto: 1000 }];

const receptor = { rut: '76.086.428-5', razonSocial: 'Comercial Los Andes SpA' };

describe('qué documento corresponde según el medio de pago', () => {
  it('efectivo y transferencia van con boleta', () => {
    expect(documentoPorOmision(efectivo)).toBe('boleta');
    expect(documentoPorOmision(transferencia)).toBe('boleta');
  });

  it('con tarjeta el documento lo emite la máquina', () => {
    expect(documentoPorOmision(debito)).toBe('voucher');
    expect(documentoPorOmision(credito)).toBe('voucher');
  });

  it('un local con máquina no integrada sí emite la boleta', () => {
    expect(documentoPorOmision(debito, { tarjetaEmiteDocumento: false })).toBe('boleta');
    expect(documentosDisponibles(debito, { tarjetaEmiteDocumento: false }))
      .toEqual(['boleta', 'factura']);
  });

  it('la factura se puede elegir con cualquier medio de pago', () => {
    for (const pagos of [efectivo, transferencia, debito, credito]) {
      expect(documentosDisponibles(pagos)).toContain('factura');
    }
  });

  it('acepta los pagos escritos como los manda la pantalla o la cola', () => {
    expect(pagadaConTarjeta([{ method: 'debito', amount: 1000 } as never])).toBe(true);
    expect(pagadaConTarjeta(efectivo)).toBe(false);
  });
});

describe('validación del documento', () => {
  it('no deja emitir boleta por una venta con tarjeta', () => {
    const r = validarDocumento({ tipo: 'boleta' }, debito);
    expect(r.valido).toBe(false);
    // El mensaje le dice al cajero qué hacer, no qué regla se rompió.
    expect(r.valido === false && r.error).toMatch(/máquina/);
  });

  it('no deja emitir voucher por una venta sin tarjeta', () => {
    const r = validarDocumento({ tipo: 'voucher' }, efectivo);
    expect(r.valido).toBe(false);
  });

  it('la boleta con efectivo no pide nada más', () => {
    expect(validarDocumento({ tipo: 'boleta' }, efectivo).valido).toBe(true);
  });

  it('la factura exige RUT y razón social', () => {
    expect(validarDocumento({ tipo: 'factura' }, efectivo).valido).toBe(false);
    expect(validarDocumento({ tipo: 'factura', receptor: { rut: '76.086.428-5', razonSocial: '  ' } }, efectivo).valido).toBe(false);
    expect(validarDocumento({ tipo: 'factura', receptor: { rut: '1-9', razonSocial: 'Ana' } }, efectivo).valido).toBe(false);
    expect(validarDocumento({ tipo: 'factura', receptor }, efectivo).valido).toBe(true);
  });

  it('rechaza un RUT con dígito verificador equivocado', () => {
    const r = validarDocumento({ tipo: 'factura', receptor: { ...receptor, rut: '76.086.428-4' } }, efectivo);
    expect(r.valido).toBe(false);
    expect(r.valido === false && r.error).toMatch(/RUT/);
  });

  it('la factura con tarjeta es válida: la máquina no emite facturas', () => {
    expect(validarDocumento({ tipo: 'factura', receptor }, credito).valido).toBe(true);
  });
});

describe('normalizar el receptor', () => {
  it('formatea el RUT y descarta los campos vacíos', () => {
    const r = normalizarReceptor({ rut: '760864285', razonSocial: '  Los Andes  ', giro: '  ', direccion: 'Av. Siempre Viva 742' });
    expect(r.rut).toBe('76.086.428-5');
    expect(r.razonSocial).toBe('Los Andes');
    expect(r.giro).toBeUndefined();
    expect(r.direccion).toBe('Av. Siempre Viva 742');
  });
});

describe('el documento en el comprobante', () => {
  const lineas: CartLine[] = [{ productId: 'a', name: 'Coca-Cola 1.5L', unitPrice: 1990, quantity: 1 }];

  it('se deduce del pago cuando la pantalla no lo manda', () => {
    expect(construirComprobante({ lineas, pagos: debito }).documento.tipo).toBe('voucher');
    expect(construirComprobante({ lineas, pagos: efectivo }).documento.tipo).toBe('boleta');
  });

  it('el papel dice qué documento corresponde, y que él no lo es', () => {
    const texto = comprobanteATexto(construirComprobante({ lineas, pagos: efectivo }));
    expect(texto).toContain('NO ES DOCUMENTO TRIBUTARIO');
    expect(texto).toContain('Corresponde boleta');
  });

  it('con tarjeta avisa que el documento sale de la máquina', () => {
    const texto = comprobanteATexto(construirComprobante({ lineas, pagos: debito }));
    expect(texto).toContain('EL DOCUMENTO LO EMITE LA MÁQUINA');
  });

  it('la factura imprime los datos del receptor', () => {
    const documento: DocumentoVenta = { tipo: 'factura', receptor: { ...receptor, giro: 'Comercio', direccion: 'Av. Siempre Viva 742' } };
    const texto = comprobanteATexto(construirComprobante({ lineas, pagos: efectivo, documento }));
    expect(texto).toContain('Factura a: Comercial Los Andes SpA');
    expect(texto).toContain('RUT: 76.086.428-5');
    expect(texto).toContain('Giro: Comercio');
    expect(texto).toContain('Dirección: Av. Siempre Viva 742');
  });

  it('ningún papel se llama boleta ni factura mientras no haya timbre del SII', () => {
    for (const documento of [{ tipo: 'boleta' as const }, { tipo: 'factura' as const, receptor }]) {
      const c = construirComprobante({ lineas, pagos: efectivo, documento });
      expect(c.esDocumentoTributario).toBe(false);
      expect(comprobanteATexto(c)).toContain('COMPROBANTE INTERNO');
    }
  });

  it('cada tipo tiene un nombre en español', () => {
    expect(Object.values(NOMBRE_DOCUMENTO).every((n) => n.length > 0)).toBe(true);
  });
});
