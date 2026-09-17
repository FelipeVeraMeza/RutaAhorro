'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db } from '../offline/db';
import { DEMO_PRODUCTOS } from '../demo/data';

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
}

export interface VentaDetallada extends Venta {
  lineas: LineaVenta[];
  pagos: Array<{ metodo: string; monto: number }>;
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

export interface RepositorioVentas {
  listar(filtro: FiltroVentas): Promise<Venta[]>;
  detalle(id: string): Promise<VentaDetallada | null>;
  anular(id: string, motivo: string): Promise<void>;
}

export const ETIQUETA_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
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

function aVenta(v: VentaDemo): Venta {
  const iva = Math.round(v.total - v.total / 1.19);
  return {
    id: v.id,
    folio: v.folio,
    fecha: v.fecha,
    total: v.total,
    subtotal: v.total,
    descuento: 0,
    iva,
    vendedor: 'Modo demo',
    anulada: v.anulada,
    anuladaPor: v.anulada ? 'Modo demo' : null,
    anuladaEn: v.anuladaEn,
    motivoAnulacion: v.motivoAnulacion,
  };
}

const repoLocal: RepositorioVentas = {
  async listar(filtro) {
    let ventas = await leerVentasDemo();
    if (filtro.folio) ventas = ventas.filter((v) => v.folio === filtro.folio);
    if (filtro.incluirAnuladas === false) ventas = ventas.filter((v) => !v.anulada);
    if (filtro.desde) ventas = ventas.filter((v) => v.fecha.slice(0, 10) >= filtro.desde!);
    if (filtro.hasta) ventas = ventas.filter((v) => v.fecha.slice(0, 10) <= filtro.hasta!);
    return ventas
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, filtro.limite ?? 50)
      .map(aVenta);
  },

  async detalle(id) {
    const v = (await leerVentasDemo()).find((x) => x.id === id);
    return v ? { ...aVenta(v), lineas: v.lineas, pagos: v.pagos } : null;
  },

  async anular(id, motivo) {
    if (motivo.trim() === '') throw new Error('MOTIVO_REQUERIDO');
    const ventas = await leerVentasDemo();
    const v = ventas.find((x) => x.id === id);
    if (!v) throw new Error('VENTA_NO_ENCONTRADA');
    if (v.anulada) throw new Error('VENTA_YA_ANULADA');

    v.anulada = true;
    v.motivoAnulacion = motivo.trim();
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
  'voided_at, void_reason, profiles!sales_sold_by_fkey(full_name)';

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
  };
}

const repoSupabase: RepositorioVentas = {
  async listar(filtro) {
    let q = supabase().from('sales').select(SELECT_VENTA);

    if (filtro.folio) {
      // Buscar por folio ignora las fechas a propósito: quien escribe un folio
      // sabe exactamente qué venta quiere, y hacerle además acertar el día es
      // una forma rebuscada de no encontrar nada.
      q = q.eq('folio', filtro.folio);
    } else {
      if (filtro.desde) q = q.gte('sold_at', `${filtro.desde}T00:00:00`);
      if (filtro.hasta) q = q.lte('sold_at', `${filtro.hasta}T23:59:59.999`);
    }
    if (filtro.incluirAnuladas === false) q = q.eq('status', 'completada');

    const { data, error } = await q
      .order('sold_at', { ascending: false })
      .limit(filtro.limite ?? 50);
    if (error) throw error;
    return (data ?? []).map((f) => aVentaBD(f as unknown as FilaVenta));
  },

  async detalle(id) {
    const client = supabase();
    const { data, error } = await client
      .from('sales')
      .select(SELECT_VENTA)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const [{ data: items }, { data: pagos }] = await Promise.all([
      client.from('sale_items')
        .select('product_name, quantity, unit_price, discount_amount, subtotal')
        .eq('sale_id', id),
      client.from('sale_payments').select('method, amount').eq('sale_id', id),
    ]);

    return {
      ...aVentaBD(data as unknown as FilaVenta),
      lineas: (items ?? []).map((l) => ({
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
    };
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
