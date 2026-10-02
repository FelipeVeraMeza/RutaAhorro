/**
 * 0037 · Lo que la pantalla validaba y la base no (docs/28).
 *
 * OJO: escritas en un contenedor donde PostgreSQL no podía levantarse (corre
 * como root y initdb lo rechaza). Hay que correrlas — y verlas fallar sin
 * 0037 (regla 16) — antes de dar por bueno el arreglo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

test('registro público: metadata con un local ajeno y sin autorización no deja perfil', async () => {
  const L = await nuevoLocal(banco);
  const { rows: [u] } = await banco.su.query(
    `insert into auth.users (email, raw_user_meta_data) values ('intruso@x.cl', $1) returning id`,
    [{ tenant_id: L.tenant, store_id: L.store, role: 'admin', full_name: 'Intruso' }]);
  const { rows } = await banco.su.query('select 1 from profiles where id = $1', [u.id]);
  assert.equal(rows.length, 0, 'se creó un administrador con solo escribir el metadata');
});

test('fn_register_sale rechaza pagos negativos y no acepta ventas del futuro', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 10 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });

  const v = venta(p, 1, 1000, { metodo: 'debito' });
  v.p_payments = [{ method: 'efectivo', amount: 2000 }, { method: 'debito', amount: -1000 }];
  const r = await intentar(rpc(caj, 'fn_register_sale', v));
  assert.equal(r.ok, false);
  assert.match(r.error, /MONTO_NEGATIVO/);

  const f = venta(p, 1, 1000, { metodo: 'debito' });
  f.p_sold_at = new Date(Date.now() + 86_400_000).toISOString();
  const { sale_id } = await rpc(caj, 'fn_register_sale', f);
  const { rows: [s] } = await banco.su.query('select sold_at <= now() as ok from sales where id = $1', [sale_id]);
  assert.ok(s.ok, 'la venta quedó con la fecha de mañana');
});

test('bodega no abre caja', async () => {
  const L = await nuevoLocal(banco);
  const r = await intentar(rpc(await banco.como(L.bodega), 'fn_open_cash_session', { p_opening_amount: 0 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /SIN_PERMISO/);
});

test('ajustes: sin negativos, la merma no suma y el tipo sigue al signo', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 10 });
  const adm = await banco.como(L.admin);
  const ajustar = (cantidad, tipo) => intentar(rpc(adm, 'fn_adjust_stock', {
    p_product_id: p, p_new_quantity: cantidad, p_movement_type: tipo, p_reason: 'prueba' }));

  assert.match((await ajustar(-5, 'ajuste_negativo')).error ?? '', /CANTIDAD_NEGATIVA/);
  assert.match((await ajustar(20, 'merma')).error ?? '', /MERMA_SUMA_STOCK/);
  assert.equal(await L.stock(p), 10);

  // La pantalla calculó "resta" con un stock viejo; la base lo corrige.
  assert.ok((await ajustar(12, 'ajuste_negativo')).ok);
  const { rows: [m] } = await banco.su.query(
    `select movement_type::text as t from inventory_movements where product_id = $1 order by created_at desc limit 1`, [p]);
  assert.equal(m.t, 'ajuste_positivo');
});

test('toma: un conteo negativo no se aplica', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 4 });
  const { rows: [t] } = await banco.su.query(
    `insert into stock_counts (tenant_id, store_id) values ($1, $2) returning id`, [L.tenant, L.store]);
  const r = await intentar(rpc(await banco.como(L.bodega), 'fn_apply_stock_count', {
    p_count_id: t.id, p_items: [{ product_id: p, counted_qty: -1 }] }));
  assert.match(r.error ?? '', /CANTIDAD_NEGATIVA/);
  assert.equal(await L.stock(p), 4);
});

test('recepción: cantidad cero o costo negativo se rechazan', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const adm = await banco.como(L.admin);
  const recibir = (item) => intentar(rpc(adm, 'fn_confirm_receipt', { p_supplier_id: null, p_items: [{ product_id: p, ...item }] }));
  assert.match((await recibir({ quantity: 0, unit_cost: 500 })).error ?? '', /CANTIDAD_INVALIDA/);
  assert.match((await recibir({ quantity: -10, unit_cost: 500 })).error ?? '', /CANTIDAD_INVALIDA/);
  assert.match((await recibir({ quantity: 5, unit_cost: -1 })).error ?? '', /MONTO_NEGATIVO/);
  assert.equal(await L.stock(p), 0);
});

test('anular una venta de una caja ya cerrada deja el egreso del efectivo en la caja de quien anula', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 10 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  // Efectivo y débito: el documento es el voucher, la venta se puede anular.
  const v = venta(p, 1, 1000, { metodo: 'debito' });
  v.p_payments = [{ method: 'efectivo', amount: 600 }, { method: 'debito', amount: 400 }];
  const { sale_id } = await rpc(caj, 'fn_register_sale', v);
  const { rows: [sesion] } = await banco.su.query(
    `select id from cash_sessions where user_id = $1 and status = 'abierta'`, [L.cajero1.id]);
  const resumen = await rpc(caj, 'fn_cash_session_summary', { p_session_id: sesion.id });
  await rpc(caj, 'fn_close_cash_session', { p_session_id: sesion.id, p_counted_amount: resumen.expected_amount });

  const adm = await banco.como(L.admin);
  const sinCaja = await intentar(rpc(adm, 'fn_void_sale', { p_sale_id: sale_id, p_reason: 'cobro equivocado' }));
  assert.match(sinCaja.error ?? '', /CAJA_NO_ABIERTA_DEVOLUCION/);

  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 5000 });
  await rpc(adm, 'fn_void_sale', { p_sale_id: sale_id, p_reason: 'cobro equivocado' });
  const { rows: [eg] } = await banco.su.query(
    `select cm.amount from cash_movements cm join cash_sessions cs on cs.id = cm.cash_session_id
      where cs.user_id = $1 and cs.status = 'abierta' and cm.type = 'egreso'`, [L.admin.id]);
  assert.equal(eg?.amount, 600, 'el efectivo devuelto no quedó como egreso');
  const { rows: [cerrada] } = await banco.su.query('select expected_amount from cash_sessions where id = $1', [sesion.id]);
  assert.equal(cerrada.expected_amount, resumen.expected_amount, 'la caja cerrada no cambia');
});

test('un combo que ya no sale más barato se puede desactivar', async () => {
  const L = await nuevoLocal(banco);
  const a = await L.producto({ precio: 1000 });
  const b = await L.producto({ precio: 1000 });
  const adm = await banco.como(L.admin);
  const items = [{ product_id: a, cantidad: 1 }, { product_id: b, cantidad: 1 }];
  const id = await rpc(adm, 'fn_guardar_combo', { p_id: null, p_datos: { nombre: 'Once', precio: 1800, items } });
  await banco.su.query('update products set sale_price = 800 where id = $1', [a]);
  await rpc(adm, 'fn_guardar_combo', { p_id: id, p_datos: { nombre: 'Once', precio: 1800, activo: false, items } });
  const { rows: [c] } = await banco.su.query('select is_active from combos where id = $1', [id]);
  assert.equal(c.is_active, false, 'el combo siguió activo');
});

test('el resumen de una caja solo lo ve su dueño, el admin y el supervisor', async () => {
  const L = await nuevoLocal(banco);
  const c1 = await banco.como(L.cajero1);
  const sesion = await rpc(c1, 'fn_open_cash_session', { p_opening_amount: 5000 });
  const id = typeof sesion === 'string' ? sesion : sesion.session_id ?? sesion.id;
  for (const ajeno of [L.cajero2, L.bodega]) {
    const r = await intentar(rpc(await banco.como(ajeno), 'fn_cash_session_summary', { p_session_id: id }));
    assert.equal(r.ok, false);
    assert.match(r.error, /SIN_PERMISO/);
  }
  assert.equal((await rpc(c1, 'fn_cash_session_summary', { p_session_id: id })).opening_amount, 5000);
  assert.equal((await rpc(await banco.como(L.supervisor), 'fn_cash_session_summary', { p_session_id: id })).opening_amount, 5000);
});
