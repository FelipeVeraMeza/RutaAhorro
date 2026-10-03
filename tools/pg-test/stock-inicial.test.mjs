/**
 * 0024 · El stock inicial de un perecible nace con su fecha de vencimiento.
 *
 * Encontrado recorriendo el flujo completo: un producto nuevo nace perecible,
 * pero el stock que se cargaba al crearlo quedaba fuera de todo lote. La venta
 * lo registraba "sin lote" y las alertas de vencimiento no lo veían.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const crear = (extra = {}) => ({
  p_name: `Pan ${Math.random().toString(16).slice(2, 8)}`,
  p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 250, p_avg_cost: 120, p_min_stock: 0,
  p_tracks_expiry: true, p_expiry_alert_days: 2, p_barcodes: null,
  p_initial_stock: 0, ...extra,
});

async function hoyYManana(L) {
  const { rows: [r] } = await banco.su.query(
    `select (now() at time zone fn_tenant_timezone($1))::date::text as hoy,
            ((now() at time zone fn_tenant_timezone($1))::date + 1)::text as manana,
            ((now() at time zone fn_tenant_timezone($1))::date - 1)::text as ayer`, [L.tenant]);
  return r;
}

test('un perecible creado con 20 a la vista y su fecha queda como un lote de 20', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const { manana } = await hoyYManana(L);
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock_sala: 20, p_initial_expiry: manana }));
  const { rows } = await banco.su.query(
    `select quantity::float as q, expiry_date::text as vence, unit_cost from product_lots where product_id = $1`, [r.product_id]);
  assert.deepEqual(rows, [{ q: 20, vence: manana, unit_cost: 120 }]);
});

test('vender de ese pan descuenta del lote, sin quedar "sin lote"', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const { manana } = await hoyYManana(L);
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock_sala: 20, p_initial_expiry: manana }));
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 0 });
  await rpc(adm, 'fn_register_sale', {
    p_client_uuid: crypto.randomUUID(),
    p_items: [{ product_id: r.product_id, quantity: 3, unit_price: 250, discount_amount: 0 }],
    p_payments: [{ method: 'efectivo', amount: 750 }],
  });
  const { rows: [lote] } = await banco.su.query(`select quantity::float as q from product_lots where product_id = $1`, [r.product_id]);
  assert.equal(lote.q, 17);
});

test('no se puede cargar mercadería ya vencida', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const { ayer } = await hoyYManana(L);
  const r = await intentar(rpc(adm, 'fn_create_product', crear({ p_initial_stock_sala: 5, p_initial_expiry: ayer })));
  assert.equal(r.ok, false);
  assert.match(r.error, /VENCIMIENTO_PASADO/);
});

// 0038 · Decisión 4 de 0032: un perecible con stock entra con su fecha.
// Antes "sin fecha funcionaba como antes" y quedaba stock sin lote (sin FEFO,
// sin aviso). Sin stock no hace falta fecha; un producto que no vence no crea
// lote aunque traiga una.
test('perecible con stock y sin fecha se rechaza; sin stock pasa; uno que no vence no crea lote', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const { manana } = await hoyYManana(L);
  const r = await intentar(rpc(adm, 'fn_create_product', crear({ p_initial_stock_sala: 5 })));
  assert.equal(r.ok, false);
  assert.match(r.error, /VENCIMIENTO_REQUERIDO/);
  const sinStock = await rpc(adm, 'fn_create_product', crear({}));
  const noVence = await rpc(adm, 'fn_create_product', crear({ p_tracks_expiry: false, p_initial_stock_sala: 5, p_initial_expiry: manana }));
  const { rows } = await banco.su.query(
    `select count(*)::int as n from product_lots where product_id in ($1, $2)`, [sinStock.product_id, noVence.product_id]);
  assert.equal(rows[0].n, 0);
  assert.equal(Number(noVence.stock_sala), 5);
});
