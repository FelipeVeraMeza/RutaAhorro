/**
 * 0033 · La utilidad de Reportes, sin IVA.
 *
 * El costo es neto (docs/26 N° 13). La utilidad restaba ese costo del ingreso
 * con IVA: un producto de $2.490 con costo neto $1.850 mostraba $640 y deja
 * $242.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function porProducto(L) {
  const { rows } = await banco.su.query(
    `select product_name, revenue, cost, gross_profit from v_sales_by_product where tenant_id = $1 order by product_name`,
    [L.tenant]);
  return Object.fromEntries(rows.map((r) => [r.product_name, { ingreso: Number(r.revenue), costo: Number(r.cost), utilidad: Number(r.gross_profit) }]));
}

test('el ejemplo de docs/26: $2.490 con costo neto $1.850 deja $242, no $640', async () => {
  const L = await nuevoLocal(banco);
  const aceite = await L.producto({ nombre: 'Aceite', precio: 2490, costo: 1850, stock: 10 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  await rpc(caj, 'fn_register_sale', venta(aceite, 1, 2490, { metodo: 'debito' }));
  const r = await porProducto(L);
  assert.deepEqual(r.Aceite, { ingreso: 2490, costo: 1850, utilidad: 242 });
});

test('una bebida con impuesto adicional descuenta también ese impuesto, y la devolución resta', async () => {
  const L = await nuevoLocal(banco);
  const bebida = await L.producto({ nombre: 'Bebida', precio: 1370, costo: 700, stock: 10 });
  const adm = await banco.como(L.admin);
  const iaba = await rpc(adm, 'fn_guardar_impuesto', { p_id: null, p_nombre: 'IABA', p_codigo_sii: 271, p_tasa: 18, p_activo: true });
  await rpc(adm, 'fn_asignar_impuesto', { p_productos: `{${bebida}}`, p_impuesto: iaba });
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 0 });
  // $1.370 / 1,37 = $1.000 neto: deja $300 sobre el costo, no $670.
  const v = await rpc(adm, 'fn_register_sale', venta(bebida, 2, 1370));
  assert.deepEqual((await porProducto(L)).Bebida, { ingreso: 2740, costo: 1400, utilidad: 600 });

  // Devuelve una: la utilidad baja lo que esa unidad dejaba.
  const { rows: [linea] } = await banco.su.query(`select id from sale_items where sale_id = $1`, [v.sale_id]);
  await rpc(adm, 'fn_devolver_venta', {
    p_sale_id: v.sale_id, p_items: [{ sale_item_id: linea.id, cantidad: 1 }], p_motivo: 'prueba', p_reembolso: 'efectivo' });
  assert.deepEqual((await porProducto(L)).Bebida, { ingreso: 1370, costo: 700, utilidad: 300 });
});
