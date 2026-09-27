import { describe, it, expect } from 'vitest';
import {
  construirTed, construirXmlDte, validarDte, netosPorLinea, montosDevolucion, rutXml,
  RUT_CONSUMIDOR_FINAL, type DocumentoDte,
} from '../src/dte.js';
import { desglosarImpuestos } from '../src/impuestos.js';

const EMISOR = {
  rut: '76.086.428-5', razonSocial: 'Comercial RutaAhorro SpA', giro: 'Almacén de abarrotes',
  acteco: 471100, direccion: 'Av. Siempre Viva 123', comuna: 'Santiago', ciudad: 'Santiago',
};

function boleta(extra: Partial<DocumentoDte> = {}): DocumentoDte {
  const lineas = [
    { nombre: 'Jugo & néctar <1L>', cantidad: 3, precio: 1400, descuento: 0, monto: 4200 },
    { nombre: 'Bebida', cantidad: 1, precio: 1990, descuento: 0, monto: 1990, codigoImpuesto: 271, tasaImpuesto: 18 },
  ];
  const d = desglosarImpuestos(lineas.map((l) => ({ subtotal: l.monto, tasaAdicional: l.tasaImpuesto ?? 0 })), 19);
  return {
    tipo: 39, folio: 123, fechaEmision: '2026-09-26', timbradoEn: '2026-09-26T23:10:00.000Z',
    ambiente: 'simulacion', emisor: EMISOR, receptor: null, detalle: lineas,
    neto: d.neto, exento: 0, iva: d.iva, ivaPct: 19,
    impuestos: d.adicionales.map((a) => ({ codigoSii: 271, tasa: a.tasa, monto: a.monto })),
    total: d.total, ...extra,
  };
}

describe('rutXml', () => {
  it('sin puntos y con guion', () => {
    expect(rutXml('76.086.428-5')).toBe('76086428-5');
    expect(rutXml('12345678k')).toBe('12345678-K');
  });
});

describe('construirTed', () => {
  it('lleva los datos que el SII verifica y dice SIMULADO donde iría la firma', () => {
    const ted = construirTed(boleta());
    expect(ted).toMatch(/^<TED version="1.0"><DD>/);
    expect(ted).toContain('<RE>76086428-5</RE><TD>39</TD><F>123</F><FE>2026-09-26</FE>');
    expect(ted).toContain(`<RR>${RUT_CONSUMIDOR_FINAL}</RR>`);
    expect(ted).toContain('<MNT>6190</MNT>');
    expect(ted).toContain('<IT1>Jugo &amp; néctar &lt;1L&gt;</IT1>');
    expect(ted).toMatch(/<FRMT algoritmo="SHA1withRSA">SIMULADO-[0-9A-F]{8}<\/FRMT>/);
  });
  it('el timbre cambia si cambia el documento', () => {
    expect(construirTed(boleta())).not.toBe(construirTed(boleta({ folio: 124 })));
  });
  it('IT1 y RSR no pasan de 40 caracteres', () => {
    const ted = construirTed(boleta({ detalle: [{ nombre: 'x'.repeat(90), cantidad: 1, precio: 6190, descuento: 0, monto: 6190 }] }));
    expect(ted).toContain(`<IT1>${'x'.repeat(40)}</IT1>`);
  });
});

describe('construirXmlDte', () => {
  it('boleta: montos con IVA incluido, IndServicio y el IABA en ImptoReten', () => {
    const xml = construirXmlDte(boleta());
    expect(xml).toContain('<Documento ID="F123T39">');
    expect(xml).toContain('<TipoDTE>39</TipoDTE><Folio>123</Folio>');
    expect(xml).toContain('<IndServicio>3</IndServicio>');
    expect(xml).toContain('<RznSocEmisor>Comercial RutaAhorro SpA</RznSocEmisor>');
    expect(xml).toContain('<MontoItem>4200</MontoItem>');
    expect(xml).toMatch(/<ImptoReten><TipoImp>271<\/TipoImp><TasaImp>18<\/TasaImp><MontoImp>\d+<\/MontoImp><\/ImptoReten>/);
    expect(xml).toContain('<MntTotal>6190</MntTotal>');
    expect(xml).toContain('<TED version="1.0">');
  });
  it('factura: montos netos por línea que suman exactamente el neto, y el receptor', () => {
    const doc = boleta({ tipo: 33, receptor: { rut: '76.086.428-5', razonSocial: 'Cliente Ltda', giro: 'Comercio', direccion: 'Calle 1' } });
    const xml = construirXmlDte(doc);
    const montos = [...xml.matchAll(/<MontoItem>(\d+)<\/MontoItem>/g)].map((m) => Number(m[1]));
    expect(montos.reduce((s, x) => s + x, 0)).toBe(doc.neto);
    expect(xml).toContain('<RznSoc>Comercial RutaAhorro SpA</RznSoc>');
    expect(xml).toContain('<RUTRecep>76086428-5</RUTRecep><RznSocRecep>Cliente Ltda</RznSocRecep>');
    expect(xml).toContain('<CodImpAdic>271</CodImpAdic>');
    expect(xml).toContain('<TasaIVA>19</TasaIVA>');
  });
  it('nota de crédito: lleva la referencia al documento que corrige', () => {
    const nc = boleta({ tipo: 61, referencia: { tipo: 39, folio: 123, fecha: '2026-09-26', codigo: 3, razon: 'Devolución parcial' } });
    const xml = construirXmlDte(nc);
    expect(xml).toContain('<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>39</TpoDocRef><FolioRef>123</FolioRef>');
    expect(xml).toContain('<CodRef>3</CodRef>');
  });
});

describe('validarDte', () => {
  it('un documento bien armado no tiene errores', () => {
    expect(validarDte(boleta())).toEqual([]);
  });
  it('detecta montos que no cuadran, factura sin receptor y NC sin referencia', () => {
    expect(validarDte(boleta({ iva: 1 }))[0]).toMatch(/≠ total/);
    expect(validarDte(boleta({ tipo: 33 }))).toContain('una factura necesita receptor');
    expect(validarDte(boleta({ tipo: 61 }))).toContain('una nota de crédito necesita referencia');
  });
  it('netosPorLinea cuadra con el neto en miles de documentos al azar', () => {
    let s = 3;
    const azar = (n: number) => { s = (s * 48271) % 2147483647; return s % n; };
    for (let k = 0; k < 2000; k++) {
      const lineas = Array.from({ length: 1 + azar(5) }, () => {
        const monto = 1 + azar(30000);
        const tasa = [0, 0, 10, 18, 31.5][azar(5)];
        return { nombre: 'x', cantidad: 1, precio: monto, descuento: 0, monto, tasaImpuesto: tasa };
      });
      const d = desglosarImpuestos(lineas.map((l) => ({ subtotal: l.monto, tasaAdicional: l.tasaImpuesto })), 19);
      const doc = boleta({ tipo: 33, detalle: lineas, neto: d.neto, iva: d.iva, total: d.total });
      expect(netosPorLinea(doc).reduce((a, b) => a + b, 0)).toBe(d.neto);
    }
  });
});

describe('montosDevolucion', () => {
  const lineas = [
    { id: 'a', cantidad: 3, subtotal: 4200, devuelto: 0 },
    { id: 'b', cantidad: 1, subtotal: 1990, devuelto: 0 },
  ];
  it('devuelve lo que se pagó por unidad', () => {
    expect(montosDevolucion(lineas, 6190, 0, [{ id: 'a', cantidad: 1 }])).toEqual([{ id: 'a', cantidad: 1, monto: 1400 }]);
  });
  it('con descuento a la venta completa, se devuelve la parte proporcional', () => {
    // Venta de $6.190 con $619 de descuento: se cobró $5.571.
    const r = montosDevolucion(lineas, 5571, 0, [{ id: 'b', cantidad: 1 }]);
    expect(r[0].monto).toBe(Math.round(1990 * 5571 / 6190));
  });
  it('varias devoluciones parciales suman exactamente el total cobrado', () => {
    const total = 5571;
    const r1 = montosDevolucion(lineas, total, 0, [{ id: 'a', cantidad: 1 }]);
    const l2 = lineas.map((l) => (l.id === 'a' ? { ...l, devuelto: 1 } : l));
    const r2 = montosDevolucion(l2, total, r1[0].monto, [{ id: 'a', cantidad: 2 }, { id: 'b', cantidad: 1 }]);
    expect(r1[0].monto + r2.reduce((s, x) => s + x.monto, 0)).toBe(total);
  });
  it('no deja devolver más de lo vendido ni una línea de otra venta', () => {
    expect(() => montosDevolucion(lineas, 6190, 0, [{ id: 'a', cantidad: 4 }])).toThrow('CANTIDAD_A_DEVOLVER_INVALIDA');
    expect(() => montosDevolucion(lineas, 6190, 0, [{ id: 'z', cantidad: 1 }])).toThrow('LINEA_NO_ES_DE_LA_VENTA');
    const ya = lineas.map((l) => ({ ...l, devuelto: l.cantidad }));
    expect(() => montosDevolucion(ya, 6190, 6190, [{ id: 'b', cantidad: 1 }])).toThrow('CANTIDAD_A_DEVOLVER_INVALIDA');
  });
});
