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
  // Lo que se agregó después (0019, 0029, 0030, 0035, 0036) y el respaldo no
  // traía: la cuenta del fiado de cada cliente, las facturas por pagar, las
  // devoluciones a proveedor, las autorizaciones de descuento y el emisor de
  // las boletas. "Descargar mis datos" decía "todo" y dejaba eso afuera.
  'cuenta_cliente_movimientos', 'facturas_proveedor', 'devoluciones_proveedor',
  'devolucion_proveedor_items', 'autorizaciones_descuento', 'dte_emisores', 'dte_folios', 'alerts',
];

/** Con qué ordenar cada tabla al leerla por páginas (las que no tienen `id`). */
const ORDEN: Record<string, string> = {
  product_suppliers: 'product_id', stock_levels: 'product_id', stock_ubicaciones: 'product_id',
  dte_emisores: 'tenant_id',
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
        // Con orden: sin él, PostgreSQL no garantiza que una página siga a la
        // otra y una tabla grande (ventas, kardex) podía salir con filas
        // repetidas y otras faltando en la copia.
        const { data, error } = await supabase().from(tabla).select('*')
          .order(ORDEN[tabla] ?? 'id').range(desde, desde + PAGINA - 1);
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
