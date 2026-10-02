import { admin, activeTenants } from '../supabase.js';
import { env } from '../env.js';
import { log } from '../logger.js';

/**
 * Respaldo diario (RF-M9-01).
 *
 * Exporta lógicamente cada tabla a JSON y lo sube a Storage.
 *
 * Por qué export lógico y no `pg_dump`: el contenedor de Railway no garantiza
 * tener el cliente de PostgreSQL instalado, y un respaldo que depende de un
 * binario que puede no estar es un respaldo que falla el día que importa.
 * El export lógico solo necesita la API de Supabase, que es la misma que el
 * worker ya usa para todo lo demás.
 *
 * Además cumple RF-M9-03 de regalo: el archivo es directamente el que el
 * cliente puede descargar como "sus datos".
 */

const TABLES = [
  'tenants', 'stores', 'profiles',
  'categories', 'products', 'product_barcodes', 'price_history',
  'suppliers', 'product_suppliers',
  'purchase_receipts', 'purchase_receipt_items',
  'product_lots', 'stock_levels', 'inventory_movements',
  'stock_counts', 'stock_count_items',
  'cash_sessions', 'cash_movements',
  'sales', 'sale_items', 'sale_payments', 'sale_item_lots',
  'audit_log', 'alerts',
  // Lo de 0014 en adelante. La lista se había quedado en 0006: el respaldo
  // diario no traía boletas ni facturas (dte_documentos, facturas), clientes,
  // la cuenta del fiado, devoluciones, ofertas, combos ni lo por pagar. Un
  // local restaurado desde él perdía su historia tributaria y lo que le deben.
  'stock_ubicaciones', 'product_price_tiers', 'impuestos_adicionales',
  'clientes', 'cliente_precios', 'combos', 'combo_items',
  'sale_returns', 'sale_return_items', 'dte_emisores', 'dte_folios', 'dte_documentos',
  'facturas', 'factura_lineas', 'factura_notas_credito', 'facturas_recibidas',
  'cuenta_cliente_movimientos', 'facturas_proveedor',
  'devoluciones_proveedor', 'devolucion_proveedor_items', 'autorizaciones_descuento',
] as const;

/** Las tablas cuya llave no es `id`: para leerlas por páginas con un orden estable. */
const ORDEN: Partial<Record<string, string>> = {
  product_suppliers: 'product_id', stock_levels: 'product_id', stock_ubicaciones: 'product_id',
  dte_emisores: 'tenant_id',
};

const PAGE = 1000;

async function dumpTable(table: string, tenantId: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    // Con orden: sin él PostgreSQL no garantiza que las páginas sigan una a
    // otra, y una tabla grande podía quedar con filas repetidas y faltantes.
    let query = admin.from(table).select('*').order(ORDEN[table] ?? 'id').range(from, from + PAGE - 1);
    // `tenants` se filtra por id; el resto por tenant_id.
    query = table === 'tenants' ? query.eq('id', tenantId) : query.eq('tenant_id', tenantId);

    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

export async function runBackup() {
  const tenants = await activeTenants();
  const results: Array<{ tenant: string; file: string; rows: number; bytes: number }> = [];

  for (const tenant of tenants) {
    const dump: Record<string, unknown[]> = {};
    let totalRows = 0;

    for (const table of TABLES) {
      const rows = await dumpTable(table, tenant.id);
      dump[table] = rows;
      totalRows += rows.length;
    }

    const payload = JSON.stringify(
      {
        _meta: {
          generated_at: new Date().toISOString(),
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          schema_version: '0037',
          tables: TABLES.length,
          rows: totalRows,
        },
        data: dump,
      },
      null,
      0,
    );

    const date = new Date().toISOString().slice(0, 10);
    const file = `${tenant.id}/backup-${date}.json`;

    const { error } = await admin.storage
      .from(env.backupBucket)
      .upload(file, new Blob([payload], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
      });
    if (error) throw new Error(`Subida del respaldo falló: ${error.message}`);

    results.push({ tenant: tenant.name, file, rows: totalRows, bytes: payload.length });
    log.info('Respaldo generado', { tenant: tenant.name, file, rows: totalRows });
  }

  return { backups: results };
}

/** Elimina respaldos más antiguos que la retención configurada (RF-M9-02). */
export async function cleanupOldBackups() {
  const tenants = await activeTenants();
  // BACKUP_RETENTION_DAYS=0 (o negativo) dejaba el corte en "ahora" y borraba
  // todos los respaldos, también el de esta madrugada. Menos de 1 día no es
  // una retención: se usan los 30 de omisión y se avisa.
  const dias = Number.isFinite(env.backupRetentionDays) && env.backupRetentionDays >= 1 ? env.backupRetentionDays : 30;
  if (dias !== env.backupRetentionDays) log.warn('BACKUP_RETENTION_DAYS no válido: se usan 30 días', { valor: env.backupRetentionDays });
  const cutoff = new Date(Date.now() - dias * 864e5);
  let removed = 0;

  for (const tenant of tenants) {
    const { data, error } = await admin.storage.from(env.backupBucket).list(tenant.id, { limit: 1000 });
    if (error) {
      log.warn('No se pudo listar respaldos', { tenant: tenant.name, error: error.message });
      continue;
    }

    const stale = (data ?? [])
      .filter((f) => {
        const match = f.name.match(/backup-(\d{4}-\d{2}-\d{2})\.json/);
        return match ? new Date(match[1]) < cutoff : false;
      })
      .map((f) => `${tenant.id}/${f.name}`);

    if (stale.length > 0) {
      const { error: eBorrar } = await admin.storage.from(env.backupBucket).remove(stale);
      if (eBorrar) log.warn('No se pudieron borrar respaldos viejos', { tenant: tenant.name, error: eBorrar.message });
      else removed += stale.length;
    }
  }

  return { removed, retentionDays: dias };
}
