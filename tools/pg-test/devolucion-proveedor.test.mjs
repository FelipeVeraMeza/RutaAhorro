/**
 * 0035 · Devolución a proveedor (RQ-35).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, esperarBloqueo } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function preparar() {
  const L = await nuevoLocal(banco);
  const prov = (await banco.su.query(
    `insert into suppliers (tenant_id, name) values ($1, 'Lácteos del Sur') returning id`, [L.tenant])).rows[0].id;
  return { L, prov };
}

test('devuelve al costo promedio: baja el stock, el kardex lo dice y el promedio no cambia', async () => {
  const { L, prov } = await preparar();
  const p = await L.producto({ nombre: 'Jugo', precio: 1290, costo: 700, stock: 10 });
  const bod = await banco.como(L.bodega);
  const r = await rpc(bod, 'fn_devolver_a_proveedor', {
    p_supplier_id: prov, p_items: [{ product_id: p, quantity: 4 }], p_motivo: 'Envases dañados', p_documento: 'GD-15' });
  assert.equal(r.total_costo, 2800);
  assert.equal(await L.stock(p), 6);
  const { rows: [m] } = await banco.su.query(
    `select movement_type::text as t, quantity, unit_cost, reason from inventory_movements
      where product_id = $1 and reference_type = 'devolucion_proveedor'`, [p]);
  assert.deepEqual([m.t, Number(m.quantity), m.unit_cost, m.reason], ['devolucion_proveedor', -4, 700, 'Envases dañados']);
  const { rows: [prod] } = await banco.su.query('select avg_cost from products where id = $1', [p]);
  assert.equal(prod.avg_cost, 700, 'sacar al costo promedio no mueve el promedio');
  const { rows: [d] } = await banco.su.query('select documento, motivo, total_costo from devoluciones_proveedor where id = $1', [r.id]);
  assert.deepEqual(d, { documento: 'GD-15', motivo: 'Envases dañados', total_costo: 2800 });
});

test('un perecible sale del lote elegido, o del que vence primero', async () => {
  const { L, prov } = await preparar();
  const leche = await L.producto({ nombre: 'Leche', precio: 1190, costo: 800, perecible: true, stock: 10 });
  const temprano = await L.lote(leche, 4, '2099-01-10');
  const tarde = await L.lote(leche, 6, '2099-03-10');
  const sup = await banco.como(L.supervisor);
  const lote = async (id) => Number((await banco.su.query('select quantity from product_lots where id = $1', [id])).rows[0].quantity);
  await rpc(sup, 'fn_devolver_a_proveedor', { p_supplier_id: prov, p_items: [{ product_id: leche, quantity: 2, lot_id: tarde }], p_motivo: 'Lote con mal olor' });
  assert.deepEqual([await lote(temprano), await lote(tarde)], [4, 4], 'el elegido');
  await rpc(sup, 'fn_devolver_a_proveedor', { p_supplier_id: prov, p_items: [{ product_id: leche, quantity: 5 }], p_motivo: 'Por vencer' });
  assert.deepEqual([await lote(temprano), await lote(tarde)], [0, 3], 'sin elegir, FEFO');
  assert.equal(await L.stock(leche), 3);
});

test('no se devuelve más de lo que hay, ni medias unidades, ni sin motivo o proveedor', async () => {
  const { L, prov } = await preparar();
  const p = await L.producto({ nombre: 'Pan', stock: 3 });
  const adm = await banco.como(L.admin);
  const casos = [
    [{ p_supplier_id: prov, p_items: [{ product_id: p, quantity: 4 }], p_motivo: 'x' }, /STOCK_INSUFICIENTE/],
    [{ p_supplier_id: prov, p_items: [{ product_id: p, quantity: 1.5 }], p_motivo: 'x' }, /CANTIDAD_ENTERA/],
    [{ p_supplier_id: prov, p_items: [{ product_id: p, quantity: 1 }], p_motivo: '  ' }, /MOTIVO_REQUERIDO/],
    [{ p_supplier_id: null, p_items: [{ product_id: p, quantity: 1 }], p_motivo: 'x' }, /PROVEEDOR_REQUERIDO/],
    [{ p_supplier_id: prov, p_items: [], p_motivo: 'x' }, /DEVOLUCION_SIN_PRODUCTOS/],
  ];
  for (const [args, error] of casos) {
    const r = await intentar(rpc(adm, 'fn_devolver_a_proveedor', args));
    assert.match(r.error ?? '', error, JSON.stringify(args));
  }
  assert.equal(await L.stock(p), 3, 'ningún intento movió stock');
  const { rows: [n] } = await banco.su.query('select count(*)::int as n from devoluciones_proveedor where tenant_id = $1', [L.tenant]);
  assert.equal(n.n, 0, 'ni dejó devoluciones a medias');
});

test('el vendedor no devuelve, nadie escribe la tabla a mano, y otro local no ve nada', async () => {
  const { L, prov } = await preparar();
  const p = await L.producto({ stock: 5 });
  const caj = await banco.como(L.cajero1);
  const r = await intentar(rpc(caj, 'fn_devolver_a_proveedor', { p_supplier_id: prov, p_items: [{ product_id: p, quantity: 1 }], p_motivo: 'x' }));
  assert.match(r.error ?? '', /SIN_PERMISO/);
  const adm = await banco.como(L.admin);
  const directo = await intentar(adm.query(
    `insert into devoluciones_proveedor (tenant_id, store_id, supplier_id, motivo) values ($1, $2, $3, 'x')`, [L.tenant, L.store, prov]));
  assert.equal(directo.ok, false, 'se pudo insertar a mano');
  await rpc(adm, 'fn_devolver_a_proveedor', { p_supplier_id: prov, p_items: [{ product_id: p, quantity: 1 }], p_motivo: 'x' });
  const otro = await nuevoLocal(banco, 'Otro');
  const { rows } = await (await banco.como(otro.admin)).query('select id from devoluciones_proveedor');
  assert.equal(rows.length, 0);
});

test('dos devoluciones a la vez no sacan lo que no hay', async () => {
  const { L, prov } = await preparar();
  const p = await L.producto({ stock: 5 });
  const a = await banco.como(L.admin);
  const b = await banco.como(L.supervisor);
  await a.query('begin');
  await rpc(a, 'fn_devolver_a_proveedor', { p_supplier_id: prov, p_items: [{ product_id: p, quantity: 4 }], p_motivo: 'uno' });
  const segunda = intentar(rpc(b, 'fn_devolver_a_proveedor', { p_supplier_id: prov, p_items: [{ product_id: p, quantity: 4 }], p_motivo: 'dos' }));
  await esperarBloqueo(banco, b.pid);
  await a.query('commit');
  assert.match((await segunda).error ?? '', /STOCK_INSUFICIENTE/);
  assert.equal(await L.stock(p), 1);
});
