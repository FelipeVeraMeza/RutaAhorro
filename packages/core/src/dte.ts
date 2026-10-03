/**
 * Documento tributario electrónico (DTE): boleta (39), factura (33) y nota de
 * crédito (61). F5 de docs/18 · ADR-009 (simulador primero).
 *
 * La base de datos decide QUÉ se emite y lo registra en la misma transacción
 * que la venta: tipo, folio, montos, detalle, receptor (`dte_documentos`,
 * migración 0019). Este módulo arma, a partir de ese registro:
 *
 *   · el **XML del DTE** con la estructura del formato del SII, y
 *   · el **timbre electrónico (TED)**, que va impreso como PDF417.
 *
 * **En simulación el timbre NO está firmado.** La firma del TED usa la llave
 * privada del CAF que el SII le entrega al contribuyente, y la del documento
 * usa su certificado digital (B-04, B-05). Sin esos dos, lo que sale de acá
 * tiene la forma exacta de un DTE, dice SIMULADO donde iría la firma, y el
 * papel dice que no tiene validez tributaria. El día que lleguen, cambia el
 * emisor (quien firma y envía), no este armado.
 *
 * La estructura se escribió desde el formato publicado por el SII; **se
 * valida contra el esquema oficial en la certificación (T-32)**, no antes.
 */
import { clp } from './money.js';

export type TipoDte = 33 | 39 | 61;

export const NOMBRE_DTE: Record<TipoDte, string> = {
  33: 'Factura electrónica',
  39: 'Boleta electrónica',
  61: 'Nota de crédito electrónica',
};

export type AmbienteDte = 'simulacion' | 'certificacion' | 'produccion';

export interface EmisorDte {
  rut: string;
  razonSocial: string;
  giro: string;
  acteco?: number | null;
  direccion: string;
  comuna: string;
  ciudad?: string | null;
}

export interface ReceptorDte {
  rut: string;
  razonSocial: string;
  giro?: string | null;
  direccion?: string | null;
}

export interface LineaDte {
  nombre: string;
  cantidad: number;
  /** Precio unitario con IVA (y adicional) incluido, como se cobró. */
  precio: number;
  descuento: number;
  /** Monto de la línea con impuestos incluidos: cantidad × precio − descuento. */
  monto: number;
  /** Código SII del impuesto adicional de la línea, si tiene. */
  codigoImpuesto?: number | null;
  tasaImpuesto?: number | null;
}

export interface ImpuestoDte {
  codigoSii: number | null;
  tasa: number;
  monto: number;
}

export interface ReferenciaDte {
  tipo: number;
  folio: number | null;
  fecha: string | null;
  /** 1 = anula el documento, 3 = corrige montos (devolución parcial). */
  codigo: 1 | 2 | 3;
  razon: string;
}

export interface DocumentoDte {
  tipo: TipoDte;
  folio: number;
  /** Día del local, 'AAAA-MM-DD'. */
  fechaEmision: string;
  /** Instante de la firma (o de la simulación), ISO. */
  timbradoEn: string;
  ambiente: AmbienteDte;
  emisor: EmisorDte;
  receptor: ReceptorDte | null;
  detalle: LineaDte[];
  neto: number;
  exento: number;
  iva: number;
  ivaPct: number;
  impuestos: ImpuestoDte[];
  total: number;
  referencia?: ReferenciaDte | null;
}

/** RUT sin puntos y con guion, como lo pide el XML: 76086428-5. */
export function rutXml(rut: string): string {
  const limpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  return limpio.length < 2 ? limpio : `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

/** Receptor genérico de una boleta sin datos del comprador. */
export const RUT_CONSUMIDOR_FINAL = '66666666-6';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const t = (tag: string, v: string | number | null | undefined, largo?: number) => {
  if (v === null || v === undefined || v === '') return '';
  const s = typeof v === 'number' ? String(v) : esc(largo ? v.slice(0, largo) : v);
  return `<${tag}>${s}</${tag}>`;
};
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6));

/**
 * Hash no criptográfico (FNV-1a de 32 bits), en hexadecimal. Solo para que el
 * timbre simulado cambie cuando cambia el documento; no es una firma y no lo
 * pretende.
 */
function huella(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').toUpperCase();
}

/** El receptor que va en el documento y en el timbre. */
function receptorDe(doc: DocumentoDte): ReceptorDte {
  return doc.receptor ?? { rut: RUT_CONSUMIDOR_FINAL, razonSocial: 'CONSUMIDOR FINAL' };
}

/**
 * El timbre electrónico (TED): lo que va codificado en el PDF417.
 *
 * `DD` son los datos del documento que el SII verifica; `CAF` es la
 * autorización de folios; `FRMT` es la firma de `DD` con la llave del CAF.
 * En simulación el CAF es ficticio y `FRMT` dice SIMULADO.
 */
export function construirTed(doc: DocumentoDte): string {
  const rec = receptorDe(doc);
  const primer = doc.detalle[0]?.nombre ?? '';
  const caf = doc.ambiente === 'simulacion'
    ? `<CAF version="1.0"><DA>${t('RE', rutXml(doc.emisor.rut))}${t('RS', doc.emisor.razonSocial, 40)}${t('TD', doc.tipo)}` +
      `<RNG><D>${doc.folio}</D><H>${doc.folio}</H></RNG>${t('FA', doc.fechaEmision)}<IDK>0</IDK></DA>` +
      `<FRMA algoritmo="SHA1withRSA">SIMULADO</FRMA></CAF>`
    : '';
  const dd =
    `<DD>${t('RE', rutXml(doc.emisor.rut))}${t('TD', doc.tipo)}${t('F', doc.folio)}${t('FE', doc.fechaEmision)}` +
    `${t('RR', rutXml(rec.rut))}${t('RSR', rec.razonSocial, 40)}${t('MNT', doc.total)}${t('IT1', primer, 40)}` +
    `${caf}${t('TSTED', doc.timbradoEn.slice(0, 19))}</DD>`;
  const firma = doc.ambiente === 'simulacion' ? `SIMULADO-${huella(dd)}` : '';
  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${firma}</FRMT></TED>`;
}

/**
 * Montos netos por línea para la factura, donde cada `MontoItem` va sin IVA.
 * La suma tiene que dar exactamente el neto del documento: se redondea cada
 * línea y el peso que sobra se ajusta en la línea más grande.
 */
export function netosPorLinea(doc: DocumentoDte): number[] {
  const netos = doc.detalle.map((l) =>
    clp(l.monto / (1 + doc.ivaPct / 100 + (l.tasaImpuesto ?? 0) / 100)));
  const suma = netos.reduce((s, x) => s + x, 0);
  if (netos.length && suma !== doc.neto) {
    let mayor = 0;
    netos.forEach((n, i) => { if (n > netos[mayor]) mayor = i; });
    netos[mayor] += doc.neto - suma;
  }
  return netos;
}

/** El XML completo del DTE, sin la firma XMLDSig (la pone el emisor real). */
export function construirXmlDte(doc: DocumentoDte): string {
  const rec = receptorDe(doc);
  const boleta = doc.tipo === 39;
  const netos = boleta ? [] : netosPorLinea(doc);

  const emisor = boleta
    ? `<Emisor>${t('RUTEmisor', rutXml(doc.emisor.rut))}${t('RznSocEmisor', doc.emisor.razonSocial, 100)}` +
      `${t('GiroEmisor', doc.emisor.giro, 80)}${t('DirOrigen', doc.emisor.direccion, 70)}` +
      `${t('CmnaOrigen', doc.emisor.comuna, 20)}${t('CiudadOrigen', doc.emisor.ciudad ?? null, 20)}</Emisor>`
    : `<Emisor>${t('RUTEmisor', rutXml(doc.emisor.rut))}${t('RznSoc', doc.emisor.razonSocial, 100)}` +
      `${t('GiroEmis', doc.emisor.giro, 80)}${t('Acteco', doc.emisor.acteco ?? null)}` +
      `${t('DirOrigen', doc.emisor.direccion, 70)}${t('CmnaOrigen', doc.emisor.comuna, 20)}` +
      `${t('CiudadOrigen', doc.emisor.ciudad ?? null, 20)}</Emisor>`;

  const receptor = `<Receptor>${t('RUTRecep', rutXml(rec.rut))}${t('RznSocRecep', rec.razonSocial, 100)}` +
    `${t('GiroRecep', rec.giro ?? null, 40)}${t('DirRecep', rec.direccion ?? null, 70)}</Receptor>`;

  const adicionales = doc.impuestos
    .map((i) => `<ImptoReten>${t('TipoImp', i.codigoSii)}${t('TasaImp', num(i.tasa))}${t('MontoImp', i.monto)}</ImptoReten>`)
    .join('');
  const totales = `<Totales>${t('MntNeto', doc.neto)}${doc.exento ? t('MntExe', doc.exento) : ''}` +
    `${boleta ? '' : t('TasaIVA', num(doc.ivaPct))}${t('IVA', doc.iva)}${adicionales}${t('MntTotal', doc.total)}</Totales>`;

  const idDoc = `<IdDoc>${t('TipoDTE', doc.tipo)}${t('Folio', doc.folio)}${t('FchEmis', doc.fechaEmision)}` +
    `${boleta ? '<IndServicio>3</IndServicio>' : ''}</IdDoc>`;

  const detalle = doc.detalle.map((l, i) =>
    `<Detalle>${t('NroLinDet', i + 1)}${t('NmbItem', l.nombre, 80)}${t('QtyItem', num(l.cantidad))}` +
    `${t('PrcItem', boleta ? l.precio : num(netos[i] / l.cantidad))}` +
    `${l.descuento ? t('DescuentoMonto', l.descuento) : ''}` +
    `${!boleta && l.codigoImpuesto ? t('CodImpAdic', l.codigoImpuesto) : ''}` +
    `${t('MontoItem', boleta ? l.monto : netos[i])}</Detalle>`).join('');

  const referencia = doc.referencia
    ? `<Referencia><NroLinRef>1</NroLinRef>${t('TpoDocRef', doc.referencia.tipo)}` +
      `${t('FolioRef', doc.referencia.folio ?? 0)}${t('FchRef', doc.referencia.fecha)}` +
      `${t('CodRef', doc.referencia.codigo)}${t('RazonRef', doc.referencia.razon, 90)}</Referencia>`
    : '';

  return `<DTE version="1.0"><Documento ID="F${doc.folio}T${doc.tipo}">` +
    `<Encabezado>${idDoc}${emisor}${receptor}${totales}</Encabezado>` +
    `${detalle}${referencia}${construirTed(doc)}${t('TmstFirma', doc.timbradoEn.slice(0, 19))}` +
    `</Documento></DTE>`;
}

/** ¿Cuadra el documento? neto + exento + IVA + adicionales = total, y el detalle suma el total. */
export function validarDte(doc: DocumentoDte): string[] {
  const errores: string[] = [];
  const adic = doc.impuestos.reduce((s, i) => s + i.monto, 0);
  if (doc.neto + doc.exento + doc.iva + adic !== doc.total) {
    errores.push(`neto ${doc.neto} + exento ${doc.exento} + IVA ${doc.iva} + adicionales ${adic} ≠ total ${doc.total}`);
  }
  const detalle = doc.detalle.reduce((s, l) => s + l.monto, 0);
  if (detalle !== doc.total) errores.push(`el detalle suma ${detalle} y el total es ${doc.total}`);
  if (doc.tipo === 33 && !doc.receptor) errores.push('una factura necesita receptor');
  if (doc.tipo === 61 && !doc.referencia) errores.push('una nota de crédito necesita referencia');
  if (!Number.isInteger(doc.folio) || doc.folio <= 0) errores.push('folio inválido');
  return errores;
}

// ---------------------------------------------------------------------------
// Devoluciones: cuánto se devuelve de cada línea
// ---------------------------------------------------------------------------

export interface LineaVendida {
  id: string;
  cantidad: number;
  /** Subtotal de la línea (cantidad × precio − descuento de la línea). */
  subtotal: number;
  /** Cuánto de esta línea ya se devolvió antes. */
  devuelto: number;
}

/**
 * Cuánto dinero corresponde devolver por cada línea.
 *
 * El valor de cada unidad es el que efectivamente pagó: el subtotal de la
 * línea repartido por unidad, y descontada la parte que le toca del descuento
 * a la venta completa. Cuando la devolución se lleva lo último que quedaba de
 * la venta, se devuelve exactamente lo que falta para llegar al total cobrado:
 * varias devoluciones parciales nunca suman más (ni menos) que la venta.
 *
 * La base hace el mismo cálculo (`fn_devolver_venta`, 0019) y es la autoridad.
 */
export function montosDevolucion(
  lineas: LineaVendida[],
  totalVenta: number,
  devueltoAntes: number,
  pedido: Array<{ id: string; cantidad: number }>,
): Array<{ id: string; cantidad: number; monto: number }> {
  const sumaSub = lineas.reduce((s, l) => s + l.subtotal, 0);
  const porId = new Map(lineas.map((l) => [l.id, l]));
  // La misma línea pedida dos veces se suma, como en la base: antes cada
  // pedido se medía solo, "2 + 2" de una línea con 3 pasaba, y como "no
  // quedaba nada" se devolvía el total de la venta.
  const pedidoPorLinea = new Map<string, number>();
  for (const p of pedido) pedidoPorLinea.set(p.id, (pedidoPorLinea.get(p.id) ?? 0) + p.cantidad);
  for (const [id, cant] of pedidoPorLinea) {
    const l = porId.get(id);
    if (l && cant > l.cantidad - l.devuelto + 1e-9) throw new Error('CANTIDAD_A_DEVOLVER_INVALIDA');
  }
  const salida = pedido.map((p) => {
    const l = porId.get(p.id);
    if (!l) throw new Error('LINEA_NO_ES_DE_LA_VENTA');
    if (!(p.cantidad > 0) || p.cantidad > l.cantidad - l.devuelto + 1e-9) throw new Error('CANTIDAD_A_DEVOLVER_INVALIDA');
    // Una sola división, en el mismo orden que la base: así redondean igual.
    const monto = sumaSub > 0 ? clp((p.cantidad * l.subtotal * totalVenta) / (l.cantidad * sumaSub)) : 0;
    return { id: p.id, cantidad: p.cantidad, monto };
  });
  const quedaDespues = lineas.every((l) => {
    const pide = pedido.filter((p) => p.id === l.id).reduce((s, p) => s + p.cantidad, 0);
    return l.cantidad - l.devuelto - pide <= 1e-9;
  });
  if (quedaDespues && salida.length) {
    const falta = totalVenta - devueltoAntes;
    const suma = salida.reduce((s, x) => s + x.monto, 0);
    salida[salida.length - 1].monto += falta - suma;
  }
  return salida;
}

/**
 * Lo que devuelve la base (`fn_dte_resumen`, 0019) convertido a DocumentoDte.
 * Es la única forma en que la pantalla y las pruebas arman un documento: desde
 * lo que quedó registrado, nunca desde el carrito.
 */
export interface RegistroDte {
  tipo: number;
  folio: number | string;
  ambiente: AmbienteDte;
  fecha_emision: string;
  emitido_en: string;
  emisor: {
    rut: string; razon_social: string; giro: string; acteco?: number | null;
    direccion: string; comuna: string; ciudad?: string | null; configurado?: boolean;
  };
  receptor: { rut: string; razon_social: string; giro?: string | null; direccion?: string | null } | null;
  detalle: Array<{
    nombre: string; cantidad: number | string; precio: number; descuento: number; monto: number;
    codigo?: number | null; tasa?: number | string | null;
  }>;
  neto: number; exento: number; iva: number; iva_pct: number | string;
  impuestos_detalle: Array<{ codigo_sii: number | null; tasa: number | string; monto: number }>;
  total: number;
  referencia?: { tipo: number; folio: number | string | null; fecha: string | null; codigo: 1 | 2 | 3; razon: string } | null;
}

export function desdeRegistro(r: RegistroDte): DocumentoDte {
  return {
    tipo: Number(r.tipo) as TipoDte,
    folio: Number(r.folio),
    fechaEmision: r.fecha_emision,
    timbradoEn: new Date(r.emitido_en).toISOString(),
    ambiente: r.ambiente,
    emisor: {
      rut: r.emisor.rut, razonSocial: r.emisor.razon_social, giro: r.emisor.giro,
      acteco: r.emisor.acteco ?? null, direccion: r.emisor.direccion,
      comuna: r.emisor.comuna, ciudad: r.emisor.ciudad ?? null,
    },
    receptor: r.receptor && r.receptor.rut
      ? { rut: r.receptor.rut, razonSocial: r.receptor.razon_social, giro: r.receptor.giro ?? null, direccion: r.receptor.direccion ?? null }
      : null,
    detalle: r.detalle.map((l) => ({
      nombre: l.nombre, cantidad: Number(l.cantidad), precio: Number(l.precio),
      descuento: Number(l.descuento ?? 0), monto: Number(l.monto),
      codigoImpuesto: l.codigo ?? null, tasaImpuesto: l.tasa != null ? Number(l.tasa) : null,
    })),
    neto: r.neto, exento: r.exento, iva: r.iva, ivaPct: Number(r.iva_pct),
    impuestos: (r.impuestos_detalle ?? []).map((i) => ({ codigoSii: i.codigo_sii, tasa: Number(i.tasa), monto: i.monto })),
    total: r.total,
    referencia: r.referencia
      ? { tipo: Number(r.referencia.tipo), folio: r.referencia.folio != null ? Number(r.referencia.folio) : null,
          fecha: r.referencia.fecha, codigo: r.referencia.codigo, razon: r.referencia.razon }
      : null,
  };
}
