/**
 * El día de un local es el de su configuración (`tenants.settings.timezone`),
 * no el de la sesión de la base (UTC en Supabase) ni uno escrito a mano.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function ventaA(local, usuario, cuando) {
  const p = await local.producto({ stock: 5 });
  const c = await banco.como(usuario);
  await intentar(rpc(c, 'fn_open_cash_session', { p_opening_amount: 0 }));
  const v = venta(p, 1, 1000);
  v.p_sold_at = cuando;
  return { c, ...(await rpc(c, 'fn_register_sale', v)) };
}

test('Un supervisor anula en la noche una venta de esa misma noche', async () => {
  // A las 21:30 en Chile ya es el día siguiente en UTC. Antes de 0013 la
  // comparación mezclaba las dos zonas y respondía SIN_PERMISO_ANULAR.
  const L = await nuevoLocal(banco);
  const { rows: [{ hoy }] } = await banco.su.query(
    `select to_char(now() at time zone 'America/Santiago', 'YYYY-MM-DD') as hoy`);
  const { c, sale_id } = await ventaA(L, L.supervisor, `${hoy} 21:30 America/Santiago`);
  const r = await intentar(rpc(c, 'fn_void_sale', { p_sale_id: sale_id, p_reason: 'error' }));
  assert.ok(r.ok, r.error);
});

test('Un supervisor sigue sin poder anular ventas de otro día', async () => {
  const L = await nuevoLocal(banco);
  const { c, sale_id } = await ventaA(L, L.supervisor, new Date(Date.now() - 3 * 86400_000).toISOString());
  const r = await intentar(rpc(c, 'fn_void_sale', { p_sale_id: sale_id, p_reason: 'error' }));
  assert.match(r.error ?? '', /SIN_PERMISO_ANULAR/);
});

test('Los reportes agrupan por el día del local configurado', async () => {
  // 00:30 del 11 en Santiago son las 22:30 del 10 en Isla de Pascua.
  const cuando = '2026-09-11 00:30 America/Santiago';
  const continental = await nuevoLocal(banco, 'Continental');
  const pascua = await nuevoLocal(banco, 'Pascua');
  await banco.su.query(
    `update tenants set settings = settings || '{"timezone":"Pacific/Easter"}' where id = $1`, [pascua.tenant]);

  await ventaA(continental, continental.supervisor, cuando);
  await ventaA(pascua, pascua.supervisor, cuando);

  const dia = async (L) => {
    const c = await banco.como(L.admin);
    const { rows } = await c.query(`select to_char(sale_date, 'YYYY-MM-DD') as d from v_sales_daily`);
    return rows.map((r) => r.d);
  };
  assert.deepEqual(await dia(continental), ['2026-09-11']);
  assert.deepEqual(await dia(pascua), ['2026-09-10']);
});
