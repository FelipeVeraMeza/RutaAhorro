/**
 * Lo que un usuario con sesión puede hacer saltándose la interfaz.
 *
 * Cada prueba es un ataque escrito como lo escribiría alguien con la consola
 * del navegador abierta: la misma llamada que haría `supabase-js`, con el JWT
 * de un usuario real del local. Supabase le concede ALL sobre cada tabla a
 * `authenticated` (el banco lo replica), así que lo único que se interpone es
 * RLS y los permisos de las funciones. Ocultar un botón no cuenta.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco, A, B;
before(async () => {
  banco = await levantarBanco();
  A = await nuevoLocal(banco, 'Local A');
  B = await nuevoLocal(banco, 'Local B');
});
after(async () => { await banco?.bajar(); });

const rechazado = (r, msg) => assert.equal(r.ok, false, msg);
const filas = async (c, sql, params = []) => (await c.query(sql, params)).rows;

async function sesionAbierta(local, usuario) {
  const c = await banco.como(usuario);
  await rpc(c, 'fn_open_cash_session', { p_opening_amount: 20000 });
  const id = (await banco.su.query(
    `select id from cash_sessions where user_id = $1 and status = 'abierta'`, [usuario.id])).rows[0].id;
  return { c, id };
}

// ---------------------------------------------------------------------------
// Permisos de las funciones
// ---------------------------------------------------------------------------

// Lo que `authenticated` puede ejecutar, escrito a mano. Si mañana alguien crea
// una función `security definer` y olvida cerrarla, esta lista deja de
// coincidir y la prueba lo dice, en vez de enterarse por un incidente.
const RPC_PERMITIDAS = [
  'current_store_id', 'current_tenant_id', 'current_user_role', 'is_active_user',
  'fn_add_cash_movement', 'fn_adjust_stock', 'fn_apply_stock_count',
  'fn_cash_session_summary', 'fn_close_cash_session', 'fn_confirm_receipt',
  'fn_create_product', 'fn_open_cash_session', 'fn_register_sale',
  'fn_update_product', 'fn_void_receipt', 'fn_void_sale', 'fn_write_off_lot',
].sort();

test('authenticated solo ejecuta las funciones de negocio, ninguna interna', async () => {
  const r = await filas(banco.su, `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'execute')
     order by 1`);
  assert.deepEqual(r.map((x) => x.proname), RPC_PERMITIDAS);
});

test('anon no ejecuta ninguna función security definer', async () => {
  const r = await filas(banco.su, `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('anon', p.oid, 'execute')
     order by 1`);
  assert.deepEqual(r.map((x) => x.proname), []);
});

test('S-1 · un vendedor no puede escribir en el kardex de otro local', async () => {
  const pB = await B.producto({ stock: 10 });
  const c = await banco.como(A.cajero1);
  rechazado(await intentar(c.query(
    `select fn_post_movement($1, $2, $3, 'ajuste_positivo', 500, 0, null, null, 'x', $4)`,
    [B.tenant, B.store, pB, B.admin.id])));
  rechazado(await intentar(c.query(`select fn_next_folio($1)`, [B.tenant])));
  rechazado(await intentar(c.query(`select fn_rebuild_stock_levels($1)`, [B.tenant])));
  assert.equal(await B.stock(pB), 10);
});

test('S-2 · un vendedor no puede hacerse administrador ni subirse el tope', async () => {
  const c = await banco.como(A.cajero1);
  rechazado(await intentar(c.query(`update profiles set role = 'admin' where id = $1`, [A.cajero1.id])));
  rechazado(await intentar(c.query(`update profiles set max_discount_pct = 100 where id = $1`, [A.cajero1.id])));
  // Pero sí puede corregir su propio nombre, que es para lo que existe la política.
  assert.ok((await intentar(c.query(`update profiles set full_name = 'Cajero Uno' where id = $1`, [A.cajero1.id]))).ok);
});

// ---------------------------------------------------------------------------
// Caja: donde un ataque es plata
// ---------------------------------------------------------------------------

test('Un cajero no puede esconder un faltante con un egreso insertado a mano', async () => {
  const { c, id } = await sesionAbierta(A, A.cajero1);
  const r = await intentar(c.query(
    `insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
     values ($1, $2, 'egreso', 15000, 'retiro autorizado', $3)`, [A.tenant, id, A.supervisor.id]));
  rechazado(r, 'insertó un egreso atribuido al supervisor, sin pasar por fn_add_cash_movement');
});

test('Un cajero no puede escribir su propio arqueo ni reabrir una caja', async () => {
  const { c, id } = await sesionAbierta(A, A.cajero2);
  await intentar(c.query(
    `update cash_sessions set status = 'cerrada', expected_amount = 5000, counted_amount = 5000,
            closed_at = now() where id = $1`, [id]));
  const estado = (await banco.su.query(`select status from cash_sessions where id = $1`, [id])).rows[0].status;
  assert.equal(estado, 'abierta', 'cerró su caja con el esperado que quiso');

  const r2 = await intentar(c.query(
    `insert into cash_sessions (tenant_id, store_id, user_id, opening_amount, status)
     values ($1, $2, $3, 0, 'cerrada')`, [A.tenant, A.store, A.cajero2.id]));
  rechazado(r2, 'creó una caja a mano');
});

test('Un cajero no puede inventar ventas ni pagos fuera de fn_register_sale', async () => {
  const p = await A.producto({ stock: 10 });
  const { id: sesionAjena } = await sesionAbierta(A, A.supervisor);
  const c = await banco.como(A.cajero1);

  rechazado(await intentar(c.query(
    `insert into sales (tenant_id, store_id, folio, cash_session_id, sold_by, total, client_uuid)
     values ($1, $2, 999999, $3, $4, 50000, gen_random_uuid())`,
    [A.tenant, A.store, sesionAjena, A.supervisor.id])), 'insertó una venta en la caja de otro');

  const { rows: [s] } = await banco.su.query(
    `select id from sales where tenant_id = $1 limit 1`, [A.tenant]);
  const saleId = s?.id ?? (await rpc(await banco.como(A.supervisor), 'fn_register_sale', venta(p, 1, 1000))).sale_id;
  rechazado(await intentar(c.query(
    `insert into sale_payments (sale_id, tenant_id, method, amount) values ($1, $2, 'efectivo', 30000)`,
    [saleId, A.tenant])), 'agregó un pago de efectivo a una venta existente');
  rechazado(await intentar(c.query(
    `insert into sale_items (sale_id, tenant_id, product_id, product_name, quantity, unit_price, subtotal)
     values ($1, $2, $3, 'x', 1, 1, 1)`, [saleId, A.tenant, p])), 'agregó una línea a una venta existente');
});

test('Un supervisor no puede editar el total de una venta ni anularla sin devolver stock', async () => {
  const p = await A.producto({ stock: 10 });
  const { c: sup } = await sesionAbierta(A, A.bodega);
  const { sale_id } = await rpc(sup, 'fn_register_sale', venta(p, 2, 1000));
  const s = await banco.como(A.supervisor);
  const r1 = await intentar(s.query(`update sales set total = 1 where id = $1`, [sale_id]));
  const r2 = await intentar(s.query(`update sales set status = 'anulada' where id = $1`, [sale_id]));
  const { rows: [v] } = await banco.su.query(`select total, status from sales where id = $1`, [sale_id]);
  assert.equal(v.total, 2000, `cambió el total (${r1.ok ? 'sin error' : r1.error})`);
  assert.equal(v.status, 'completada', `anuló sin pasar por fn_void_sale (${r2.ok ? 'sin error' : r2.error})`);
});

// ---------------------------------------------------------------------------
// Registros que tienen que ser creíbles
// ---------------------------------------------------------------------------

test('Nadie puede escribir la bitácora a mano', async () => {
  const c = await banco.como(A.cajero1);
  rechazado(await intentar(c.query(
    `insert into audit_log (tenant_id, user_id, action, entity_type) values ($1, $2, 'sale_void', 'sales')`,
    [A.tenant, A.admin.id])), 'insertó una entrada de bitácora a nombre del administrador');
});

test('Nadie puede inventar historial de precios', async () => {
  // T-14 va a comparar el precio de cada venta contra price_history. Si el
  // historial se puede escribir a mano, esa comparación no vale nada.
  const p = await A.producto({ precio: 1000 });
  const c = await banco.como(A.cajero1);
  rechazado(await intentar(c.query(
    `insert into price_history (tenant_id, product_id, old_price, new_price, changed_by)
     values ($1, $2, 1000, 1, $3)`, [A.tenant, p, A.admin.id])));
});

test('Bodega no puede cambiar lotes, tomas ni recepciones por fuera de las funciones', async () => {
  const p = await A.producto({ stock: 5, perecible: true });
  const lote = await A.lote(p, 5, '2027-01-01');
  const toma = (await banco.su.query(
    `insert into stock_counts (tenant_id, store_id, status) values ($1, $2, 'aplicada') returning id`,
    [A.tenant, A.store])).rows[0].id;
  const c = await banco.como(A.bodega);

  await intentar(c.query(`update product_lots set quantity = 500 where id = $1`, [lote]));
  assert.equal(Number((await banco.su.query(`select quantity from product_lots where id = $1`, [lote])).rows[0].quantity), 5,
    'cambió la cantidad del lote sin movimiento en el kardex');

  await intentar(c.query(`update stock_counts set status = 'en_progreso' where id = $1`, [toma]));
  assert.equal((await banco.su.query(`select status from stock_counts where id = $1`, [toma])).rows[0].status, 'aplicada',
    'reabrió una toma aplicada: se podía aplicar otra vez');

  rechazado(await intentar(c.query(
    `insert into purchase_receipts (tenant_id, store_id, document_type, total_amount) values ($1, $2, 'factura', 999999)`,
    [A.tenant, A.store])), 'creó una recepción sin mercadería ni kardex');
});

test('Bodega no puede cambiar el costo promedio a mano', async () => {
  const p = await A.producto({ costo: 600 });
  const c = await banco.como(A.bodega);
  await intentar(c.query(`update products set avg_cost = 1 where id = $1`, [p]));
  const { rows: [r] } = await banco.su.query(`select avg_cost from products where id = $1`, [p]);
  assert.equal(r.avg_cost, 600);
});

// ---------------------------------------------------------------------------
// Aislamiento entre locales y entre roles
// ---------------------------------------------------------------------------

test('Un local no ve ni toca nada de otro', async () => {
  const pB = await B.producto({ stock: 3 });
  const { c: cajB } = await sesionAbierta(B, B.cajero1);
  const { sale_id } = await rpc(cajB, 'fn_register_sale', venta(pB, 1, 1000));

  const adminA = await banco.como(A.admin);
  for (const t of ['products', 'sales', 'sale_items', 'stock_levels', 'profiles', 'cash_sessions', 'inventory_movements']) {
    const r = await filas(adminA, `select count(*)::int as n from ${t} where tenant_id = $1`, [B.tenant]);
    assert.equal(r[0].n, 0, `el admin de A ve ${t} de B`);
  }
  const r = await intentar(rpc(adminA, 'fn_void_sale', { p_sale_id: sale_id, p_reason: 'x' }));
  rechazado(r);
  assert.match(r.error, /VENTA_NO_ENCONTRADA/);
});

test('CP-09 · un vendedor solo ve sus propias ventas', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 20 });
  for (const u of [L.cajero1, L.cajero2]) {
    const { c } = await sesionAbierta(L, u);
    await rpc(c, 'fn_register_sale', venta(p, 1, 1000));
  }
  const cajero = await banco.como(L.cajero1);
  const r = await filas(cajero, `select sold_by from sales`);
  assert.deepEqual(r.map((x) => x.sold_by), [L.cajero1.id]);
});

test('CP-10 · un vendedor no puede leer costos', { todo: 'T-45: products y sale_items entregan el costo a cualquier rol' }, async () => {
  await A.producto({ costo: 777 });
  const c = await banco.como(A.cajero1);
  rechazado(await intentar(c.query(`select avg_cost from products`)), 'leyó avg_cost');
  rechazado(await intentar(c.query(`select unit_cost from sale_items`)), 'leyó el costo de cada línea vendida');
});
