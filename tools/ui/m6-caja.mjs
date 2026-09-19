/**
 * M6 · Caja, un turno completo desde la pantalla, en el local QA.
 *
 *   node tools/ui/m6-caja.mjs
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const env = dotenv.parse(fs.readFileSync('.env.local'));
const BASE = 'http://localhost:3001';
const opc = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opc);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];

const resultados = [];
function ok(rf, cumple, texto, detalle = '') {
  resultados.push({ rf, cumple, texto, detalle });
  console.log(`  ${cumple ? '✔' : '✖'} ${rf} · ${texto}${detalle ? ' — ' + detalle : ''}`);
}
async function usuario(alias) {
  const correo = `qa-${alias}-${ref}@example.com`;
  const { data } = await servicio.auth.admin.listUsers({ perPage: 1000 });
  const u = data.users.find((x) => x.email === correo);
  const clave = randomBytes(12).toString('base64url');
  await servicio.auth.admin.updateUserById(u.id, { password: clave });
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opc);
  await cli.auth.signInWithPassword({ email: correo, password: clave });
  return { id: u.id, correo, clave, cli };
}
async function cerrarSiAbierta(u) {
  const { data: s } = await servicio.from('cash_sessions').select('id').eq('user_id', u.id).eq('status', 'abierta').maybeSingle();
  if (!s) return;
  const { data: r } = await u.cli.rpc('fn_cash_session_summary', { p_session_id: s.id });
  await u.cli.rpc('fn_close_cash_session', { p_session_id: s.id, p_counted_amount: r.expected_amount, p_notes: 'QA' });
}
const sesionAbierta = async (u) => (await servicio.from('cash_sessions').select('*').eq('user_id', u.id).eq('status', 'abierta').maybeSingle()).data;

const admin = await usuario('admin');
const cajero = await usuario('cajero');
await cerrarSiAbierta(cajero);
await cerrarSiAbierta(admin);

const { data: prod } = await admin.cli.rpc('fn_create_product', {
  p_name: 'QA Caja ' + Date.now().toString().slice(-5), p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 1000, p_avg_cost: 600, p_min_stock: 0, p_tracks_expiry: false, p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0 });
const { data: prov } = await admin.cli.from('suppliers').select('id').eq('name', 'Proveedor QA').single();
await admin.cli.rpc('fn_confirm_receipt', { p_supplier_id: prov.id, p_items: [{ product_id: prod.product_id, quantity: 5, unit_cost: 600 }] });
await admin.cli.rpc('fn_transfer_stock', { p_product_id: prod.product_id, p_cantidad: 5 });

const nav = await chromium.launch({ channel: 'msedge', headless: true });
const errores = [];
async function pagina(u) {
  const ctx = await nav.newContext({ viewport: { width: 420, height: 860 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(e.message));
  await p.goto(`${BASE}/login`);
  await p.fill('#email', u.correo);
  await p.fill('#password', u.clave);
  await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);
  return p;
}
const p = await pagina(cajero);

console.log('M6-01 · Abrir con monto inicial');
await p.goto(`${BASE}/caja`);
await p.fill('#inicial', '10.000');
await p.getByRole('button', { name: 'Abrir caja' }).click();
await p.getByRole('heading', { name: 'Abrir caja' }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
ok('M6-01', (await sesionAbierta(cajero))?.opening_amount === 10000, 'la caja queda abierta con $10.000');

console.log('M6-03 · Ingreso y egreso con motivo');
for (const [boton, monto, motivo] of [['+ Ingreso', '2.000', 'Sencillo del banco'], ['− Egreso', '1.500', 'Compra de bolsas']]) {
  await p.getByRole('button', { name: boton }).click();
  const registrar = p.getByRole('button', { name: /^Registrar/ });
  await p.getByLabel(/Monto que (entra|sale)/).fill(monto);
  ok('M6-03', await registrar.isDisabled(), `${boton.slice(2)} sin motivo no se puede registrar`);
  await p.getByLabel('Motivo').fill(motivo);
  await registrar.click();
  await p.waitForTimeout(2000);
}
const s1 = await sesionAbierta(cajero);
const { data: movs } = await servicio.from('cash_movements').select('type, amount, reason').eq('cash_session_id', s1.id);
ok('M6-03', movs.length === 2 && movs.some((m) => m.type === 'ingreso' && m.amount === 2000) && movs.some((m) => m.type === 'egreso' && m.amount === 1500),
  'quedan un ingreso de $2.000 y un egreso de $1.500 con su motivo');

// Una venta en efectivo de $2.000 (M5 ya prueba la venta en pantalla)
await cajero.cli.rpc('fn_register_sale', { p_client_uuid: randomUUID(),
  p_items: [{ product_id: prod.product_id, quantity: 2, unit_price: 1000, discount_amount: 0 }],
  p_payments: [{ method: 'efectivo', amount: 2000, received_amount: 2000 }] });

console.log('M6-04 · Efectivo esperado: 10.000 + 2.000 venta + 2.000 ingreso − 1.500 egreso = 12.500');
await p.reload();
const txt = await p.locator('main').innerText();
ok('M6-04', /12\.500/.test(txt), 'la pantalla muestra $12.500 esperados', (txt.match(/[^\n]*12\.500[^\n]*/) ?? ['no aparece'])[0]);

console.log('M6-05 / M6-06 · Cierre con faltante');
await p.getByRole('button', { name: 'Cerrar caja' }).click();
await p.fill('#contado', '12.000');
const cerrar = p.getByRole('button', { name: 'Cerrar caja' }).last();
const panel = await p.locator('main').innerText();
ok('M6-06', /Faltante[\s\S]*\$500/.test(panel), 'muestra faltante de $500 antes de cerrar');
ok('M6-06', await cerrar.isDisabled(), 'con diferencia no deja cerrar sin explicar');
await p.fill('#nota', 'Un vuelto mal dado');
await cerrar.click();
await p.waitForTimeout(3000);
const { data: cerrada } = await servicio.from('cash_sessions').select('status, expected_amount, counted_amount, difference, closing_notes').eq('id', s1.id).single();
ok('M6-05', cerrada.status === 'cerrada' && cerrada.expected_amount === 12500 && cerrada.counted_amount === 12000,
  'queda cerrada con esperado 12.500 y contado 12.000', JSON.stringify(cerrada));
ok('M6-07', /abrir caja/i.test(await p.locator('main').innerText()), 'después del cierre vuelve a ofrecer abrir caja');

console.log('M6-08 · Caja cerrada no recibe movimientos');
const r8 = await cajero.cli.rpc('fn_add_cash_movement', { p_type: 'egreso', p_amount: 100, p_reason: 'x' });
ok('M6-08', Boolean(r8.error), 'un egreso después del cierre se rechaza', r8.error?.message);

console.log('M6-10 / M6-12 · El administrador ve el historial y cierra una caja ajena');
await cajero.cli.rpc('fn_open_cash_session', { p_opening_amount: 3000 });
const pa = await pagina(admin);
await pa.goto(`${BASE}/caja`);
await pa.waitForTimeout(1500);
const cajaAdmin = await pa.locator('main').innerText();
ok('M6-12', /QA cajero/i.test(cajaAdmin) && /500/.test(cajaAdmin), 'el historial muestra el cierre del cajero con su diferencia');
ok('M6-10', /abierta|Cajas de otros|dejó abierta/i.test(cajaAdmin), 've la caja que el cajero dejó abierta');
await pa.getByRole('button', { name: 'Cerrarla' }).first().click();
const dlg = pa.getByRole('dialog');
await pa.waitForTimeout(800);
console.log('     diálogos:', await dlg.count(), '·', (await dlg.first().innerText().catch(() => 'ninguno')).split(String.fromCharCode(10)).join(' | ').slice(0, 300));
await dlg.getByLabel('Efectivo contado').fill('3000', { timeout: 5000 });
await dlg.getByLabel(/Por qué la cierras/).fill('Cierre de prueba QA');
await dlg.getByRole('button', { name: 'Cerrar esa caja' }).click();
await pa.waitForTimeout(3000);
ok('M6-10', !(await sesionAbierta(cajero)), 'el administrador cerró la caja ajena desde la pantalla');

console.log(`\nErrores de JavaScript: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
await nav.close();
await admin.cli.from('products').update({ is_active: false }).eq('id', prod.product_id);
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-m6.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
