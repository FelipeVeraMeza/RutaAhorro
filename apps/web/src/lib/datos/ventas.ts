'use client';

import {
  diaLocal, rangoDeDias, type DocumentoVenta, type TipoDocumento, type RegistroDte,
  type ImpuestoAdicionalDesglosado,
} from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { configuracionLocal } from './configuracion';
import { todasLasFilas } from './paginas';
import { DEMO_ACTIVO } from '../demo';
import { db, type QueuedSale } from '../offline/db';
import { DEMO_PRODUCTOS } from '../demo/data';
import { cajaDemo, usuarioDemoActual } from '../demo/caja';
import { cargoFiadoDemo, anulacionFiadoDemo } from './fiado';

/**
 * Historial de ventas y anulación (RF-M5-15).
 *
 * `fn_void_sale` está escrita y probada desde la primera versión del esquema, y
 * hasta hoy **ninguna pantalla la invocaba**: una venta mal cobrada no tenía
 * arreglo dentro del sistema. El almacenero cobraba de más, se daba cuenta al
 * segundo siguiente, y la única salida era un ajuste de inventario por un lado
 * y un egreso de caja por el otro, sin que nada los relacionara. Al cuadrar el
 * día, el descuadre no se podía explicar.
 *
 * Anular no borra nada: la venta queda marcada, con quién la anuló, cuándo y
 * por qué, y el stock vuelve por el kardex con un movimiento propio
 * (ADR-006). Con lotes, vuelve a los lotes exactos de los que salió, que es lo
 * que impide que un yogurt devuelto reaparezca con la fecha de vencimiento
 * equivocada.
 */

export interface LineaVenta {
  /** Id de la línea (sale_items). Lo necesita la devolución parcial. */
  id?: string;
  /** Cuántas unidades de esta línea ya se devolvieron (0019). */
  devuelto?: number;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  subtotal: number;
}

export interface Venta {
  id: string;
  folio: number;
  fecha: string;
  total: number;
  subtotal: number;
  descuento: number;
  iva: number;
  vendedor: string | null;
  anulada: boolean;
  anuladaPor: string | null;
  anuladaEn: string | null;
  motivoAnulacion: string | null;
  /** Qué documento correspondía por esta venta (0015). */
  documento: DocumentoVenta;
}

export interface DocumentoEmitido extends RegistroDte {
  id: string;
  estado: string;
}

export interface Devolucion {
  numero: number;
  monto: number;
  fecha: string;
  motivo: string;
  reembolso: string;
  esTotal: boolean;
}

export interface VentaDetallada extends Venta {
  /**
   * Neto e impuestos adicionales que guardó la base (0018). La copia del
   * comprobante los calculaba como total − IVA: con bebidas o alcoholes el
   * IABA/ILA quedaba sumado al neto y no aparecía en el papel.
   */
  neto?: number;
  adicionales?: ImpuestoAdicionalDesglosado[];
  lineas: LineaVenta[];
  pagos: Array<{ metodo: string; monto: number }>;
  /** Boleta o factura y notas de crédito (0019). Vacío con tarjeta o en la maqueta. */
  documentos: DocumentoEmitido[];
  devoluciones: Devolucion[];
}

export type Reembolso = 'efectivo' | 'transferencia' | 'debito' | 'credito' | 'fiado';

export interface ResultadoDevolucion {
  numero: number;
  monto: number;
  /** RF-M5-28 · Lo que salió del cajón: redondeado, o lo que se pagó si fue la venta entera. */
  efectivoDevuelto?: number;
  esTotal: boolean;
  notaCredito: RegistroDte | null;
}

export interface FiltroVentas {
  /** ISO 'YYYY-MM-DD'. Por omisión, hoy. */
  desde?: string;
  hasta?: string;
  /** Búsqueda por folio exacto. */
  folio?: number;
  /** Si es falso, esconde las anuladas. */
  incluirAnuladas?: boolean;
  limite?: number;
}

/**
 * Lo vendido en un período, calculado en la base y no sumando la lista.
 *
 * La lista trae de a 50: con más ventas que eso, la pantalla sumaba solo las
 * 50 últimas y el "Vendido" quedaba corto justo en los días buenos. Además no
 * restaba las devoluciones, y no cuadraba con el Inicio (v_sales_daily sí).
 */
export interface ResumenVentas {
  ventas: number;
  /** Neto de devoluciones, igual que "Vendido hoy" del Inicio. */
  total: number;
  /** Cobrado por medio de pago, antes de devoluciones. */
  porMedio: Record<string, number>;
}

export interface RepositorioVentas {
  listar(filtro: FiltroVentas): Promise<Venta[]>;
  resumen(desde: string, hasta: string): Promise<ResumenVentas>;
  detalle(id: string): Promise<VentaDetallada | null>;
  anular(id: string, motivo: string): Promise<void>;
  /**
   * Devolución parcial (algunas líneas o unidades) o total, con nota de
   * crédito si la venta tenía boleta o factura (`fn_devolver_venta`, 0019).
   * `items` null = todo lo que queda.
   */
  devolver(
    id: string,
    items: Array<{ lineaId: string; cantidad: number }> | null,
    motivo: string,
    reembolso: Reembolso,
  ): Promise<ResultadoDevolucion>;
}

export const ETIQUETA_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  // "Cobrado por medio de pago" no puede sumar lo fiado como si se hubiera cobrado.
  fiado: 'Fiado (por cobrar)',
};

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

const KEY_VENTAS = 'demo:ventas-registradas';

interface VentaDemo {
  id: string;
  folio: number;
  fecha: string;
  lineas: LineaVenta[];
  pagos: Array<{ metodo: string; monto: number }>;
  total: number;
  anulada: boolean;
  motivoAnulacion: string | null;
  anuladaEn: string | null;
  documento?: DocumentoVenta;
  clienteId?: string | null;
}

async function leerVentasDemo(): Promise<VentaDemo[]> {
  const raw = await db().meta.get(KEY_VENTAS);
  if (raw?.value) return JSON.parse(raw.value) as VentaDemo[];

  // Semilla: unas pocas ventas de hoy para que la pantalla tenga qué mostrar.
  // Se derivan del catálogo de ejemplo, no de números inventados, para que
  // cuadren con lo que se ve en el resto de la aplicación.
  const ahora = Date.now();
  const semilla: VentaDemo[] = [0, 1, 2, 3, 4].map((i) => {
    const p1 = DEMO_PRODUCTOS[(i * 3) % DEMO_PRODUCTOS.length];
    const p2 = DEMO_PRODUCTOS[(i * 5 + 1) % DEMO_PRODUCTOS.length];
    const lineas: LineaVenta[] = [
      { productoNombre: p1.name, cantidad: 1 + (i % 3), precioUnitario: p1.sale_price, descuento: 0, subtotal: (1 + (i % 3)) * p1.sale_price },
      { productoNombre: p2.name, cantidad: 1, precioUnitario: p2.sale_price, descuento: 0, subtotal: p2.sale_price },
    ];
    const total = lineas.reduce((s, l) => s + l.subtotal, 0);
    return {
      id: `venta-demo-${i}`,
      folio: 1040 - i,
      fecha: new Date(ahora - i * 37 * 60_000).toISOString(),
      lineas,
      pagos: [{ metodo: i % 2 === 0 ? 'efectivo' : 'debito', monto: total }],
      total,
      anulada: false,
      motivoAnulacion: null,
      anuladaEn: null,
    };
  });
  await db().meta.put({ key: KEY_VENTAS, value: JSON.stringify(semilla) });
  return semilla;
}

/**
 * Lo que en producción hace `fn_register_sale`, para la maqueta: la venta
 * queda en el historial y el stock baja. Antes la cola de la maqueta borraba
 * la venta al "sincronizarla" y no quedaba en ninguna parte: se cobraba en el
 * POS y no aparecía ni en Ventas ni en Inicio.
 */
/** Devuelve el folio, como fn_register_sale: el comprobante lo imprime. */
export async function registrarVentaDemo(v: QueuedSale): Promise<number> {
  const ventas = await leerVentasDemo();
  const ya = ventas.find((x) => x.id === `venta-${v.clientUuid}`);
  if (ya) return ya.folio;
  ventas.push({
    id: `venta-${v.clientUuid}`,
    folio: Math.max(0, ...ventas.map((x) => x.folio)) + 1,
    fecha: v.soldAt,
    lineas: v.items.map((i) => ({
      productoNombre: i.name,
      cantidad: i.quantity,
      precioUnitario: i.unit_price,
      descuento: i.discount_amount,
      subtotal: Math.max(0, Math.round(i.quantity * i.unit_price) - i.discount_amount),
    })),
    pagos: v.payments.map((p) => ({ metodo: p.method, monto: p.amount })),
    total: v.total,
    documento: v.documento,
    clienteId: v.clienteId ?? null,
    anulada: false,
    motivoAnulacion: null,
    anuladaEn: null,
  });
  // RF-M5-30 · lo fiado deja su cargo en la cuenta del cliente.
  const fiado = v.payments.filter((p) => p.method === 'fiado').reduce((s, p) => s + p.amount, 0);
  if (fiado > 0) {
    if (!v.clienteId) throw new Error('FIADO_SIN_CLIENTE');
    await cargoFiadoDemo(v.clienteId, fiado, ventas[ventas.length - 1].folio);
  }
  cajaDemo.registrarVenta(usuarioDemoActual(), v.total, v.payments);
  for (const i of v.items) {
    const p = await db().products.get(i.product_id);
    if (p) await db().products.put({ ...p, stock: p.stock - i.quantity, updatedAt: new Date().toISOString() });
  }
  await db().meta.put({ key: KEY_VENTAS, value: JSON.stringify(ventas) });
  return ventas[ventas.length - 1].folio;
}

function aVenta(v: VentaDemo): Venta {
  const iva = Math.round(v.total - v.total / 1.19);
  // Como la base: subtotal bruto y el descuento de las líneas (antes la
  // maqueta decía descuento 0 en una venta con descuento o combo).
  const descuento = v.lineas.reduce((s, l) => s + (l.descuento ?? 0), 0);
  return {
    id: v.id,
    folio: v.folio,
    fecha: v.fecha,
    total: v.total,
    subtotal: v.lineas.reduce((s, l) => s + Math.round(l.cantidad * l.precioUnitario), 0),
    descuento,
    iva,
    vendedor: 'Modo demo',
    anulada: v.anulada,
    anuladaPor: v.anulada ? 'Modo demo' : null,
    anuladaEn: v.anuladaEn,
    motivoAnulacion: v.motivoAnulacion,
    documento: v.documento ?? {
      tipo: v.pagos.some((p) => p.metodo === 'debito' || p.metodo === 'credito')
        ? 'voucher' : 'boleta',
    },
  };
}

const repoLocal: RepositorioVentas = {
  async listar(filtro) {
    let ventas = await leerVentasDemo();
    if (filtro.folio) ventas = ventas.filter((v) => v.folio === filtro.folio);
    if (filtro.incluirAnuladas === false) ventas = ventas.filter((v) => !v.anulada);
    // El día de la venta en la zona del local, no el de UTC: con `slice(0, 10)`
    // una venta de las 21:30 caía en el día siguiente.
    const { zonaHoraria } = await configuracionLocal();
    if (filtro.desde) ventas = ventas.filter((v) => diaLocal(v.fecha, zonaHoraria) >= filtro.desde!);
    if (filtro.hasta) ventas = ventas.filter((v) => diaLocal(v.fecha, zonaHoraria) <= filtro.hasta!);
    return ventas
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, filtro.limite ?? 50)
      .map(aVenta);
  },

  async resumen(desde, hasta) {
    const lista = await repoLocal.listar({ desde, hasta, incluirAnuladas: false, limite: 100_000 });
    const ids = new Set(lista.map((v) => v.id));
    const porMedio: Record<string, number> = {};
    for (const v of await leerVentasDemo()) {
      if (!ids.has(v.id)) continue;
      for (const p of v.pagos) porMedio[p.metodo] = (porMedio[p.metodo] ?? 0) + p.monto;
    }
    return { ventas: lista.length, total: lista.reduce((s, v) => s + v.total, 0), porMedio };
  },

  async detalle(id) {
    const v = (await leerVentasDemo()).find((x) => x.id === id);
    return v ? { ...aVenta(v), lineas: v.lineas, pagos: v.pagos, documentos: [], devoluciones: [] } : null;
  },

  // La maqueta no emite documentos ni lleva devoluciones: decirlo es mejor
  // que simular algo que después no se comporta igual.
  async devolver() {
    throw new Error('NO_DISPONIBLE_EN_DEMO');
  },

  async anular(id, motivo) {
    if (motivo.trim() === '') throw new Error('MOTIVO_REQUERIDO');
    const ventas = await leerVentasDemo();
    const v = ventas.find((x) => x.id === id);
    if (!v) throw new Error('VENTA_NO_ENCONTRADA');
    if (v.anulada) throw new Error('VENTA_YA_ANULADA');

    v.anulada = true;
    v.motivoAnulacion = motivo.trim();
    const fiado = v.pagos.filter((p) => p.metodo === 'fiado').reduce((s, p) => s + p.monto, 0);
    if (fiado > 0 && v.clienteId) await anulacionFiadoDemo(v.clienteId, fiado, v.folio);
    v.anuladaEn = new Date().toISOString();

    // El stock vuelve, igual que en producción: si anular no devolviera las
    // unidades, el modo demo enseñaría un comportamiento que no existe.
    for (const l of v.lineas) {
      const p = (await db().products.toArray()).find((x) => x.name === l.productoNombre);
      if (p) {
        await db().products.put({ ...p, stock: p.stock + l.cantidad, updatedAt: new Date().toISOString() });
      }
    }
    await db().meta.put({ key: KEY_VENTAS, value: JSON.stringify(ventas) });
  },
};

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const SELECT_VENTA =
  'id, folio, sold_at, total, subtotal, discount_total, tax_amount, status, ' +
  'voided_at, void_reason, document_type, receptor_rut, receptor_razon_social, ' +
  'receptor_giro, receptor_direccion, profiles!sales_sold_by_fkey(full_name)';

interface FilaVenta {
  id: string;
  folio: number;
  sold_at: string;
  total: number;
  subtotal: number;
  discount_total: number;
  tax_amount: number;
  status: string;
  voided_at: string | null;
  void_reason: string | null;
  document_type?: TipoDocumento | null;
  receptor_rut?: string | null;
  receptor_razon_social?: string | null;
  receptor_giro?: string | null;
  receptor_direccion?: string | null;
  profiles?: { full_name: string } | null;
}

function aVentaBD(f: FilaVenta): Venta {
  return {
    id: f.id,
    folio: Number(f.folio),
    fecha: f.sold_at,
    total: Number(f.total ?? 0),
    subtotal: Number(f.subtotal ?? 0),
    descuento: Number(f.discount_total ?? 0),
    iva: Number(f.tax_amount ?? 0),
    vendedor: f.profiles?.full_name ?? null,
    anulada: f.status === 'anulada',
    anuladaPor: null,
    anuladaEn: f.voided_at,
    motivoAnulacion: f.void_reason,
    // Las ventas anteriores a 0015 no traen columna: eran todas boleta.
    documento: {
      tipo: f.document_type ?? 'boleta',
      receptor: f.receptor_rut && f.receptor_razon_social
        ? {
            rut: f.receptor_rut,
            razonSocial: f.receptor_razon_social,
            giro: f.receptor_giro ?? undefined,
            direccion: f.receptor_direccion ?? undefined,
          }
        : null,
    },
  };
}

const repoSupabase: RepositorioVentas = {
  async listar(filtro) {
    // Los bordes del día se calculan en la zona del local. Antes se mandaba
    // '2026-09-18T00:00:00' sin zona, que la base lee en UTC: "hoy" iba de
    // las 20:00 o 21:00 de ayer a la misma hora de hoy, y lo vendido en la
    // tarde-noche aparecía en el día siguiente.
    const r = filtro.folio ? null : rangoDeDias(filtro.desde ?? filtro.hasta!, filtro.hasta ?? filtro.desde!,
      (await configuracionLocal()).zonaHoraria);
    // Una consulta nueva por página (el constructor de Supabase no se reusa).
    const consulta = () => {
      let q = supabase().from('sales').select(SELECT_VENTA);
      if (filtro.folio) {
        // Buscar por folio ignora las fechas a propósito: quien escribe un folio
        // sabe exactamente qué venta quiere, y hacerle además acertar el día es
        // una forma rebuscada de no encontrar nada.
        q = q.eq('folio', filtro.folio);
      } else if (r) {
        if (filtro.desde) q = q.gte('sold_at', r.desde);
        if (filtro.hasta) q = q.lt('sold_at', r.hasta);
      }
      if (filtro.incluirAnuladas === false) q = q.eq('status', 'completada');
      return q.order('sold_at', { ascending: false }).order('id', { ascending: false });
    };
    // De a 1.000 (lo que entrega la API): con "Ver más" pasado las 1.000
    // ventas la consulta seguía devolviendo 1.000, el botón desaparecía y las
    // ventas más antiguas del período no se podían ver.
    const limite = filtro.limite ?? 50;
    const data = (await todasLasFilas((a, b) => consulta().range(a, Math.min(b, limite - 1)), limite)).slice(0, limite);
    return data.map((f) => aVentaBD(f as unknown as FilaVenta));
  },

  async resumen(desde, hasta) {
    const client = supabase();
    const { zonaHoraria } = await configuracionLocal();
    const r = rangoDeDias(desde, hasta, zonaHoraria);
    const { data: dias, error } = await client
      .from('v_sales_daily')
      .select('sales_count, total_amount')
      .gte('sale_date', desde)
      .lte('sale_date', hasta);
    if (error) throw error;

    // Los pagos se traen por páginas: la API corta en 1.000 filas, y un mes
    // de un almacén las pasa. Cortar en silencio sería el mismo error de antes.
    const porMedio: Record<string, number> = {};
    const PAGINA = 1000;
    for (let desdeFila = 0; ; desdeFila += PAGINA) {
      const { data: pagos, error: e2 } = await client
        .from('sale_payments')
        .select('method, amount, sales!inner(sold_at, status)')
        .gte('sales.sold_at', r.desde)
        .lt('sales.sold_at', r.hasta)
        .eq('sales.status', 'completada')
        .order('id')
        .range(desdeFila, desdeFila + PAGINA - 1);
      if (e2) throw e2;
      for (const p of pagos ?? []) {
        const m = p.method as string;
        porMedio[m] = (porMedio[m] ?? 0) + Number(p.amount ?? 0);
      }
      if ((pagos ?? []).length < PAGINA) break;
    }

    return {
      ventas: (dias ?? []).reduce((s, d) => s + Number(d.sales_count ?? 0), 0),
      total: (dias ?? []).reduce((s, d) => s + Number(d.total_amount ?? 0), 0),
      porMedio,
    };
  },

  async detalle(id) {
    const client = supabase();
    const { data, error } = await client
      .from('sales')
      .select(`${SELECT_VENTA}, neto, impuestos_adicionales, impuestos_detalle`)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const imp = data as unknown as { neto: number | null; impuestos_detalle: ImpuestoAdicionalDesglosado[] | null };

    const [rItems, rPagos, rDocs, rDevs] = await Promise.all([
      client.from('sale_items')
        .select('id, product_name, quantity, unit_price, discount_amount, subtotal, sale_return_items(cantidad)')
        .eq('sale_id', id).order('id'),
      client.from('sale_payments').select('method, amount').eq('sale_id', id),
      client.from('dte_documentos')
        .select('id, tipo, folio, ambiente, estado, fecha_emision, emitido_en, emisor, receptor, detalle, neto, exento, iva, iva_pct, impuestos_detalle, total, referencia')
        .eq('sale_id', id).order('emitido_en'),
      client.from('sale_returns')
        .select('numero, monto, created_at, motivo, reembolso, es_total')
        .eq('sale_id', id).order('numero'),
    ]);
    // Un error en cualquiera de las cuatro (sin red a la mitad) se ignoraba y
    // el detalle salía sin líneas o sin pagos, como si la venta fuera vacía:
    // "Devolver" no ofrecía nada y la copia del comprobante salía en $0.
    for (const r of [rItems, rPagos, rDocs, rDevs]) if (r.error) throw r.error;
    const items = rItems.data, pagos = rPagos.data, docs = rDocs.data, devs = rDevs.data;

    return {
      ...aVentaBD(data as unknown as FilaVenta),
      neto: imp.neto == null ? undefined : Number(imp.neto),
      adicionales: (imp.impuestos_detalle ?? []).map((a) => ({
        tasa: Number(a.tasa), nombre: a.nombre ?? null, neto: Number(a.neto), monto: Number(a.monto),
      })),
      lineas: (items ?? []).map((l) => ({
        id: l.id as string,
        devuelto: ((l.sale_return_items as Array<{ cantidad: number }> | null) ?? [])
          .reduce((s, r) => s + Number(r.cantidad), 0),
        productoNombre: (l.product_name as string) ?? 'Producto',
        cantidad: Number(l.quantity ?? 0),
        precioUnitario: Number(l.unit_price ?? 0),
        descuento: Number(l.discount_amount ?? 0),
        subtotal: Number(l.subtotal ?? 0),
      })),
      pagos: (pagos ?? []).map((p) => ({
        metodo: p.method as string,
        monto: Number(p.amount ?? 0),
      })),
      documentos: (docs ?? []) as unknown as DocumentoEmitido[],
      devoluciones: (devs ?? []).map((d) => ({
        numero: Number(d.numero),
        monto: Number(d.monto),
        fecha: d.created_at as string,
        motivo: d.motivo as string,
        reembolso: d.reembolso as string,
        esTotal: Boolean(d.es_total),
      })),
    };
  },

  async devolver(id, items, motivo, reembolso) {
    const { data, error } = await supabase().rpc('fn_devolver_venta', {
      p_sale_id: id,
      p_items: items ? items.map((i) => ({ sale_item_id: i.lineaId, cantidad: i.cantidad })) : null,
      p_motivo: motivo,
      p_reembolso: reembolso,
    });
    if (error) throw error;
    const r = data as { numero: number; monto: number; es_total: boolean; nota_credito: RegistroDte | null; efectivo_devuelto?: number };
    return { numero: Number(r.numero), monto: r.monto, esTotal: r.es_total, notaCredito: r.nota_credito, efectivoDevuelto: r.efectivo_devuelto };
  },

  async anular(id, motivo) {
    const { error } = await supabase().rpc('fn_void_sale', {
      p_sale_id: id,
      p_reason: motivo,
    });
    if (error) throw error;
  },
};

export function repoVentas(): RepositorioVentas {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}
