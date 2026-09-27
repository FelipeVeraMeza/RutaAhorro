/**
 * 0017 · Respuestas del cuestionario (2026-09-26) y la vista del vendedor.
 *
 *  · Un vendedor lee la lista de productos sin costos, con todo lo que la
 *    pantalla pide (la vista había quedado sin las columnas de 0006).
 *  · Respuesta 13: el local decide si cualquiera vende sin stock registrado.
 *  · Respuesta 23: el efectivo inicial sugerido vive en la configuración.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function venderSinStock(L, valor) {
  await banco.su.query(
    `update tenants set settings = settings || jsonb_build_object('vender_sin_stock', $2::boolean) where id = $1`,
    [L.tenant, valor]);
}

test('un vendedor lee la lista de productos sin costos, con las columnas de vencimiento', async () => {
  const L = await nuevoLocal(banco);
  await L.producto({ nombre: 'Yogurt', perecible: true });
  const caj = await banco.como(L.cajero1);
  // Las mismas columnas que pide `repoSupabase.listar` cuando no ve costos.
  const r = await intentar(caj.query(
    `select id, name, description, sku, category_id, unit, sale_price, min_stock,
            tracks_expiry, expiry_alert_days, is_active, updated_at
       from products_public where tenant_id = $1`, [L.tenant]));
  assert.ok(r.ok, r.error);
  assert.equal(r.valor.rows.length, 1);
  assert.equal(r.valor.rows[0].tracks_expiry, true);

  // Y sigue sin costos: es la razón de ser de la vista.
  const costo = await intentar(caj.query(`select avg_cost from products_public limit 1`));
  assert.equal(costo.ok, false, 'la vista del vendedor expone el costo');
});

test('respuesta 13 · con "vender sin stock" un vendedor vende lo que el sistema tiene en cero, y el dueño recibe la alerta', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ nombre: 'Palta congelada', stock: 0 });
  await venderSinStock(L, true);
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });

  const r = await intentar(rpc(caj, 'fn_register_sale', venta(p, 2, 1500)));
  assert.ok(r.ok, r.error);
  assert.equal(await L.stock(p), -2);
  const { rows } = await banco.su.query(
    `select 1 from alerts where tenant_id = $1 and payload->>'product_id' = $2`, [L.tenant, p]);
  assert.ok(rows.length > 0, 'vendió en negativo y nadie se enteró');
});

test('respuesta 13 · un local que no lo permite sigue bloqueando al vendedor', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 0 });
  await venderSinStock(L, false);
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });

  const r = await intentar(rpc(caj, 'fn_register_sale', venta(p, 1, 1000)));
  assert.equal(r.ok, false);
  assert.match(r.error, /STOCK_INSUFICIENTE/);
  assert.equal(await L.stock(p), 0, 'una venta rechazada movió el stock');
});

test('un local nuevo nace con las respuestas del cliente: vende sin stock y sugiere $20.000', async () => {
  const L = await nuevoLocal(banco);
  const { rows: [s] } = await banco.su.query(
    `select settings->'vender_sin_stock' as sin_stock,
            settings->'efectivo_inicial_sugerido' as inicial,
            settings->'tarjeta_emite_documento' as tarjeta,
            settings->'iva_pct' as iva
       from tenants where id = $1`, [L.tenant]);
  assert.equal(s.sin_stock, true);
  assert.equal(s.inicial, 20000);
  assert.equal(s.tarjeta, true, 'se perdió una clave que ya existía');
  assert.equal(s.iva, 19, 'se perdió una clave que ya existía');
});

test('reinstalar no le pisa al dueño lo que ya decidió', async () => {
  const L = await nuevoLocal(banco);
  await venderSinStock(L, false);
  const { readFileSync } = await import('node:fs');
  await banco.su.query(readFileSync('supabase/migrations/0017_respuestas_cuestionario.sql', 'utf8'));
  const { rows: [s] } = await banco.su.query(
    `select settings->'vender_sin_stock' as v from tenants where id = $1`, [L.tenant]);
  assert.equal(s.v, false);
});
