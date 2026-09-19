/**
 * Bodega y sala desde la pantalla, en el local "QA · pruebas internas".
 * Recibe 20 en bodega, repone 5 a la sala desde Inventario, y revisa que el
 * POS muestre las dos ubicaciones y avise cuando la sala no alcanza.
 *
 *   node tools/ui/bodega-sala.mjs
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = dotenv.parse(fs.readFileSync('.env.local'));
const BASE = 'http://localhost:3001';
const opc = { auth: { persistSession: false } };
const servicio = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opc);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const correo = `qa-admin-${ref}@example.com`;
const clave = randomBytes(15).toString('base64url');

let fallas = 0;
const ok = (c, t, d = '') => { console.log(`  ${c ? '✔' : '✖'} ${t}${d ? ' — ' + d : ''}`); if (!c) fallas++; };

// Preparación con la API (no es lo que se prueba)
const { data: lista } = await servicio.auth.admin.listUsers({ perPage: 1000 });
const u = lista.users.find((x) => x.email === correo);
if (!u) { console.log('Primero corre npm run db:e2e (crea el local QA)'); process.exit(1); }
await servicio.auth.admin.updateUserById(u.id, { password: clave });
const adm = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opc);
await adm.auth.signInWithPassword({ email: correo, password: clave });
const nombre = 'QA Bodega ' + Date.now().toString().slice(-6);
const { data: prod } = await adm.rpc('fn_create_product', {
  p_name: nombre, p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 1000, p_avg_cost: 600, p_min_stock: 0, p_tracks_expiry: false,
  p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0 });
let { data: prov } = await adm.from('suppliers').select('id').eq('name', 'Proveedor QA').maybeSingle();
await adm.rpc('fn_confirm_receipt', { p_supplier_id: prov.id,
  p_items: [{ product_id: prod.product_id, quantity: 20, unit_cost: 600 }] });
await adm.rpc('fn_open_cash_session', { p_opening_amount: 0 }); // si ya está abierta, da igual

// La prueba: el navegador
const nav = await chromium.launch({ channel: 'msedge', headless: true });
const p = await nav.newPage({ viewport: { width: 1280, height: 850 } });
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
await p.goto(`${BASE}/login`);
await p.fill('#email', correo);
await p.fill('#password', clave);
await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);

console.log('1. Inventario muestra dónde está el stock');
await p.goto(`${BASE}/inventario`);
await p.fill('input[type=search]', nombre);
const fila = p.locator('li', { hasText: nombre }).first();
await fila.waitFor({ timeout: 15000 });
await p.waitForTimeout(800);
let texto = await fila.innerText();
ok(/Sala 0/.test(texto) && /Bodega 20/.test(texto), 'recibido del proveedor: Sala 0 · Bodega 20', texto.replace(/\n+/g, ' · '));
ok(/reponer/i.test(texto), 'avisa que hay que reponer la sala');

console.log('2. Reponer 5 a la sala desde la pantalla');
await fila.getByRole('button', { name: 'Reponer' }).click();
await p.getByLabel('Cantidad a mover').fill('5');
await p.getByRole('button', { name: 'Registrar traspaso' }).click();
await p.getByText('pasaron a sala de ventas').waitFor({ timeout: 15000 }).then(
  () => ok(true, 'mensaje de confirmación'), () => ok(false, 'mensaje de confirmación'));
await p.waitForTimeout(1500);
texto = await p.locator('li', { hasText: nombre }).first().innerText();
ok(/Sala 5/.test(texto) && /Bodega 15/.test(texto), 'queda Sala 5 · Bodega 15', texto.replace(/\n+/g, ' · '));

console.log('3. No deja mover más de lo que hay');
await p.locator('li', { hasText: nombre }).first().getByRole('button', { name: 'Reponer' }).click();
await p.getByLabel('Cantidad a mover').fill('99');
await p.getByRole('button', { name: 'Registrar traspaso' }).click();
const alerta = await p.getByRole('dialog').locator('[role=alert]').first().innerText({ timeout: 5000 }).catch(() => '');
ok(/hay 15/.test(alerta), 'avisa cuánto hay en bodega', alerta);
await p.keyboard.press('Escape');

console.log('4. El POS muestra sala y bodega, y avisa si la sala no alcanza');
await p.goto(`${BASE}/pos`);
await p.fill('input[type=search]', nombre);
const resultado = p.locator('main li button', { hasText: nombre }).first();
await resultado.waitFor({ timeout: 15000 });
// El catálogo local se sincroniza al entrar; la búsqueda se repite sola al llegar.
await p.waitForTimeout(2500);
texto = await p.locator('main li button', { hasText: nombre }).first().innerText();
ok(/Sala 5/.test(texto) && /Bodega 15/.test(texto), 'resultado de búsqueda: Sala 5 · Bodega 15', texto.replace(/\n+/g, ' · '));
for (let i = 0; i < 6; i++) {
  await p.fill('input[type=search]', nombre);
  await p.locator('main li button', { hasText: nombre }).first().click();
  await p.waitForTimeout(250);
}
const aviso = await p.getByText(/conviene reponer/).first().innerText().catch(() => '');
ok(/en sala quedan 5/.test(aviso), 'al pasar de 5 en el carrito avisa y deja seguir', aviso);

console.log(`\nErrores de JavaScript: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
await nav.close();
await adm.from('products').update({ is_active: false }).eq('id', prod.product_id);
console.log(fallas ? `\n${fallas} comprobaciones fallaron` : '\nTodo pasó');
process.exit(fallas ? 1 : 0);
