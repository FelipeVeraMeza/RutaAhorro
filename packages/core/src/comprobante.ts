/**
 * Comprobante de venta (RF-M5-14).
 *
 * Es el papel que se le entrega al cliente en el mostrador: qué se llevó,
 * cuánto costó cada cosa, y el desglose de neto e IVA.
 *
 * **NO es un documento tributario.** Hasta que exista la boleta electrónica
 * timbrada (ver docs/18-documentos-tributarios-sii.md y ADR-009), este
 * comprobante debe declararlo en el propio papel. Un ticket que se parece a
 * una boleta sin serlo es un problema del contribuyente ante el SII, y se lo
 * habríamos causado nosotros.
 *
 * Cuando exista el DTE, esta misma estructura pasa a ser su representación
 * impresa y se le agrega el timbre. El trabajo no se bota.
 */
import { clp, formatCLP, taxIncluded } from './money.js';
import {
  documentoPorOmision, NOMBRE_DOCUMENTO,
  type DocumentoVenta, type OpcionesDocumento,
} from './documento.js';
import type { CartLine } from './cart.js';
import { lineSubtotal } from './cart.js';
import { desglosarImpuestos, type ImpuestoAdicionalDesglosado } from './impuestos.js';
import { NOMBRE_DTE, type RegistroDte, type TipoDte } from './dte.js';

export interface LineaComprobante {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  /** Bruto de la línea menos su descuento. Nunca negativo. */
  subtotal: number;
  /** Lo que se ahorró por una oferta por cantidad (0 si no hubo). */
  ahorroOferta?: number;
}

export interface PagoComprobante {
  metodo: string;
  monto: number;
  /** Solo en efectivo: con cuánto pagó. */
  recibido?: number;
}

export interface Comprobante {
  /**
   * Folio de la venta. Es `null` mientras la venta está en la cola offline:
   * el correlativo lo asigna la base de datos (`fn_next_folio`), no el
   * dispositivo. Dos cajeros sin señal no pueden inventar folios que después
   * choquen.
   */
  folio: number | null;
  fecha: string;
  local: string;
  cajero: string;
  lineas: LineaComprobante[];
  /** Bruto, antes de descuentos. */
  subtotal: number;
  descuento: number;
  /** Lo que efectivamente se cobra. Incluye IVA. */
  total: number;
  /**
   * Total sin impuestos. Siempre se cumple:
   * neto + iva + totalAdicionales === total.
   */
  neto: number;
  iva: number;
  /** Impuestos adicionales (IABA, ILA), uno por impuesto. Vacío si no hay. */
  adicionales: ImpuestoAdicionalDesglosado[];
  totalAdicionales: number;
  ivaPct: number;
  pagos: PagoComprobante[];
  vuelto: number;
  /**
   * Qué documento corresponde por esta venta: boleta, factura, o el voucher
   * que emite la máquina de tarjetas (reunión 2026-09-19). Determina qué dice
   * el papel; no lo emite ante el SII.
   */
  documento: DocumentoVenta;
  /**
   * La boleta o factura electrónica que la base emitió con la venta (0019).
   * Null con tarjeta (el documento es el voucher de la máquina) y mientras la
   * venta espera en la cola sin conexión.
   */
  dte: RegistroDte | null;
  /**
   * Discriminante deliberado. Cuando exista la boleta electrónica se agrega
   * otro tipo con `esDocumentoTributario: true`, y el compilador va a obligar
   * a revisar cada lugar que asuma lo contrario.
   */
  esDocumentoTributario: false;
}

export interface DatosComprobante {
  lineas: CartLine[];
  pagos: PagoComprobante[];
  folio?: number | null;
  fecha?: string;
  local?: string;
  cajero?: string;
  descuentoGlobal?: number;
  ivaPct?: number;
  /** Si no se entrega, se deduce del medio de pago con `documentoPorOmision`. */
  documento?: DocumentoVenta;
  opcionesDocumento?: OpcionesDocumento;
  /** Lo que devolvió la base al registrar la venta (0019). */
  dte?: RegistroDte | null;
}

/**
 * Arma el comprobante a partir del carrito y los pagos.
 *
 * El IVA se extrae del total, no se suma: en el retail chileno los precios de
 * góndola ya lo incluyen (S-9, RNF-32). Sumarlo encima cobraría dos veces.
 */
export function construirComprobante(datos: DatosComprobante): Comprobante {
  const ivaPct = datos.ivaPct ?? 19;

  const lineas: LineaComprobante[] = datos.lineas.map((l) => ({
    nombre: l.name,
    cantidad: l.quantity,
    precioUnitario: clp(l.unitPrice),
    descuento: clp(l.discountAmount ?? 0),
    subtotal: lineSubtotal(l),
    ahorroOferta: l.precioLista != null
      ? Math.max(clp(l.precioLista * l.quantity) - clp(l.unitPrice * l.quantity), 0)
      : 0,
  }));

  const bruto = datos.lineas.reduce((s, l) => s + clp(l.unitPrice * l.quantity), 0);
  const descuentoLineas = datos.lineas.reduce((s, l) => s + clp(l.discountAmount ?? 0), 0);
  const descuento = clp(descuentoLineas + (datos.descuentoGlobal ?? 0));
  const total = Math.max(clp(bruto) - descuento, 0);

  // Se calcula el IVA y el neto sale por diferencia, nunca al revés. Si los
  // dos se redondearan por separado, su suma podría quedar a un peso del
  // total — y un peso de descuadre en un documento de venta es una
  // observación, no un detalle.
  // Con impuestos adicionales el neto se despeja por grupo (0018); sin ellos
  // es exactamente `taxIncluded` sobre el total, como antes.
  const desglose = desglosarImpuestos(
    datos.lineas.map((l) => ({
      subtotal: lineSubtotal(l),
      tasaAdicional: l.tasaAdicional ?? 0,
      nombreAdicional: l.nombreAdicional ?? null,
    })),
    ivaPct,
    datos.descuentoGlobal ?? 0,
  );
  const iva = desglose.adicionales.length ? desglose.iva : taxIncluded(total, ivaPct);
  const neto = desglose.adicionales.length ? desglose.neto : total - iva;

  const documento: DocumentoVenta =
    datos.documento ?? { tipo: documentoPorOmision(datos.pagos, datos.opcionesDocumento) };

  const efectivo = datos.pagos.find((p) => p.metodo === 'efectivo');
  const vuelto = efectivo?.recibido != null
    ? Math.max(clp(efectivo.recibido) - total, 0)
    : 0;

  return {
    folio: datos.folio ?? null,
    fecha: datos.fecha ?? new Date().toISOString(),
    local: datos.local ?? '',
    cajero: datos.cajero ?? '',
    lineas,
    subtotal: clp(bruto),
    descuento,
    total,
    neto,
    iva,
    adicionales: desglose.adicionales,
    totalAdicionales: desglose.totalAdicionales,
    ivaPct,
    pagos: datos.pagos,
    vuelto,
    documento,
    dte: datos.dte ?? null,
    esDocumentoTributario: false,
  };
}

const NOMBRE_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
};

export function nombreMetodo(metodo: string): string {
  return NOMBRE_METODO[metodo] ?? metodo;
}

/** "15-09-2026 20:31" — el formato que la gente lee en un ticket. */
export function fechaComprobante(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Versión en texto plano, para compartir por WhatsApp.
 *
 * Se alinea a un ancho fijo porque WhatsApp respeta el monoespaciado dentro de
 * ```bloques```, y un ticket desalineado se lee como un error del sistema.
 */
export function comprobanteATexto(c: Comprobante, ancho = 32): string {
  const fila = (izq: string, der: string) => {
    const espacio = Math.max(ancho - izq.length - der.length, 1);
    return izq + ' '.repeat(espacio) + der;
  };
  const separador = '-'.repeat(ancho);

  const out: string[] = [];
  if (c.local) out.push(c.local);
  for (const linea of encabezadoDocumento(c)) out.push(linea);
  out.push(fechaComprobante(c.fecha) + (c.folio != null ? `  N° ${c.folio}` : ''));
  if (c.cajero) out.push(`Atendió: ${c.cajero}`);
  out.push(separador);

  for (const l of c.lineas) {
    out.push(fila(`${l.cantidad} x ${l.nombre}`.slice(0, ancho - 9), formatCLP(l.subtotal)));
    if (l.ahorroOferta) out.push(fila(`   oferta ${formatCLP(l.precioUnitario)} c/u`, 'ahorra ' + formatCLP(l.ahorroOferta)));
    if (l.descuento > 0) out.push(fila('   descuento', '-' + formatCLP(l.descuento)));
  }

  out.push(separador);
  if (c.descuento > 0) {
    out.push(fila('Subtotal', formatCLP(c.subtotal)));
    out.push(fila('Descuento', '-' + formatCLP(c.descuento)));
  }
  out.push(fila('Neto', formatCLP(c.neto)));
  out.push(fila(`IVA (${c.ivaPct}%)`, formatCLP(c.iva)));
  for (const a of c.adicionales ?? []) {
    out.push(fila(`${etiquetaAdicional(a)}`.slice(0, ancho - 10), formatCLP(a.monto)));
  }
  out.push(fila('TOTAL', formatCLP(c.total)));
  out.push(separador);

  for (const p of c.pagos) {
    out.push(fila(nombreMetodo(p.metodo), formatCLP(p.recibido ?? p.monto)));
  }
  if (c.vuelto > 0) out.push(fila('Vuelto', formatCLP(c.vuelto)));
  for (const linea of pieDocumento(c)) { out.push(separador); out.push(linea); }

  return out.join('\n');
}

/**
 * Las dos o tres líneas que encabezan el papel.
 *
 * Mientras no haya timbre del SII (B-04, B-05), **ningún papel que salga de
 * acá puede llamarse boleta ni factura**: dice qué documento corresponde y
 * deja claro que el que se está imprimiendo no lo es. Un ticket que se parece
 * a una boleta sin serlo es un problema del contribuyente, y se lo habríamos
 * causado nosotros. Cuando exista el DTE, acá va el nombre del documento y
 * el timbre debajo.
 */
export function encabezadoDocumento(c: Comprobante): string[] {
  // Con documento emitido (0019): su nombre y folio. En simulación, el papel
  // lo dice en letras que no se pueden pasar por alto (T-27).
  if (c.dte) {
    const lineas = [
      `${NOMBRE_DTE[Number(c.dte.tipo) as TipoDte].toUpperCase()} N° ${c.dte.folio}`,
      `RUT ${c.dte.emisor.rut}`,
    ];
    if (c.dte.ambiente === 'simulacion') lineas.push('SIMULADA · SIN VALIDEZ TRIBUTARIA');
    return lineas;
  }
  if (c.documento.tipo === 'voucher') {
    return ['COMPROBANTE INTERNO', 'EL DOCUMENTO LO EMITE LA MÁQUINA'];
  }
  return [
    'COMPROBANTE INTERNO',
    'NO ES DOCUMENTO TRIBUTARIO',
    'Corresponde ' + NOMBRE_DOCUMENTO[c.documento.tipo].toLowerCase(),
  ];
}

/** Los datos del receptor, cuando la venta va con factura. */
export function pieDocumento(c: Comprobante): string[] {
  const r = c.documento.receptor;
  if (c.documento.tipo !== 'factura' || !r) return [];
  const lineas = ['Factura a: ' + r.razonSocial, 'RUT: ' + r.rut];
  if (r.giro) lineas.push('Giro: ' + r.giro);
  if (r.direccion) lineas.push('Dirección: ' + r.direccion);
  return lineas;
}

/** "IABA 18%" — cómo se nombra un impuesto adicional en el papel. */
export function etiquetaAdicional(a: { nombre: string | null; tasa: number }): string {
  const tasa = `${String(a.tasa).replace('.', ',')}%`;
  return a.nombre ? `${a.nombre} ${tasa}` : `Imp. adicional ${tasa}`;
}
