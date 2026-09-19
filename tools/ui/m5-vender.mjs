/**
 * M5 · Vender, como lo hace un vendedor, en el local "QA · pruebas internas".
 *
 *   node tools/ui/m5-vender.mjs
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

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

// ---------------------------------------------------------------- preparación
const admin = await usuario('admin');
const cajero = await usuario('cajero');
const sufijo = Date.now().toString().slice(-5);
async function producto(nombre, precio, stockSala) {
  const { data } = await admin.cli.rpc('fn_create_product', {
    p_name: nombre, p_sku: null, p_description: 'Producto de prueba QA', p_category_id: null, p_unit: 'unidad',
    p_sale_price: precio, p_avg_cost: Math.round(precio * 0.6), p_min_stock: 0, p_tracks_expiry: false,
    p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0 });
  if (stockSala) {
    const { data: prov } = await admin.cli.from('suppliers').select('id').eq('name', 'Proveedor QA').single();
    await admin.cli.rpc('fn_confirm_receipt', { p_supplier_id: prov.id, p_items: [{ product_id: data.product_id, quantity: stockSala, unit_cost: 500 }] });
    await admin.cli.rpc('fn_transfer_stock', { p_product_id: data.product_id, p_cantidad: stockSala });
  }
  return data.product_id;
}
const pA = await producto(`QA Galletas ${sufijo}`, 1500, 10);
const pB = await producto(`QA Agotado ${sufijo}`, 700, 0);
const nA = `QA Galletas ${sufijo}`, nB = `QA Agotado ${sufijo}`;
// Caja del cajero: si quedó una abierta de otra corrida, se cierra.
const { data: abierta } = await servicio.from('cash_sessions').select('id').eq('user_id', cajero.id).eq('status', 'abierta').maybeSingle();
if (abierta) {
  const { data: r } = await cajero.cli.rpc('fn_cash_session_summary', { p_session_id: abierta.id });
  await cajero.cli.rpc('fn_close_cash_session', { p_session_id: abierta.id, p_counted_amount: r.expected_amount, p_notes: 'QA' });
}
const stockSala = async (id) => Number((await servicio.from('stock_ubicaciones').select('quantity').eq('product_id', id).eq('ubicacion', 'sala').maybeSingle()).data?.quantity ?? 0);
const ventasDe = async () => (await servicio.from('sales').select('folio, total, status, sold_by').eq('sold_by', cajero.id).order('folio')).data ?? [];
const antes = (await ventasDe()).length;

// ---------------------------------------------------------------- navegador
const nav = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await nav.newContext({ viewport: { width: 420, height: 860 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
await p.goto(`${BASE}/login`);
await p.fill('#email', cajero.correo);
await p.fill('#password', cajero.clave);
await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);

console.log('M5-16 · Sin caja abierta no se vende');
await p.goto(`${BASE}/pos`);
await p.getByText('Abre tu caja para vender').waitFor({ timeout: 15000 }).catch(() => {});
const sinCaja = await p.locator('main').innerText();
ok('M5-16', /abre tu caja/i.test(sinCaja), 'el POS pide abrir caja', sinCaja.replace(/\n+/g, ' · ').slice(0, 90));

console.log('M6-01 · Abrir caja desde el celular');
await p.goto(`${BASE}/caja`);
await p.fill('#inicial', '10.000');
await p.getByRole('button', { name: 'Abrir caja' }).click();
await p.getByRole('heading', { name: 'Abrir caja' }).waitFor({ state: 'detached', timeout: 15000 }).then(
  () => ok('M6-01', true, 'caja abierta con $10.000'), () => ok('M6-01', false, 'caja abierta con $10.000'));

console.log('M5-05 / M5-06 / M5-07 · Buscar, agregar, cambiar cantidad');
await p.goto(`${BASE}/pos`);
const buscarYAgregar = async (nombre) => {
  await p.fill('input[type=search]', nombre);
  const b = p.locator('main li button', { hasText: nombre }).first();
  await b.waitFor({ timeout: 15000 });
  await p.waitForTimeout(1200);
  await p.locator('main li button', { hasText: nombre }).first().click();
};
await buscarYAgregar(nA);
ok('M5-05', /\$1\.500/.test(await p.locator('main').innerText()), 'buscar por nombre y agregar al carrito');
await p.getByRole('button', { name: `Agregar una unidad de ${nA}` }).click();
await p.getByRole('button', { name: `Agregar una unidad de ${nA}` }).click();
let barra = await p.locator('.sticky.bottom-0').innerText();
ok('M5-07', /3 unidades/.test(barra) && /\$4\.500/.test(barra), 'con + sube a 3 y el total es $4.500', barra.replace(/\n+/g, ' · '));
await p.getByRole('button', { name: `Quitar una unidad de ${nA}` }).click();
barra = await p.locator('.sticky.bottom-0').innerText();
ok('M5-06', /2 unidades/.test(barra) && /\$3\.000/.test(barra), 'con − baja a 2 y el total a $3.000', barra.replace(/\n+/g, ' · '));

console.log('RNF-19 · Vaciar el carrito pide confirmación');
await p.getByRole('button', { name: 'Vaciar' }).click();
await p.waitForTimeout(500);
const seVacio = !(await p.locator('.sticky.bottom-0').count());
ok('RNF-19', !seVacio, 'un toque en "Vaciar" no borra la venta sin preguntar', seVacio ? 'se borró todo sin confirmar' : 'pidió confirmación');
if (!seVacio) {
  const cancelar = p.getByRole('dialog').getByRole('button', { name: 'No, seguir vendiendo' });
  if (await cancelar.count()) await cancelar.first().click();
} else {
  await buscarYAgregar(nA);
  await p.getByRole('button', { name: `Agregar una unidad de ${nA}` }).click();
}

console.log('M5-09 / M5-11 · Cobrar en efectivo con vuelto');
await p.getByRole('button', { name: 'Cobrar' }).click();
const dialogo = p.getByRole('dialog');
await dialogo.waitFor();
await p.fill('#recibido', '5.000');
const vuelto = await dialogo.innerText();
ok('M5-11', /Vuelto[\s\S]*\$2\.000/.test(vuelto), 'paga con $5.000 y muestra vuelto $2.000');
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
ok('RNF-45', !(await p.getByRole('dialog').count()), 'Escape cierra el cobro sin cobrar');
if (await p.getByRole('dialog').count()) await p.getByRole('button', { name: 'Cancelar' }).click();
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.fill('#recibido', '5000');
await p.getByRole('button', { name: 'Confirmar venta' }).click();
const comp = p.getByText('NO ES DOCUMENTO TRIBUTARIO').first();
await comp.waitFor({ timeout: 15000 }).then(() => ok('M5-14', true, 'muestra el comprobante interno'), () => ok('M5-14', false, 'muestra el comprobante interno'));
await p.waitForTimeout(4000);
let vs = await ventasDe();
ok('M5-12', vs.length === antes + 1 && vs.at(-1)?.total === 3000, 'la venta quedó en la base con total $3.000', `folio ${vs.at(-1)?.folio}`);
ok('M4-13', (await stockSala(pA)) === 8, 'la sala bajó de 10 a 8', `sala ${await stockSala(pA)}`);
const nueva = p.getByRole('button', { name: 'Nueva venta' });
if (await nueva.count()) await nueva.click();

console.log('M5-17 / M5-18 / M5-19 · Vender sin internet');
await ctx.setOffline(true);
await buscarYAgregar(nA);
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.getByRole('button', { name: /Débito/ }).click();
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await comp.waitFor({ timeout: 10000 }).then(() => ok('M5-17', true, 'sin internet también entrega el comprobante'), () => ok('M5-17', false, 'sin internet también entrega el comprobante'));
if (await nueva.count()) await nueva.click();
const indicador = await p.locator('body').innerText();
ok('M5-19', /sin conexi|pendiente|por sincronizar/i.test(indicador), 'se ve que no hay conexión y que hay ventas pendientes',
  (indicador.match(/[^\n]*(sin conexi|pendiente|sincroniz)[^\n]*/i) ?? [''])[0]);
await ctx.setOffline(false);
await p.evaluate(() => window.dispatchEvent(new Event('online')));
await p.waitForTimeout(8000);
vs = await ventasDe();
ok('M5-18', vs.length === antes + 2, 'al volver la conexión la venta se registra, una sola vez', `${vs.length - antes} ventas nuevas`);

console.log('M4-09 · Vender algo sin stock (vendedor)');
await buscarYAgregar(nB);
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.getByRole('button', { name: /Débito/ }).click();
await p.getByRole('button', { name: 'Confirmar venta' }).click();
const avisoStock = await p.getByText(/No hay stock suficiente/).first().innerText({ timeout: 3000 }).catch(() => '');
ok('M4-09', /quedan 0/.test(avisoStock), 'el vendedor se entera antes de entregar, con cuánto queda', avisoStock);
await p.waitForTimeout(2500);
const cuerpo = await p.locator('body').innerText();
ok('M4-09', !/NO ES DOCUMENTO TRIBUTARIO/.test(cuerpo), 'no entrega comprobante de una venta que no se puede registrar');
ok('M4-09', /QA Agotado/.test(await p.locator('main').innerText()), 'el carrito se conserva para corregir');

console.log(`\nErrores de JavaScript: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
await nav.close();
for (const id of [pA, pB]) await admin.cli.from('products').update({ is_active: false }).eq('id', id);
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-m5.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
