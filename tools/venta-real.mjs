/**
 * La primera venta real: el circuito completo contra el Supabase de verdad,
 * hecho como lo hace la aplicación (supabase-js, llave pública, inicio de
 * sesión con correo y contraseña). Y los ataques de tools/pg-test repetidos
 * contra la base real, que es T-46: la réplica local es cuidadosa, pero es una
 * réplica.
 *
 *   npm run db:e2e
 *
 * Corre en un local aparte, "QA · pruebas internas", con sus propios usuarios.
 * No toca el local del cliente: sus reportes no van a mostrar ventas de
 * prueba. Pero lo que escribe es permanente —el kardex y la bitácora son
 * inmutables—, así que todo queda en ese local y el producto se desactiva al
 * final. Se puede correr las veces que haga falta.
 *
 * Las contraseñas de los usuarios QA se regeneran en cada ejecución y no se
 * muestran ni se guardan.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(raiz, '.env.local') });

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLICA = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRETA = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !PUBLICA || !SECRETA) {
  console.error('\n✖ Faltan NEXT_PUBLIC_SUPABASE_URL, la llave pública o la secreta en .env.local\n');
  process.exit(1);
}

const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient(URL_SB, SECRETA, opciones);
const LOCAL_QA = 'QA · pruebas internas';

// ------------------------------------------------------------------ registro
const resultados = [];
let seccion = '';
function titulo(t) { seccion = t; console.log(`\n${t}`); }
function marcar(ok, texto, detalle = '') {
  resultados.push({ ok, texto: `${seccion} · ${texto}` });
  console.log(`  ${ok ? '✔' : '✖'} ${texto}${detalle ? ` — ${detalle}` : ''}`);
  return ok;
}
async function paso(texto, fn) {
  try {
    const d = await fn();
    marcar(true, texto, typeof d === "string" ? d : "");
    return d;
  } catch (e) {
    marcar(false, texto, e.message);
    return undefined;
  }
}
/** Un ataque tiene que fallar: si pasa, es un hallazgo. */
async function ataque(texto, fn, verificar) {
  let error = null;
  try { const r = await fn(); error = r?.error ?? null; } catch (e) { error = e; }
  const intacto = verificar ? await verificar() : Boolean(error);
  return marcar(intacto, texto, intacto ? 'rechazado' : 'PASÓ: es un agujero');
}
const datos = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ------------------------------------------------------------- preparación
titulo('Preparación (con la llave de servicio)');

const { data: tablas } = await servicio.from('tenants').select('id').limit(1);
if (!tablas) {
  console.error('\n✖ El esquema no está instalado. Primero: npm run db:aplicar -- --aplicar\n');
  process.exit(1);
}

const local = await paso(`Local "${LOCAL_QA}"`, async () => {
  let t = datos(await servicio.from('tenants').select('id').eq('name', LOCAL_QA).maybeSingle());
  if (!t) t = datos(await servicio.from('tenants').insert({ name: LOCAL_QA }).select('id').single());
  let s = datos(await servicio.from('stores').select('id').eq('tenant_id', t.id).limit(1).maybeSingle());
  if (!s) s = datos(await servicio.from('stores').insert({ tenant_id: t.id, name: 'Casa matriz' }).select('id').single());
  return { tenant: t.id, store: s.id };
});
if (!local) process.exit(1);

const ref = new globalThis.URL(URL_SB).hostname.split('.')[0];
async function usuarioQA(alias, rol) {
  const correo = `qa-${alias}-${ref}@example.com`;
  const clave = randomBytes(18).toString('base64url');
  const meta = { tenant_id: local.tenant, store_id: local.store, role: rol, full_name: `QA ${alias}` };
  const lista = datos(await servicio.auth.admin.listUsers({ perPage: 1000 }));
  const previo = lista.users.find((u) => u.email === correo);
  const id = previo
    ? datos(await servicio.auth.admin.updateUserById(previo.id, { password: clave })).user.id
    : datos(await servicio.auth.admin.createUser({ email: correo, password: clave, email_confirm: true, user_metadata: meta })).user.id;
  const perfil = datos(await servicio.from('profiles').select('role, is_active').eq('id', id).maybeSingle());
  if (!perfil) throw new Error(`${correo} quedó sin perfil: handle_new_user no lo creó`);
  if (perfil.role !== rol) throw new Error(`${correo} tiene rol ${perfil.role}, se esperaba ${rol}`);
  const cliente = createClient(URL_SB, PUBLICA, opciones);
  datos(await cliente.auth.signInWithPassword({ email: correo, password: clave }));
  return { id, cliente };
}

const admin = await paso('Administrador QA inicia sesión', () => usuarioQA('admin', 'admin'));
const cajero = await paso('Cajero QA (vendedor) inicia sesión', () => usuarioQA('cajero', 'vendedor'));
if (!admin || !cajero) { resumen(); }

const stockDe = async (producto) => {
  const r = datos(await servicio.from('stock_levels').select('quantity')
    .eq('store_id', local.store).eq('product_id', producto).maybeSingle());
  return Number(r?.quantity ?? 0);
};

// ---------------------------------------------------------- catálogo y stock
titulo('Catálogo y recepción (como administrador)');

const producto = await paso('Crear producto por fn_create_product', async () => {
  const r = datos(await admin.cliente.rpc('fn_create_product', {
    p_name: `QA Producto ${new Date().toISOString().slice(0, 16)}`, p_sku: null, p_description: 'Producto de prueba',
    p_category_id: null, p_unit: 'unidad', p_sale_price: 1500, p_avg_cost: 900, p_min_stock: 0,
    p_tracks_expiry: false, p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0 }));
  return r.product_id;
});

await paso('Recepción de 10 unidades a $900', async () => {
  let prov = datos(await admin.cliente.from('suppliers').select('id').eq('name', 'Proveedor QA').maybeSingle());
  if (!prov) prov = datos(await admin.cliente.from('suppliers').insert({ tenant_id: local.tenant, name: 'Proveedor QA' }).select('id').single());
  datos(await admin.cliente.rpc('fn_confirm_receipt', {
    p_supplier_id: prov.id, p_items: [{ product_id: producto, quantity: 10, unit_cost: 900 }],
    p_document_type: 'guia', p_document_number: 'QA-1' }));
  const s = await stockDe(producto);
  if (s !== 10) throw new Error(`stock ${s}, se esperaba 10`);
  return 'stock 10';
});

// --------------------------------------------------------------- la venta
titulo('La venta (como cajero)');

await paso('Abrir caja con $10.000', async () => {
  const { error } = await cajero.cliente.rpc('fn_open_cash_session', { p_opening_amount: 10000 });
  if (error && /CAJA_YA_ABIERTA/.test(error.message)) {
    // Una ejecución anterior se cortó con la caja abierta: se cierra y se abre de nuevo.
    const s = datos(await cajero.cliente.from('cash_sessions').select('id').eq('status', 'abierta').single());
    const r = datos(await cajero.cliente.rpc('fn_cash_session_summary', { p_session_id: s.id }));
    datos(await cajero.cliente.rpc('fn_close_cash_session', { p_session_id: s.id, p_counted_amount: r.expected_amount, p_notes: 'QA: caja de una ejecución anterior' }));
    datos(await cajero.cliente.rpc('fn_open_cash_session', { p_opening_amount: 10000 }));
    return 'había una caja abierta de antes; se cerró';
  }
  if (error) throw new Error(error.message);
});

const uuid = randomUUID();
const laVenta = {
  p_client_uuid: uuid,
  p_items: [{ product_id: producto, quantity: 2, unit_price: 1500, discount_amount: 0 }],
  p_payments: [{ method: 'efectivo', amount: 3000, received_amount: 5000 }],
};
const venta = await paso('Vender 2 × $1.500, paga con $5.000', async () => {
  const r = datos(await cajero.cliente.rpc('fn_register_sale', laVenta));
  if (r.total !== 3000) throw new Error(`total ${r.total}`);
  if (r.change_amount !== 2000) throw new Error(`vuelto ${r.change_amount}`);
  return r;
});
if (venta) marcar(true, `Folio ${venta.folio}, total $3.000, vuelto $2.000`);

await paso('El stock bajó a 8', async () => {
  const s = await stockDe(producto);
  if (s !== 8) throw new Error(`stock ${s}`);
});

await paso('IVA desglosado: neto + IVA = total', async () => {
  const s = datos(await servicio.from('sales').select('total, tax_amount').eq('id', venta.sale_id).single());
  if (s.tax_amount !== 479) throw new Error(`IVA ${s.tax_amount}, se esperaba 479`);
  return `neto ${s.total - s.tax_amount} + IVA ${s.tax_amount} = ${s.total}`;
});

await paso('Reenviar la misma venta no la duplica (CP-03)', async () => {
  const r = datos(await cajero.cliente.rpc('fn_register_sale', laVenta));
  if (!r.already_existed || r.folio !== venta.folio) throw new Error('se registró dos veces');
  if ((await stockDe(producto)) !== 8) throw new Error('el stock bajó otra vez');
});

await ataque('Un vendedor no puede dar descuento (tope 0 %)', () =>
  cajero.cliente.rpc('fn_register_sale', {
    p_client_uuid: randomUUID(),
    p_items: [{ product_id: producto, quantity: 1, unit_price: 1500, discount_amount: 500 }],
    p_payments: [{ method: 'efectivo', amount: 1000 }] }));

// ---------------------------------------------------------------- ataques
titulo('Ataques con la sesión del cajero (T-46, contra el Supabase real)');

const sesion = datos(await servicio.from('cash_sessions').select('id')
  .eq('user_id', cajero.id).eq('status', 'abierta').single());

await ataque('Escribir su propio arqueo', () =>
  cajero.cliente.from('cash_sessions').update({ status: 'cerrada', expected_amount: 1, counted_amount: 1 }).eq('id', sesion.id),
  async () => datos(await servicio.from('cash_sessions').select('status').eq('id', sesion.id).single()).status === 'abierta');

await ataque('Insertar un egreso firmado por el administrador', () =>
  cajero.cliente.from('cash_movements').insert({ tenant_id: local.tenant, cash_session_id: sesion.id, type: 'egreso', amount: 5000, reason: 'retiro', created_by: admin.id }));

await ataque('Escribir en la bitácora', () =>
  cajero.cliente.from('audit_log').insert({ tenant_id: local.tenant, user_id: admin.id, action: 'sale_void', entity_type: 'sales' }));

await ataque('Escribir en el kardex por fn_post_movement (S-1)', () =>
  cajero.cliente.rpc('fn_post_movement', { p_tenant: local.tenant, p_store: local.store, p_product: producto,
    p_type: 'ajuste_positivo', p_quantity: 100, p_unit_cost: 0, p_ref_type: null, p_ref_id: null, p_reason: 'x', p_user: admin.id }),
  async () => (await stockDe(producto)) === 8);

await ataque('Hacerse administrador (S-2)', () =>
  cajero.cliente.from('profiles').update({ role: 'admin' }).eq('id', cajero.id),
  async () => datos(await servicio.from('profiles').select('role').eq('id', cajero.id).single()).role === 'vendedor');

await ataque('Ver datos de otros locales', () => cajero.cliente.from('tenants').select('id'),
  async () => {
    const r = datos(await cajero.cliente.from('tenants').select('id'));
    return r.length === 1 && r[0].id === local.tenant;
  });

await ataque('Sin sesión (anon) no se vende', () =>
  createClient(URL_SB, PUBLICA, opciones).rpc('fn_register_sale', laVenta));

{
  const r = await cajero.cliente.from('products').select('avg_cost').eq('id', producto).maybeSingle();
  const lee = !r.error && r.data && r.data.avg_cost !== undefined;
  console.log(`  ${lee ? '⚠' : '✔'} Un vendedor lee costos — ${lee ? `sí, avg_cost = ${r.data.avg_cost}. Conocido: T-45` : 'no'}`);
}

// ------------------------------------------------------- anulación y cierre
titulo('Anulación y cierre');

await ataque('El cajero no puede anular', () =>
  cajero.cliente.rpc('fn_void_sale', { p_sale_id: venta.sale_id, p_reason: 'QA' }));

await paso('El administrador anula la venta y el stock vuelve a 10', async () => {
  datos(await admin.cliente.rpc('fn_void_sale', { p_sale_id: venta.sale_id, p_reason: 'QA: venta de prueba' }));
  const s = await stockDe(producto);
  if (s !== 10) throw new Error(`stock ${s}`);
});

await paso('Cerrar caja contando $10.000: cuadra', async () => {
  const r = datos(await cajero.cliente.rpc('fn_close_cash_session', { p_session_id: sesion.id, p_counted_amount: 10000, p_notes: null }));
  if (r.expected_amount !== 10000) throw new Error(`esperado ${r.expected_amount}`);
  return `esperado $${r.expected_amount}, diferencia $${r.difference ?? 0}`;
});

await paso('Kardex: recepción, venta y anulación, en ese orden', async () => {
  const m = datos(await servicio.from('inventory_movements').select('movement_type, quantity, balance_after')
    .eq('product_id', producto).order('created_at'));
  const tipos = m.map((x) => x.movement_type).join(' → ');
  if (tipos !== 'recepcion → venta → anulacion_venta') throw new Error(tipos);
  return tipos;
});

await paso('Desactivar el producto de prueba', async () => {
  datos(await admin.cliente.from('products').update({ is_active: false }).eq('id', producto));
});

resumen();

function resumen() {
  const malos = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
  if (malos.length) {
    console.log('\nFallaron:');
    for (const m of malos) console.log(`  ✖ ${m.texto}`);
  }
  process.exit(malos.length ? 1 : 0);
}
