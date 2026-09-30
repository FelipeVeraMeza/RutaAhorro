/**
 * Combos entre productos distintos (0023), como los arma el administrador
 * desde el celular y como los cobra un cajero, en "QA · pruebas internas".
 *
 *   node tools/ui/combos.mjs   (la app compilada en http://localhost:3001)
 *
 * «2 bebidas + 1 pan por $3.000»: por separado $3.400. El cajero tiene tope
 * de descuento 0 %: si la base le acepta los $400 menos, es por el combo.
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = dotenv.parse(fs.readFileSync('.env.local'));
const BASE = process.env.RA_BASE ?? 'http://localhost:3001';
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

const admin = await usuario('admin');
const cajero = await usuario('cajero');
const { data: perfil } = await servicio.from('profiles').select('tenant_id').eq('id', admin.id).single();
const tenant = perfil.tenant_id;
const sufijo = Date.now().toString().slice(-5);
async function producto(nombre, precio) {
  const { data, error } = await admin.cli.rpc('fn_create_product', {
    p_name: nombre, p_sku: null, p_description: 'Producto de prueba QA', p_category_id: null, p_unit: 'unidad',
    p_sale_price: precio, p_avg_cost: Math.round(precio * 0.5), p_min_stock: 0, p_tracks_expiry: false,
    p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0, p_initial_stock_sala: 100 });
  if (error) throw error;
  return data.product_id;
}
const nBeb = `QA Combo ${sufijo} Bebida`, nPan = `QA Combo ${sufijo} Pan`, nCombo = `QA Once ${sufijo}`;
const pBeb = await producto(nBeb, 1200);
const pPan = await producto(nPan, 1000);
const cfg = (await servicio.from('tenants').select('settings').eq('id', tenant).single()).data.settings;
if (cfg?.ofertas_activas === false) await admin.cli.rpc('fn_guardar_configuracion', { p_cambios: { ofertas_activas: true } });
for (const u of [admin, cajero]) {
  const { data: abierta } = await servicio.from('cash_sessions').select('id').eq('user_id', u.id).eq('status', 'abierta').maybeSingle();
  if (!abierta) await u.cli.rpc('fn_open_cash_session', { p_opening_amount: 0 });
}

const nav = await chromium.launch({ channel: 'msedge', headless: true });
const movil = { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true };
const errores = [];
async function entrar(u) {
  const ctx = await nav.newContext(movil);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errores.push(`${r.status()} ${r.url().slice(0, 140)}`); });
  await p.goto(`${BASE}/login`);
  await p.fill('#email', u.correo);
  await p.fill('#password', u.clave);
  await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);
  return p;
}

console.log('Armar el combo desde el celular');
const p = await entrar(admin);
await p.goto(`${BASE}/productos/ofertas`);
await p.getByRole('link', { name: /Combos: varios productos a un precio/ }).click();
await p.waitForURL('**/productos/combos');
ok('RQ-45', true, 'se llega a Combos desde Ofertas');
await p.getByRole('button', { name: 'Nuevo combo' }).click();
const d = p.getByRole('dialog');
await d.getByLabel('Nombre del combo').fill(nCombo);
await d.getByLabel('Buscar producto para el combo').fill(nBeb);
await d.getByRole('button', { name: new RegExp(nBeb) }).click();
await d.getByLabel(`Cantidad de ${nBeb}`).fill('2');
await d.getByLabel('Buscar producto para el combo').fill(nPan);
await d.getByRole('button', { name: new RegExp(nPan) }).click();
await d.getByLabel('Precio del combo').fill('3.000');
ok('RQ-45', await d.getByText(/Por separado \$3\.400 · el cliente ahorra \$400/).count() === 1,
  'antes de guardar dice: por separado $3.400, ahorra $400');
const desb = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await d.getByRole('button', { name: 'Guardar combo' }).click();
await p.getByText(`Combo "${nCombo}" guardado`).waitFor({ timeout: 15000 });
const { data: combo } = await servicio.from('combos').select('id, precio, combo_items(product_id, cantidad)').eq('tenant_id', tenant).eq('nombre', nCombo).single();
ok('RQ-45', combo.precio === 3000 && combo.combo_items.length === 2
  && Number(combo.combo_items.find((i) => i.product_id === pBeb)?.cantidad) === 2, 'quedó en la base: 2 bebidas + 1 pan a $3.000');
ok('RNF-16', desb <= 1, 'el editor de combos no se desborda a 360 px', `${desb} px`);

console.log('El cajero lo cobra sin hacer nada');
const c = await entrar(cajero);
await c.goto(`${BASE}/pos`);
await c.waitForTimeout(3000);
async function agregar(nombre, veces = 1) {
  await c.fill('input[type=search]', nombre);
  const b = c.locator('main li button', { hasText: nombre }).first();
  await b.waitFor({ timeout: 15000 });
  await b.click();
  for (let i = 1; i < veces; i++) await c.getByRole('button', { name: `Agregar una unidad de ${nombre}` }).click();
}
await agregar(nBeb, 2);
let barra = await c.locator('.sticky.bottom-0').innerText();
ok('RQ-45', /\$2\.400/.test(barra), 'con 2 bebidas y sin pan, precio normal: $2.400', barra.replace(/\n+/g, ' · '));
await agregar(nPan);
barra = await c.locator('.sticky.bottom-0').innerText();
ok('RQ-45', /\$3\.000/.test(barra), 'al agregar el pan, el combo se aplica solo: $3.000', barra.replace(/\n+/g, ' · '));
ok('RQ-45', await c.getByText(new RegExp(`Combo ${nCombo}`)).count() >= 1, 'las líneas dicen qué combo se aplicó');
await c.getByRole('button', { name: 'Cobrar' }).click();
await c.fill('#recibido', '5000');
await c.getByRole('button', { name: 'Confirmar venta' }).click();
await c.locator('#ticket').first().waitFor({ timeout: 15000 });
const ticket = await c.locator('#ticket').first().innerText();
ok('RQ-45', new RegExp(`combo ${nCombo}`).test(ticket), 'el ticket dice el combo');
await c.waitForTimeout(2000);
const { data: v } = await servicio.from('sales').select('total, descuento_combos, combos_aplicados')
  .eq('sold_by', cajero.id).order('folio', { ascending: false }).limit(1).single();
ok('RQ-45', v.total === 3000 && v.descuento_combos === 400 && v.combos_aplicados?.[0]?.nombre === nCombo,
  'la base aceptó la venta del cajero y guardó el combo', `total ${v.total}, combo ${v.descuento_combos}`);
if (await c.getByRole('button', { name: 'Nueva venta' }).count()) await c.getByRole('button', { name: 'Nueva venta' }).click();

console.log('Al sacar un producto, el combo se va');
await agregar(nBeb, 2);
await agregar(nPan);
await c.getByRole('button', { name: `Quitar una unidad de ${nPan}` }).click();
barra = await c.locator('.sticky.bottom-0').innerText();
ok('RQ-45', /\$2\.400/.test(barra), 'sin el pan vuelve a $2.400', barra.replace(/\n+/g, ' · '));

console.log(`\nErrores de JavaScript o HTTP: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
if (errores.length) ok('RNF', false, 'sin errores de JavaScript ni respuestas 4xx/5xx');
await nav.close();
await admin.cli.rpc('fn_guardar_combo', { p_id: combo.id, p_datos: {
  nombre: nCombo, precio: 3000, activo: false,
  items: combo.combo_items.map((i) => ({ product_id: i.product_id, cantidad: Number(i.cantidad) })) } });
for (const id of [pBeb, pPan]) await admin.cli.from('products').update({ is_active: false }).eq('id', id);
if (cfg?.ofertas_activas === false) await admin.cli.rpc('fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-combos.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
