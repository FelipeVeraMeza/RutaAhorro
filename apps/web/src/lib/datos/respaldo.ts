'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db } from '../offline/db';

/**
 * "Descargar mis datos" (RF-M9-03, RNF-48): todo lo del local en un archivo
 * JSON, formato abierto, para que el dueño tenga su copia y pueda llevarse
 * sus datos si deja el servicio.
 *
 * Se arma en el navegador con la sesión del administrador: RLS entrega solo
 * lo de su local, así que no hace falta ninguna llave especial. Las claves
 * del SII no se incluyen (van cifradas y no le sirven a nadie fuera).
 */
const TABLAS = [
  'tenants', 'stores', 'profiles', 'categories', 'products', 'product_barcodes', 'product_price_tiers',
  'product_suppliers', 'product_lots', 'stock_levels', 'stock_ubicaciones', 'impuestos_adicionales',
  'price_history', 'suppliers', 'purchase_receipts', 'purchase_receipt_items', 'clientes', 'cliente_precios',
  'combos', 'combo_items', 'sales', 'sale_items', 'sale_item_lots', 'sale_payments', 'sale_returns',
  'sale_return_items', 'cash_sessions', 'cash_movements', 'inventory_movements', 'stock_counts',
  'stock_count_items', 'dte_documentos', 'facturas', 'factura_lineas', 'factura_notas_credito',
  'facturas_recibidas', 'audit_log',
  // 0029 a 0036: no estaban, y el respaldo salía sin lo que deben los
  // clientes (fiado), sin lo que se les debe a los proveedores ni las
  // devoluciones a proveedor.
  'cuenta_cliente_movimientos', 'facturas_proveedor', 'devoluciones_proveedor', 'devolucion_proveedor_items',
  'autorizaciones_descuento', 'alerts',
];

/**
 * Por qué columna se ordena cada tabla para paginar. Sin orden, Postgres
 * puede devolver las páginas en cualquier orden y, con ventas entrando
 * mientras se arma, una fila se saltaba o salía dos veces: el respaldo quedaba
 * incompleto sin decirlo.
 */
const ORDEN: Record<string, string[]> = {
  stock_levels: ['store_id', 'product_id'],
  stock_ubicaciones: ['store_id', 'product_id', 'ubicacion'],
  product_suppliers: ['product_id', 'supplier_id'],
};

export interface Respaldo {
  formato: 'rutaahorro-respaldo';
  version: 1;
  exportado_en: string;
  tablas: Record<string, unknown[]>;
  /** Tablas que no se pudieron leer y por qué (permiso, o no existe todavía). */
  omitidas: Record<string, string>;
}

export async function armarRespaldo(onProgreso?: (hechas: number, total: number) => void): Promise<Respaldo> {
  const r: Respaldo = { formato: 'rutaahorro-respaldo', version: 1, exportado_en: new Date().toISOString(), tablas: {}, omitidas: {} };
  if (DEMO_ACTIVO) {
    r.tablas.products = await db().products.toArray();
    r.tablas.barcodes = await db().barcodes.toArray();
    r.tablas.meta = (await db().meta.toArray()).filter((m) => m.key.startsWith('demo:'));
    onProgreso?.(1, 1);
    return r;
  }
  const PAGINA = 1000;
  for (const [i, tabla] of TABLAS.entries()) {
    const filas: unknown[] = [];
    try {
      for (let desde = 0; ; desde += PAGINA) {
        let q = supabase().from(tabla).select('*');
        for (const c of ORDEN[tabla] ?? ['id']) q = q.order(c);
        const { data, error } = await q.range(desde, desde + PAGINA - 1);
        if (error) throw error;
        filas.push(...(data ?? []));
        if ((data ?? []).length < PAGINA) break;
      }
      r.tablas[tabla] = filas;
    } catch (e) {
      r.omitidas[tabla] = (e as { message?: string })?.message ?? 'no se pudo leer';
    }
    onProgreso?.(i + 1, TABLAS.length);
  }
  return r;
}

export function descargarJson(nombre: string, datos: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
