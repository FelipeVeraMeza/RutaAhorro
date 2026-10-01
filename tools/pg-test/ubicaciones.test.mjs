/**
 * Una sola bodega (0032). Desde 0014 el local tenía sala y bodega; Felipe
 * decidió el 2026-10-01 llevar un solo lugar, porque nadie registraba los
 * traspasos y la sala quedaba en cero con mercadería guardada.
 *
 * La regla que no se puede romper sigue siendo la misma: lo de las
 * ubicaciones = total del local = suma del kardex. Y ahora, además, todo está
 * en un solo lugar.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function ubicaciones(local, producto) {
  const { rows } = await banco.su.query(
    `select ubicacion::text, quantity from stock_ubicaciones where store_id = $1 and product_id = $2`,
    [local.store, producto]);
  const r = { sala: 0, bodega: 0 };
  for (const x of rows) r[x.ubicacion] = Number(x.quantity);
  return r;
}

/** Todo en un lugar, y ese lugar cuadra con el total y con el kardex. */
async function enUnLugar(local, producto) {
  const u = await ubicaciones(local, producto);
  const total = await local.stock(producto);
  const { rows: [k] } = await banco.su.query(
    `select coalesce(sum(quantity),0) as q from inventory_movements where store_id = $1 and product_id = $2`,
    [local.store, producto]);
  assert.equal(u.bodega, 0, 'quedó stock en un segundo lugar');
  assert.equal(u.sala, total, 'el lugar no suma el total');
  assert.equal(total, Number(k.q), 'el total no coincide con el kardex');
  return total;
}

async function proveedor(local) {
  return (await banco.su.query(
    `insert into suppliers (tenant_id, name) values ($1, 'Prov') returning id`, [local.tenant])).rows[0].id;
}

async function recibir(local, usuario, producto, cantidad) {
  await rpc(await banco.como(usuario), 'fn_confirm_receipt', {
    p_supplier_id: await proveedor(local), p_items: [{ product_id: producto, quantity: cantidad, unit_cost: 500 }] });
}

/** Alta de producto como la hace la pantalla, con lo mínimo. */
const crear = (extra = {}) => ({
  p_name: `Producto ${Math.random().toString(16).slice(2, 8)}`,
  p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 1000, p_avg_cost: 600, p_min_stock: 0,
  p_tracks_expiry: false, p_expiry_alert_days: 30, p_barcodes: null,
  p_initial_stock: 0, ...extra,
});

test('Lo que llega del proveedor queda en la bodega única, y se vende de ahí', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  await recibir(L, L.bodega, p, 10);
  assert.equal(await enUnLugar(L, p), 10);

  // Antes la sala estaba en 0 y la venta la dejaba en -3 aunque hubiera 10.
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  const { sale_id } = await rpc(caj, 'fn_register_sale', venta(p, 3, 1000, { metodo: 'debito' }));
  assert.equal(await enUnLugar(L, p), 7);
  await rpc(await banco.como(L.admin), 'fn_void_sale', { p_sale_id: sale_id, p_reason: 'prueba' });
  assert.equal(await enUnLugar(L, p), 10);
});

test('Al crear un producto, lo que se diga de "sala" o "bodega" queda en el mismo lugar', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock: 7, p_initial_stock_sala: 5 }));
  assert.equal(await enUnLugar(L, r.product_id), 12);
  const solo = await rpc(adm, 'fn_create_product', crear({ p_initial_stock: 4 }));
  assert.equal(await enUnLugar(L, solo.product_id), 4);
});

test('Dejar en 7 deja 7, aunque se pida "en la bodega" (no duplica)', async () => {
  // El riesgo de solo cambiar la pantalla: el ajuste leía lo que había en la
  // bodega (0) y sumaba 7 a lo que ya había en la sala.
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const sup = await banco.como(L.supervisor);
  await recibir(L, L.supervisor, p, 10);
  await rpc(sup, 'fn_adjust_stock', {
    p_product_id: p, p_new_quantity: 7, p_movement_type: 'ajuste_negativo', p_reason: 'conteo', p_ubicacion: 'bodega' });
  assert.equal(await enUnLugar(L, p), 7);
  await rpc(sup, 'fn_adjust_stock', {
    p_product_id: p, p_new_quantity: 9, p_movement_type: 'ajuste_positivo', p_reason: 'encontrado' });
  assert.equal(await enUnLugar(L, p), 9);
});

test('La toma deja lo contado, se pida en el lugar que se pida', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const sup = await banco.como(L.supervisor);
  await recibir(L, L.supervisor, p, 10);
  for (const [ubicacion, contado] of [['bodega', 5], ['sala', 8]]) {
    const toma = (await banco.su.query(
      `insert into stock_counts (tenant_id, store_id) values ($1, $2) returning id`, [L.tenant, L.store])).rows[0].id;
    await rpc(sup, 'fn_apply_stock_count', {
      p_count_id: toma, p_items: [{ product_id: p, counted_qty: contado }], p_ubicacion: ubicacion });
    assert.equal(await enUnLugar(L, p), contado, `toma pedida en ${ubicacion}`);
  }
});

test('Reponer la sala ya no existe', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  await recibir(L, L.admin, p, 5);
  const r = await intentar(rpc(await banco.como(L.cajero1), 'fn_transfer_stock', { p_product_id: p, p_cantidad: 2 }));
  assert.match(r.error ?? '', /UNA_SOLA_BODEGA/);
  assert.equal(await enUnLugar(L, p), 5);
});

test('0032 sobre una base con stock en la bodega lo pasa a la bodega única, con su traspaso', async () => {
  // Una base de antes de 0032: 6 en la bodega y 4 en la sala.
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  await banco.su.query('alter table inventory_movements disable trigger trg_movimiento_ubicacion');
  try {
    for (const [lugar, cantidad] of [['bodega', 6], ['sala', 4]]) {
      await banco.su.query(
        `insert into inventory_movements (tenant_id, store_id, product_id, movement_type, quantity,
                                          balance_after, unit_cost, ubicacion)
         values ($1, $2, $3, 'ajuste_positivo', $4, 0, 500, $5)`,
        [L.tenant, L.store, p, cantidad, lugar]);
      await banco.su.query(
        `insert into stock_levels (tenant_id, store_id, product_id, quantity) values ($1, $2, $3, $4)
         on conflict (tenant_id, store_id, product_id) do update set quantity = stock_levels.quantity + excluded.quantity`,
        [L.tenant, L.store, p, cantidad]);
    }
  } finally {
    await banco.su.query('alter table inventory_movements enable trigger trg_movimiento_ubicacion');
  }
  assert.deepEqual(await ubicaciones(L, p), { sala: 4, bodega: 6 });

  const aqui = path.dirname(fileURLToPath(import.meta.url));
  await banco.su.query(fs.readFileSync(
    path.join(aqui, '..', '..', 'supabase', 'migrations', '0032_una_bodega_unidad_y_mayorista.sql'), 'utf8'));

  assert.equal(await enUnLugar(L, p), 10);
  const { rows } = await banco.su.query(
    `select ubicacion::text as u, quantity, reason from inventory_movements
      where product_id = $1 and movement_type = 'traslado' order by quantity`, [p]);
  assert.deepEqual(rows.map((x) => `${x.u}${Number(x.quantity)}`), ['bodega-6', 'sala6']);
  assert.ok(rows.every((x) => /0032/.test(x.reason)), 'el traspaso no dice de dónde salió');
});

test('El stock inicial cuadra con la reconstrucción desde el kardex', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 12 });
  assert.equal(await enUnLugar(L, p), 12);
  const r = await banco.su.query(`select fn_rebuild_stock_levels($1) as r`, [L.tenant]);
  assert.equal(r.rows[0].r.corrected_locations, 0, 'la reconstrucción encontró diferencias');
});

test('Nadie escribe las ubicaciones a mano', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 3 });
  const r = await intentar((await banco.como(L.admin)).query(
    `update stock_ubicaciones set quantity = 999 where product_id = $1`, [p]));
  assert.equal(r.ok, false);
  assert.equal(await enUnLugar(L, p), 3);
});

test('Una cantidad negativa al crear no crea nada', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const antes = (await banco.su.query('select count(*)::int as n from products where tenant_id = $1', [L.tenant])).rows[0].n;
  for (const extra of [{ p_initial_stock: -1 }, { p_initial_stock_sala: -1 }]) {
    const r = await intentar(rpc(adm, 'fn_create_product', crear(extra)));
    assert.match(r.error ?? '', /CANTIDAD_NEGATIVA/, JSON.stringify(extra));
  }
  const despues = (await banco.su.query('select count(*)::int as n from products where tenant_id = $1', [L.tenant])).rows[0].n;
  assert.equal(despues, antes, 'quedó un producto a medio crear');
});

// ---------------------------------------------------------------------------
// 0032 · todo por unidad
// ---------------------------------------------------------------------------
test('Un producto siempre es por unidad, se pida lo que se pida', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_create_product', crear({ p_unit: 'kg' }));
  const unidad = async () => (await banco.su.query('select unit from products where id = $1', [r.product_id])).rows[0].unit;
  assert.equal(await unidad(), 'unidad');
  await banco.su.query(`update products set unit = 'litro' where id = $1`, [r.product_id]);
  assert.equal(await unidad(), 'unidad');
});

test('No se vende ni se recibe media unidad', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 10 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  const v = await intentar(rpc(caj, 'fn_register_sale', venta(p, 1.5, 1000, { metodo: 'debito' })));
  assert.match(v.error ?? '', /CANTIDAD_ENTERA/);
  const r = await intentar(rpc(await banco.como(L.admin), 'fn_confirm_receipt', {
    p_supplier_id: await proveedor(L), p_items: [{ product_id: p, quantity: 2.5, unit_cost: 500 }] }));
  assert.match(r.error ?? '', /CANTIDAD_ENTERA/);
  assert.equal(await enUnLugar(L, p), 10, 'algo se movió igual');
});
