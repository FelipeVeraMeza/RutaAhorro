/**
 * Borra los movimientos de prueba de UN local y deja la mercadería.
 *
 *   npm run db:limpiar-movimientos                          -> lista los locales
 *   npm run db:limpiar-movimientos -- --local="Mi Almacén"  -> respalda y dice qué borraría
 *   npm run db:limpiar-movimientos -- --local="Mi Almacén" --si-borrar
 *
 * Para qué existe: el cliente probó el sistema en producción antes de
 * arrancar (ventas, cajas, ajustes, ofertas) y pidió que todo eso desaparezca
 * de Ventas, Reportes, Caja y Bitácora, sin perder los productos (Felipe,
 * 2026-10-07). `db:limpiar` no sirve para esto: reinstala la base entera y se
 * lleva productos y usuarios.
 *
 * Qué borra, solo del local elegido: ventas y todo lo que cuelga de ellas
 * (pagos, devoluciones, documentos, facturas), cajas y sus movimientos, el
 * kardex, recepciones, devoluciones a proveedor, conteos, lotes, avisos,
 * bitácora e historial de precios. El stock queda en 0 (el kardex vacío dice
 * eso) y el folio de venta vuelve a partir en 1: lo que hay se carga con el
 * conteo inicial.
 *
 * Qué deja: productos, códigos, categorías, ofertas, combos, proveedores,
 * clientes, impuestos, usuarios, configuración y los folios del SII (un folio
 * del SII no se puede volver a usar aunque se borre la boleta de acá).
 *
 * El kardex, la bitácora y los documentos son inmutables (ADR-006): sus
 * disparadores impiden el DELETE. Se apagan dentro de la transacción y se
 * vuelven a encender antes del commit; si algo falla, el rollback deja todo
 * como estaba, disparadores incluidos.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** En orden: cada tabla antes que aquellas a las que apunta. */
export const TABLAS_A_BORRAR = [
  'sale_item_lots', 'sale_payments', 'sale_return_items',
  'factura_notas_credito', 'factura_lineas', 'facturas', 'dte_documentos',
  'cuenta_cliente_movimientos', 'autorizaciones_descuento', 'intentos_pin',
  'sale_returns', 'sale_items', 'sales',
  'cash_movements', 'cash_sessions',
  'inventory_movements', 'stock_count_items', 'stock_counts',
  'devolucion_proveedor_items', 'devoluciones_proveedor',
  'facturas_proveedor', 'facturas_recibidas',
  'product_lots', 'purchase_receipt_items', 'purchase_receipts',
  'alerts', 'audit_log', 'price_history',
];

/** Se actualizan, no se borran: el saldo vuelve a 0 y el folio a partir de 1. */
const TABLAS_A_PONER_EN_CERO = ['stock_levels', 'stock_ubicaciones', 'folio_counters'];

/**
 * Cuenta (y si `aplicar`, borra) los movimientos del local `tenantId`.
 * Devuelve cuántas filas tenía cada tabla. Todo o nada: una sola transacción.
 */
export async function limpiarMovimientos(db, tenantId, { aplicar = false } = {}) {
  const conteo = {};
  for (const t of TABLAS_A_BORRAR) {
    const { rows } = await db.query(`select count(*)::int as n from public."${t}" where tenant_id = $1`, [tenantId]);
    conteo[t] = rows[0].n;
  }
  const { rows: [s] } = await db.query(
    `select count(*)::int as n from stock_levels where tenant_id = $1 and quantity <> 0`, [tenantId]);
  conteo.stock_distinto_de_cero = s.n;
  if (!aplicar) return conteo;

  const tocadas = [...TABLAS_A_BORRAR, ...TABLAS_A_PONER_EN_CERO];
  await db.query('begin');
  try {
    // Solo los disparadores del proyecto (USER): las llaves foráneas siguen
    // vigentes y atajan cualquier fila que quede colgando.
    for (const t of tocadas) await db.query(`alter table public."${t}" disable trigger user`);
    for (const t of TABLAS_A_BORRAR) await db.query(`delete from public."${t}" where tenant_id = $1`, [tenantId]);
    await db.query(`update stock_levels set quantity = 0, updated_at = now() where tenant_id = $1`, [tenantId]);
    await db.query(`update stock_ubicaciones set quantity = 0, updated_at = now() where tenant_id = $1`, [tenantId]);
    await db.query(`update folio_counters set last_folio = 0 where tenant_id = $1`, [tenantId]);
    for (const t of tocadas) await db.query(`alter table public."${t}" enable trigger user`);
    await db.query('commit');
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
  return conteo;
}

// ----------------------------------------------------------------- consola
const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  dotenv.config({ path: path.join(raiz, '.env.local') });
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
  const aplicar = process.argv.includes('--si-borrar');

  const url = process.env.DATABASE_URL;
  if (!url) { console.error('\n✖ Falta DATABASE_URL en .env.local\n'); process.exit(1); }
  const host = url.match(/@([^@:/]+)/)?.[1] ?? '';
  const db = new pg.Client({
    connectionString: url,
    ssl: ['localhost', '127.0.0.1'].includes(host) ? false : { rejectUnauthorized: false },
  });
  await db.connect();

  try {
    const locales = (await db.query(`
      select t.id, t.name,
             (select count(*)::int from products p where p.tenant_id = t.id) as productos,
             (select count(*)::int from sales s where s.tenant_id = t.id) as ventas
        from tenants t order by t.created_at`)).rows;
    const nombre = arg('local');
    const elegido = locales.find((l) => l.name === nombre);
    if (!elegido) {
      console.log(nombre ? `\n✖ No hay un local llamado "${nombre}".` : '\nElige el local con --local="…":');
      for (const l of locales) console.log(`  · "${l.name}" — ${l.productos} productos, ${l.ventas} ventas`);
      console.log();
      process.exitCode = 1;
    } else {
      // Respaldo de lo que se va a borrar, antes de cualquier cosa.
      const destino = path.join(os.homedir(), `respaldo-movimientos-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.mkdirSync(destino, { recursive: true });
      for (const t of [...TABLAS_A_BORRAR, ...TABLAS_A_PONER_EN_CERO]) {
        const { rows } = await db.query(`select * from public."${t}" where tenant_id = $1`, [elegido.id]);
        fs.writeFileSync(path.join(destino, `${t}.json`), JSON.stringify(rows));
      }
      const dte = (await db.query(
        `select count(*)::int as n from dte_documentos where tenant_id = $1 and ambiente = 'produccion'`,
        [elegido.id])).rows[0].n;

      const conteo = await limpiarMovimientos(db, elegido.id, { aplicar });
      console.log(`\nLocal: "${elegido.name}" (${host})`);
      console.log(`Respaldo en ${destino}\n`);
      for (const [t, n] of Object.entries(conteo)) if (n) console.log(`  ${String(n).padStart(6)}  ${t}`);
      if (dte) console.log(`\n⚠ Hay ${dte} documentos tributarios. Borrarlos acá no los anula en el SII.`);
      console.log(aplicar
        ? '\n✔ Borrado. Productos, usuarios y configuración quedaron intactos; el stock quedó en 0.\n'
        : '\nNo se borró nada. Para hacerlo, agrega --si-borrar\n');
    }
  } finally {
    await db.end();
  }
}
