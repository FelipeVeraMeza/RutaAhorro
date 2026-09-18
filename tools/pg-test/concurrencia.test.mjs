/**
 * CP-01 a CP-08 de docs/16-plan-pruebas.md, ejecutados contra PostgreSQL.
 *
 * Cada carrera se fuerza en su peor intercalado: la sesión 1 hace su operación
 * dentro de una transacción que queda abierta, la sesión 2 lanza la suya, se
 * espera a que la 2 quede bloqueada (o termine), y recién entonces se confirma
 * la 1. Así un resultado no depende de la suerte con el planificador.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, esperarBloqueo, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function abrirCaja(usuario, monto = 0) {
  const c = await banco.como(usuario);
  await rpc(c, 'fn_open_cash_session', { p_opening_amount: monto });
  return c;
}

/** Saldo del kardex: la suma de todos los movimientos. Es la fuente de verdad. */
async function kardex(local, producto) {
  const r = await banco.su.query(
    `select coalesce(sum(quantity), 0) as q from inventory_movements where store_id = $1 and product_id = $2`,
    [local.store, producto]);
  return Number(r.rows[0].q);
}

test('CP-01 · dos cajeros venden la última unidad: ninguna venta se pierde', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 1 });
  const c1 = await abrirCaja(local.cajero1);
  const c2 = await abrirCaja(local.cajero2);

  await c1.query('begin');
  await rpc(c1, 'fn_register_sale', venta(p, 1, 1000));
  const segunda = intentar(rpc(c2, 'fn_register_sale', venta(p, 1, 1000)));
  await esperarBloqueo(banco, c2.pid);
  await c1.query('commit');
  const r2 = await segunda;

  const vendidas = r2.ok ? 2 : 1;
  const stock = await local.stock(p);
  assert.equal(stock, 1 - vendidas, 'el stock tiene que reflejar cada venta registrada');
  assert.equal(stock, await kardex(local, p), 'la caché de stock no coincide con el kardex');
  if (stock < 0) {
    const alertas = await banco.su.query(
      `select 1 from alerts where tenant_id = $1 and payload->>'product_id' = $2`, [local.tenant, p]);
    assert.ok(alertas.rows.length > 0, 'stock negativo sin alerta');
  }
});

test('CP-02 · 50 ventas desde 5 cajas: folios consecutivos, sin repetir ni saltar', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 1000 });
  const cajeros = [];
  for (let i = 0; i < 5; i++) {
    const u = i === 0 ? local.cajero1 : i === 1 ? local.cajero2 : null;
    const usuario = u ?? { id: (await banco.su.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [`extra${i}@x.cl`, { tenant_id: local.tenant, store_id: local.store, role: 'vendedor' }])).rows[0].id };
    cajeros.push(await abrirCaja(usuario));
  }

  // Una de cada cinco ventas falla a propósito después de pedir folio: su
  // transacción se deshace y el folio no puede quedar quemado.
  await Promise.all(cajeros.map(async (c) => {
    for (let k = 0; k < 12; k++) {
      const v = venta(p, 1, 1000);
      if (k % 6 === 5) v.p_payments[0].amount = 1;
      await intentar(rpc(c, 'fn_register_sale', v));
    }
  }));

  const { rows: [r] } = await banco.su.query(
    `select count(*)::int as n, count(distinct folio)::int as distintos,
            (max(folio) - min(folio) + 1)::int as rango, min(folio)::int as primero
       from sales where tenant_id = $1`, [local.tenant]);
  assert.equal(r.n, 50);
  assert.equal(r.distintos, 50, 'folios repetidos');
  assert.equal(r.rango, 50, 'folios con saltos');
  assert.equal(r.primero, 1);
});

test('CP-03 · la misma venta enviada tres veces queda una sola vez', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10 });
  const c = await abrirCaja(local.cajero1);
  const v = venta(p, 1, 1000);

  const r1 = await rpc(c, 'fn_register_sale', v);
  const r2 = await rpc(c, 'fn_register_sale', v);
  const r3 = await rpc(c, 'fn_register_sale', v);
  assert.equal(r1.already_existed, false);
  assert.equal(r2.already_existed, true);
  assert.equal(r3.already_existed, true);
  assert.equal(r2.folio, r1.folio);
  assert.equal(await local.stock(p), 9);
});

test('CP-03b · reintento que llega mientras el primer envío sigue en curso', async () => {
  // El caso real del modo offline: el celular manda la venta, la red se corta
  // antes de la respuesta y la cola reintenta mientras el servidor todavía
  // está procesando el primer envío. El reintento no puede volver como error:
  // la cola lo marcaría como fallido y alguien volvería a cobrar.
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10 });
  const a = await abrirCaja(local.cajero1);
  const b = await banco.como(local.cajero1);
  const v = venta(p, 1, 1000);

  await a.query('begin');
  const r1 = await rpc(a, 'fn_register_sale', v);
  const reintento = intentar(rpc(b, 'fn_register_sale', v));
  await esperarBloqueo(banco, b.pid);
  await a.query('commit');
  const r2 = await reintento;

  assert.ok(r2.ok, `el reintento devolvió error: ${r2.error}`);
  assert.equal(r2.valor.already_existed, true);
  assert.equal(r2.valor.folio, r1.folio);
  assert.equal(await local.stock(p), 9);
});

test('CP-04 · FEFO: dos cajeros no descuentan dos veces del mismo lote', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 15, perecible: true });
  const loteA = await local.lote(p, 5, '2026-09-20');
  const loteB = await local.lote(p, 10, '2026-10-15');
  const c1 = await abrirCaja(local.cajero1);
  const c2 = await abrirCaja(local.cajero2);

  await c1.query('begin');
  await rpc(c1, 'fn_register_sale', venta(p, 4, 1000));
  const segunda = intentar(rpc(c2, 'fn_register_sale', venta(p, 4, 1000)));
  await esperarBloqueo(banco, c2.pid);
  await c1.query('commit');
  const r2 = await segunda;
  assert.ok(r2.ok, r2.error);

  const q = async (id) => Number((await banco.su.query(
    `select quantity from product_lots where id = $1`, [id])).rows[0].quantity);
  assert.equal(await q(loteA), 0);
  assert.equal(await q(loteB), 7);
  assert.equal(await local.stock(p), 7);
});

test('CP-05 · la misma toma de inventario no se aplica dos veces', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10 });
  const toma = (await banco.su.query(
    `insert into stock_counts (tenant_id, store_id, started_by) values ($1, $2, $3) returning id`,
    [local.tenant, local.store, local.supervisor.id])).rows[0].id;
  const items = [{ product_id: p, counted_qty: 7 }];

  const u1 = await banco.como(local.supervisor);
  const u2 = await banco.como(local.bodega);
  await u1.query('begin');
  await rpc(u1, 'fn_apply_stock_count', { p_count_id: toma, p_items: items });
  const segunda = intentar(rpc(u2, 'fn_apply_stock_count', { p_count_id: toma, p_items: items }));
  await esperarBloqueo(banco, u2.pid);
  await u1.query('commit');
  const r2 = await segunda;

  assert.equal(r2.ok, false, 'la segunda aplicación tenía que fallar');
  assert.match(r2.error, /TOMA_YA_APLICADA/);
  const ajustes = await banco.su.query(
    `select count(*)::int as n from inventory_movements where reference_id = $1`, [toma]);
  assert.equal(ajustes.rows[0].n, 1, 'los ajustes se generaron más de una vez');
  assert.equal(await local.stock(p), 7);
});

test.todo('CP-06 · edición simultánea del mismo producto (no implementado: P-24)');

test('CP-07 · cierre forzado mientras el cajero cobra: el arqueo incluye esa venta', async () => {
  // Si el supervisor calcula el esperado mientras la venta todavía no se
  // confirma, y la venta se confirma después dentro de la caja ya cerrada, el
  // efectivo de esa venta está en el cajón y no está en el esperado. El
  // descuadre no tiene explicación posible para quien lo revise.
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10 });
  const cajero = await abrirCaja(local.cajero1, 10000);
  const sup = await banco.como(local.supervisor);
  const sesion = (await banco.su.query(
    `select id from cash_sessions where user_id = $1 and status = 'abierta'`, [local.cajero1.id])).rows[0].id;

  await cajero.query('begin');
  const rv = await intentar(rpc(cajero, 'fn_register_sale', venta(p, 1, 5000)));
  const cierre = intentar(rpc(sup, 'fn_close_cash_session', {
    p_session_id: sesion, p_counted_amount: 15000, p_notes: 'cierre forzado' }));
  await esperarBloqueo(banco, sup.pid);
  await cajero.query('commit');
  const rc = await cierre;
  assert.ok(rv.ok && rc.ok, rv.error ?? rc.error);

  const { rows: [s] } = await banco.su.query(
    `select expected_amount from cash_sessions where id = $1`, [sesion]);
  const ventas = await banco.su.query(
    `select count(*)::int as n from sales where cash_session_id = $1`, [sesion]);
  assert.equal(ventas.rows[0].n, 1);
  assert.equal(s.expected_amount, 15000, 'la venta quedó en la caja cerrada pero fuera del arqueo');
});

test('CP-07b · una caja cerrada no recibe ventas ni movimientos', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10 });
  const cajero = await abrirCaja(local.cajero1);
  const sup = await banco.como(local.supervisor);
  const sesion = (await banco.su.query(
    `select id from cash_sessions where user_id = $1 and status = 'abierta'`, [local.cajero1.id])).rows[0].id;
  await rpc(sup, 'fn_close_cash_session', { p_session_id: sesion, p_counted_amount: 0, p_notes: null });

  const rv = await intentar(rpc(cajero, 'fn_register_sale', venta(p, 1, 1000)));
  assert.equal(rv.ok, false);
  assert.match(rv.error, /CAJA_NO_ABIERTA|CAJA_YA_CERRADA/);
  const rm = await intentar(rpc(cajero, 'fn_add_cash_movement', { p_type: 'egreso', p_amount: 100, p_reason: 'x' }));
  assert.equal(rm.ok, false);
  assert.equal(await local.stock(p), 10);
});

test('CP-08 · el mismo usuario abre caja desde dos dispositivos a la vez', async () => {
  const local = await nuevoLocal(banco);
  const d1 = await banco.como(local.cajero1);
  const d2 = await banco.como(local.cajero1);

  await d1.query('begin');
  await rpc(d1, 'fn_open_cash_session', { p_opening_amount: 0 });
  const segunda = intentar(rpc(d2, 'fn_open_cash_session', { p_opening_amount: 0 }));
  await esperarBloqueo(banco, d2.pid);
  await d1.query('commit');
  const r2 = await segunda;

  assert.equal(r2.ok, false);
  assert.match(r2.error, /CAJA_YA_ABIERTA/, `llegó otro error: ${r2.error}`);
  const n = await banco.su.query(
    `select count(*)::int as n from cash_sessions where user_id = $1 and status = 'abierta'`, [local.cajero1.id]);
  assert.equal(n.rows[0].n, 1);
});

// ---------------------------------------------------------------------------
// Fuera del plan: el mismo patrón que CP-05 —leer el estado sin bloquearlo y
// después actuar— aparece en cuatro funciones más. Cada una se prueba igual.
// ---------------------------------------------------------------------------

/** Lanza la misma operación desde dos sesiones en el peor intercalado. */
async function dosVeces(s1, s2, fn, args) {
  await s1.query('begin');
  const r1 = await intentar(rpc(s1, fn, args));
  const segunda = intentar(rpc(s2, fn, args));
  await esperarBloqueo(banco, s2.pid);
  await s1.query(r1.ok ? 'commit' : 'rollback');
  return [r1, await segunda];
}

test('Anular la misma venta desde dos pantallas devuelve el stock una sola vez', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10 });
  const cajero = await abrirCaja(local.cajero1);
  const { sale_id } = await rpc(cajero, 'fn_register_sale', venta(p, 3, 1000));
  assert.equal(await local.stock(p), 7);

  const [r1, r2] = await dosVeces(await banco.como(local.admin), await banco.como(local.supervisor),
    'fn_void_sale', { p_sale_id: sale_id, p_reason: 'error de digitación' });
  assert.ok(r1.ok, r1.error);
  assert.equal(r2.ok, false, 'la segunda anulación tenía que fallar');
  assert.match(r2.error, /VENTA_YA_ANULADA/);
  assert.equal(await local.stock(p), 10, 'el stock se devolvió dos veces');
});

test('Anular la misma recepción dos veces descuenta el stock una sola vez', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 0 });
  const prov = (await banco.su.query(
    `insert into suppliers (tenant_id, name) values ($1, 'Prov') returning id`, [local.tenant])).rows[0].id;
  const adm = await banco.como(local.admin);
  const { receipt_id } = await rpc(adm, 'fn_confirm_receipt', {
    p_supplier_id: prov, p_items: [{ product_id: p, quantity: 10, unit_cost: 500 }] });

  const segundoAdmin = { id: (await banco.su.query(
    `insert into auth.users (email, raw_user_meta_data) values ('adm2@x.cl', $1) returning id`,
    [{ tenant_id: local.tenant, store_id: local.store, role: 'admin' }])).rows[0].id };
  const [r1, r2] = await dosVeces(adm, await banco.como(segundoAdmin),
    'fn_void_receipt', { p_receipt_id: receipt_id, p_reason: 'guía equivocada' });
  assert.ok(r1.ok, r1.error);
  assert.equal(r2.ok, false, 'la segunda anulación tenía que fallar');
  assert.equal(await local.stock(p), 0, 'la recepción se descontó dos veces');
});

test('Dar de baja el mismo lote dos veces descuenta el lote una sola vez', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 5, perecible: true });
  const lote = await local.lote(p, 5, '2026-01-01');

  const [r1, r2] = await dosVeces(await banco.como(local.supervisor), await banco.como(local.bodega),
    'fn_write_off_lot', { p_lot_id: lote, p_reason: 'vencido' });
  assert.ok(r1.ok, r1.error);
  assert.ok(!r2.ok || r2.valor.changed === false, 'la segunda baja volvió a descontar');
  assert.equal(await local.stock(p), 0, 'el lote se dio de baja dos veces');
});

test('Dos recepciones del mismo producto a la vez: el costo promedio considera ambas', async () => {
  // 10 u a $100 en bodega. Llegan 10 u a $200 y 10 u a $400.
  // En orden: 10@100 + 10@200 = 150 · 20@150 + 10@400 = 233.
  // Si la segunda lee el promedio antes de que la primera confirme, calcula
  // 10@100 + 10@400 = 250 y pisa el resultado de la primera.
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10, costo: 100 });
  const prov = (await banco.su.query(
    `insert into suppliers (tenant_id, name) values ($1, 'Prov') returning id`, [local.tenant])).rows[0].id;
  const s1 = await banco.como(local.bodega);
  const s2 = await banco.como(local.supervisor);

  await s1.query('begin');
  await rpc(s1, 'fn_confirm_receipt', { p_supplier_id: prov, p_items: [{ product_id: p, quantity: 10, unit_cost: 200 }] });
  const segunda = intentar(rpc(s2, 'fn_confirm_receipt', {
    p_supplier_id: prov, p_items: [{ product_id: p, quantity: 10, unit_cost: 400 }] }));
  await esperarBloqueo(banco, s2.pid);
  await s1.query('commit');
  assert.ok((await segunda).ok);

  const { rows: [r] } = await banco.su.query(`select avg_cost from products where id = $1`, [p]);
  assert.equal(await local.stock(p), 30);
  assert.equal(r.avg_cost, 233, 'la segunda recepción calculó con un promedio viejo');
});

test('Dos ajustes "dejar en 7" al mismo tiempo dejan 7, no 4', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 10 });
  const [r1, r2] = await dosVeces(await banco.como(local.supervisor), await banco.como(local.bodega),
    'fn_adjust_stock', { p_product_id: p, p_new_quantity: 7, p_movement_type: 'ajuste_negativo', p_reason: 'conteo' });
  assert.ok(r1.ok && r2.ok, r1.error ?? r2.error);
  assert.equal(await local.stock(p), 7);
});

test('ADR-005 · vender en negativo alerta aunque el producto no tenga mínimo', async () => {
  const local = await nuevoLocal(banco);
  const p = await local.producto({ stock: 1 });
  const sup = await abrirCaja(local.supervisor);
  await rpc(sup, 'fn_register_sale', venta(p, 3, 1000));
  assert.equal(await local.stock(p), -2);
  const { rows } = await banco.su.query(
    `select severity from alerts where tenant_id = $1 and payload->>'product_id' = $2`, [local.tenant, p]);
  assert.deepEqual(rows.map((r) => r.severity), ['critical']);
});
