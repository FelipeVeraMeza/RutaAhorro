/**
 * Clientes y precio por cliente (0022, RQ-07, RQ-20, RQ-21), como lo hace el
 * administrador desde el celular y como lo cobra un cajero, en
 * "QA · pruebas internas".
 *
 *   node tools/ui/clientes.mjs   (la app compilada en http://localhost:3001)
 *
 * El cajero tiene tope de descuento 0 %: si la base le acepta la venta a
 * precio mayorista, es porque ese precio es del cliente y no un descuento.
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
/** Un RUT válido al azar: cada corrida crea clientes nuevos sin chocar. */
function rutAlAzar() {
  const n = 10_000_000 + Math.floor(Math.random() * 60_000_000);
  let s = 0, m = 2;
  for (const d of String(n).split('').reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${n.toLocaleString('es-CL')}-${dv === 11 ? '0' : dv === 10 ? 'K' : dv}`;
}

// ---------------------------------------------------------------- preparación
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
const nA = `QA Cli ${sufijo} Arroz`, nB = `QA Cli ${sufijo} Aceite`;
const pA = await producto(nA, 2000);
const pB = await producto(nB, 4000);
const nCliente = `QA Mayorista ${sufijo}`;
const rutMayorista = rutAlAzar();
const rutFactura = rutAlAzar();
for (const u of [admin, cajero]) {
  const { data: abierta } = await servicio.from('cash_sessions').select('id').eq('user_id', u.id).eq('status', 'abierta').maybeSingle();
  if (!abierta) await u.cli.rpc('fn_open_cash_session', { p_opening_amount: 0 });
}

// ---------------------------------------------------------------- navegador
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
const p = await entrar(admin);

console.log('Clientes, desde "Más" en el celular');
await p.getByRole('button', { name: 'Más' }).click();
await p.getByRole('link', { name: /Clientes/ }).click();
await p.waitForURL('**/clientes');
ok('RQ-21', true, 'se llega a Clientes desde "Más"');
await p.getByRole('button', { name: 'Nuevo cliente' }).click();
const f = p.getByRole('dialog');
await f.getByLabel('Nombre o razón social').fill(nCliente);
await f.getByLabel('RUT').fill(rutMayorista.replace(/\./g, ''));
await f.getByLabel('Giro').fill('Almacén');
await f.getByLabel('% de rebaja en todo').fill('8');
await f.getByLabel('Buscar producto para precio especial').fill(nB);
await f.getByRole('button', { name: new RegExp(nB) }).click();
await f.getByLabel(`Precio especial de ${nB}`, { exact: true }).fill('3.500');
const medFicha = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await f.getByRole('button', { name: 'Guardar' }).click();
await p.getByText(`${nCliente} guardado`).waitFor({ timeout: 15000 });
const { data: cli } = await servicio.from('clientes').select('id, rut, descuento_pct, giro').eq('tenant_id', tenant).eq('nombre', nCliente).single();
const { data: esp } = await servicio.from('cliente_precios').select('product_id, precio').eq('cliente_id', cli.id);
ok('RQ-21', cli.rut === rutMayorista && Number(cli.descuento_pct) === 8 && cli.giro === 'Almacén',
  'la ficha quedó en la base con su RUT formateado y 8 %', `${cli.rut} · ${cli.descuento_pct}`);
ok('RQ-07', esp?.length === 1 && esp[0].product_id === pB && esp[0].precio === 3500, 'y el precio especial del aceite: $3.500');
ok('RNF-16', medFicha <= 1, 'la ficha no se desborda a 360 px', `${medFicha} px`);

console.log('El cajero no entra a Clientes');
const c = await entrar(cajero);
await c.goto(`${BASE}/clientes`);
await c.waitForTimeout(1500);
ok('RQ-21', !c.url().includes('/clientes'), 'un vendedor que escribe /clientes vuelve al inicio', c.url());

console.log('POS · el cajero elige al cliente y cobra su precio');
await c.goto(`${BASE}/pos`);
await c.waitForTimeout(3000); // el catálogo y los clientes bajan al entrar
async function agregar(nombre, veces = 1) {
  await c.fill('input[type=search]', nombre);
  const b = c.locator('main li button', { hasText: nombre }).first();
  await b.waitFor({ timeout: 15000 });
  await b.click();
  for (let i = 1; i < veces; i++) await c.getByRole('button', { name: `Agregar una unidad de ${nombre}` }).click();
}
await agregar(nA, 2);
await agregar(nB);
let barra = await c.locator('.sticky.bottom-0').innerText();
ok('RQ-07', /\$8\.000/.test(barra), 'sin cliente: 2 × $2.000 + $4.000 = $8.000', barra.replace(/\n+/g, ' · '));
await c.getByRole('button', { name: /Elegir cliente/ }).click();
await c.getByRole('dialog').getByLabel('Buscar cliente por nombre o RUT').fill(sufijo);
await c.getByRole('dialog').getByRole('button', { name: new RegExp(nCliente) }).click();
barra = await c.locator('.sticky.bottom-0').innerText();
ok('RQ-07', /\$7\.180/.test(barra), 'con el mayorista: 2 × $1.840 (8 %) + $3.500 (especial) = $7.180', barra.replace(/\n+/g, ' · '));
ok('RQ-07', await c.getByText(/Precio de cliente · ahorra/).count() === 2, 'cada línea dice que es precio de cliente');
const chip = await c.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Cambiar');
  return b ? Math.round(b.getBoundingClientRect().height) : 0;
});
ok('RNF-16', chip >= 44, 'el botón "Cambiar" cliente mide 44 px o más', `${chip} px`);
await c.getByRole('button', { name: 'Cobrar' }).click();
await c.fill('#recibido', '10000');
await c.getByRole('button', { name: 'Confirmar venta' }).click();
await c.locator('#ticket').first().waitFor({ timeout: 15000 });
await c.waitForTimeout(2000);
const { data: v1 } = await servicio.from('sales').select('total, cliente_id')
  .eq('sold_by', cajero.id).order('folio', { ascending: false }).limit(1).single();
ok('RQ-07', v1.total === 7180 && v1.cliente_id === cli.id, 'la base aceptó la venta del cajero y guardó al cliente',
  `total ${v1.total}`);
const nueva = c.getByRole('button', { name: 'Nueva venta' });
if (await nueva.count()) await nueva.click();

console.log('La venta siguiente parte sin cliente');
await agregar(nA);
ok('RQ-07', await c.getByRole('button', { name: /Elegir cliente/ }).count() === 1, 'no arrastra al mayorista a la venta siguiente');
barra = await c.locator('.sticky.bottom-0').innerText();
ok('RQ-07', /\$2\.000/.test(barra), 'y cobra precio normal', barra.replace(/\n+/g, ' · '));

console.log('RQ-20 · la factura guarda al receptor, y la siguiente lo autocompleta');
await c.getByRole('button', { name: 'Cobrar' }).click();
await c.getByRole('button', { name: /^Factura/ }).click();
await c.getByLabel('RUT del cliente').fill(rutFactura);
await c.getByLabel('Nombre o razón social').fill(`QA Factura ${sufijo}`);
await c.fill('#recibido', '2000');
await c.getByRole('button', { name: 'Confirmar venta' }).click();
await c.locator('#ticket').first().waitFor({ timeout: 15000 });
await c.waitForTimeout(2000);
const { data: nuevo } = await servicio.from('clientes').select('id, nombre').eq('tenant_id', tenant).eq('rut', rutFactura).maybeSingle();
ok('RQ-20', nuevo?.nombre === `QA Factura ${sufijo}`, 'la factura dejó al receptor guardado como cliente', JSON.stringify(nuevo));
if (await c.getByRole('button', { name: 'Nueva venta' }).count()) await c.getByRole('button', { name: 'Nueva venta' }).click();
// Recargar el POS baja la lista de clientes nueva.
await c.goto(`${BASE}/pos`);
await c.waitForTimeout(3000);
await agregar(nA);
await c.getByRole('button', { name: 'Cobrar' }).click();
await c.getByRole('button', { name: /^Factura/ }).click();
await c.getByLabel('RUT del cliente').fill(rutFactura.replace(/\./g, ''));
await c.getByLabel('RUT del cliente').blur();
const razon = await c.getByLabel('Nombre o razón social').inputValue();
ok('RQ-20', razon === `QA Factura ${sufijo}`, 'al escribir el RUT, la razón social se completa sola', `"${razon}"`);

console.log(`\nErrores de JavaScript o HTTP: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
if (errores.length) ok('RNF', false, 'sin errores de JavaScript ni respuestas 4xx/5xx');
await nav.close();
for (const id of [pA, pB]) await admin.cli.from('products').update({ is_active: false }).eq('id', id);
for (const id of [cli.id, nuevo?.id].filter(Boolean)) {
  const { data: x } = await servicio.from('clientes').select('*').eq('id', id).single();
  await admin.cli.rpc('fn_guardar_cliente', { p_id: id, p_datos: { nombre: x.nombre, rut: x.rut, descuento_pct: x.descuento_pct, activo: false } });
}
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-clientes.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
