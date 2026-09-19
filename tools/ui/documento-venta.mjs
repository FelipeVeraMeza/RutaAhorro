/**
 * Boleta, factura y voucher en el navegador, más el consultador de precios y
 * la barra inferior del celular. Lo que pidió el cliente el 2026-09-19.
 *
 *   node tools/ui/documento-venta.mjs
 *
 * Necesita la migración 0015 aplicada en la base: sin ella `fn_register_sale`
 * todavía tiene la firma vieja y **ninguna venta se registra**. La app y la
 * base se actualizan juntas.
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

const RUT_OK = '76.086.428-5';
const RUT_MAL = '76.086.428-4';

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
const nombre = `QA Documento ${sufijo}`;

const { data: creado } = await admin.cli.rpc('fn_create_product', {
  p_name: nombre, p_sku: null, p_description: 'Producto de prueba QA', p_category_id: null,
  p_unit: 'unidad', p_sale_price: 1000, p_avg_cost: 600, p_min_stock: 0,
  p_tracks_expiry: false, p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0 });
const producto = creado.product_id;
const { data: prov } = await admin.cli.from('suppliers').select('id').eq('name', 'Proveedor QA').single();
await admin.cli.rpc('fn_confirm_receipt', {
  p_supplier_id: prov.id, p_items: [{ product_id: producto, quantity: 20, unit_cost: 600 }] });
await admin.cli.rpc('fn_transfer_stock', { p_product_id: producto, p_cantidad: 20 });

const { data: abierta } = await servicio.from('cash_sessions')
  .select('id').eq('user_id', cajero.id).eq('status', 'abierta').maybeSingle();
if (abierta) {
  const { data: r } = await cajero.cli.rpc('fn_cash_session_summary', { p_session_id: abierta.id });
  await cajero.cli.rpc('fn_close_cash_session', { p_session_id: abierta.id, p_counted_amount: r.expected_amount, p_notes: 'QA' });
}

const ultimaVenta = async () => (await servicio
  .from('sales')
  .select('folio, total, document_type, receptor_rut, receptor_razon_social')
  .eq('sold_by', cajero.id).order('folio', { ascending: false }).limit(1)).data?.[0] ?? null;

// ------------------------------------------------------------------ navegador
const nav = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await nav.newContext({ viewport: { width: 420, height: 860 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));

await p.goto(`${BASE}/login`);
await p.fill('#email', cajero.correo);
await p.fill('#password', cajero.clave);
await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);

await p.goto(`${BASE}/caja`);
await p.fill('#inicial', '10.000');
await p.getByRole('button', { name: 'Abrir caja' }).click();
await p.getByRole('heading', { name: 'Abrir caja' }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});

const agregar = async () => {
  await p.goto(`${BASE}/pos`);
  await p.fill('input[type=search]', nombre);
  await p.locator('main li button', { hasText: nombre }).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(1200);
  await p.locator('main li button', { hasText: nombre }).first().click();
};
const cerrarComprobante = async () => {
  const b = p.getByRole('button', { name: 'Nueva venta' });
  if (await b.count()) await b.click();
};

// --------------------------------------------------------------------- BOLETA
console.log('M5-20 · Con efectivo corresponde boleta');
await agregar();
await p.getByRole('button', { name: 'Cobrar' }).click();
let dlg = p.getByRole('dialog');
await dlg.waitFor();
let texto = await dlg.innerText();
ok('M5-20', /Boleta/.test(texto) && !/Voucher/.test(texto),
  'con efectivo ofrece boleta o factura, no voucher', texto.replace(/\n+/g, ' · ').slice(0, 110));
ok('M5-20', /Se entrega boleta y ticket/.test(texto), 'dice qué se le entrega al cliente');
await p.fill('#recibido', '1000');
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.getByText('NO ES DOCUMENTO TRIBUTARIO').first().waitFor({ timeout: 15000 }).catch(() => {});
let ticket = await p.locator('#ticket').innerText().catch(() => '');
ok('M5-20', /Corresponde boleta/.test(ticket), 'el ticket dice que corresponde boleta', ticket.split('\n').slice(0, 4).join(' · '));
await p.waitForTimeout(3500);
let v = await ultimaVenta();
ok('M5-20', v?.document_type === 'boleta', 'la venta queda como boleta en la base', `folio ${v?.folio} · ${v?.document_type}`);
await cerrarComprobante();

// -------------------------------------------------------------------- VOUCHER
console.log('M5-21 · Con tarjeta el documento lo emite la máquina');
await agregar();
await p.getByRole('button', { name: 'Cobrar' }).click();
dlg = p.getByRole('dialog');
await dlg.waitFor();
await p.getByRole('button', { name: /Débito/ }).click();
texto = await dlg.innerText();
ok('M5-21', /Voucher de la máquina/.test(texto) && !/\bBoleta\b/.test(texto),
  'al elegir débito desaparece la boleta y aparece el voucher', texto.replace(/\n+/g, ' · ').slice(0, 110));
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.getByText('EL DOCUMENTO LO EMITE LA MÁQUINA').first().waitFor({ timeout: 15000 })
  .then(() => ok('M5-21', true, 'el ticket avisa que el documento sale de la máquina'),
        () => ok('M5-21', false, 'el ticket avisa que el documento sale de la máquina'));
await p.waitForTimeout(3500);
v = await ultimaVenta();
ok('M5-21', v?.document_type === 'voucher', 'la venta queda como voucher en la base', String(v?.document_type));
await cerrarComprobante();

// -------------------------------------------------------------------- FACTURA
console.log('M5-22 · Factura con RUT y razón social');
await agregar();
await p.getByRole('button', { name: 'Cobrar' }).click();
dlg = p.getByRole('dialog');
await dlg.waitFor();
await p.getByRole('button', { name: /^Factura/ }).click();
await p.fill('#recibido', '1000');

const confirmar = dlg.getByRole('button', { name: 'Confirmar venta' });
ok('M5-22', await confirmar.isDisabled(), 'sin los datos del cliente no deja confirmar la factura');

await dlg.getByLabel(/RUT del cliente/).fill(RUT_MAL);
await dlg.getByLabel(/Nombre o razón social/).fill('Comercial Los Andes SpA');
texto = await dlg.innerText();
ok('M5-22', /Revisa el RUT/.test(texto) && await confirmar.isDisabled(),
  'un RUT con dígito verificador malo se avisa y bloquea', (texto.match(/[^\n]*RUT[^\n]*/) ?? [''])[0]);

await dlg.getByLabel(/RUT del cliente/).fill('760864285');
await dlg.getByLabel(/Nombre o razón social/).click();   // dispara el formateo
ok('M5-22', (await dlg.getByLabel(/RUT del cliente/).inputValue()) === RUT_OK,
  'el RUT se formatea solo con puntos y guion');
await confirmar.click();
await p.getByText('Factura a:').first().waitFor({ timeout: 15000 }).catch(() => {});
ticket = await p.locator('#ticket').innerText().catch(() => '');
ok('M5-22', /Factura a: Comercial Los Andes SpA/.test(ticket) && new RegExp(`RUT: ${RUT_OK.replace(/\./g, '\\.')}`).test(ticket),
  'el ticket lleva los datos del receptor', (ticket.match(/[^\n]*Factura a[^\n]*/) ?? [''])[0]);
await p.waitForTimeout(3500);
v = await ultimaVenta();
ok('M5-22', v?.document_type === 'factura' && v?.receptor_rut === RUT_OK,
  'la factura queda en la base con su receptor', `${v?.document_type} · ${v?.receptor_rut} · ${v?.receptor_razon_social}`);
await cerrarComprobante();

console.log('M5-23 · El historial de ventas dice qué documento fue cada una');
await p.goto(`${BASE}/ventas`);
await p.waitForTimeout(2500);
const historial = await p.locator('main').innerText();
ok('M5-23', /Factura/.test(historial) && /Voucher/.test(historial) && /Boleta/.test(historial),
  'Ventas muestra boleta, factura y voucher',
  (historial.match(/Folio[^\n]*\n[^\n]*/) ?? [''])[0].replace(/\n/g, ' · '));

// -------------------------------------------------------- CONSULTAR PRECIO
console.log('M5-24 · Consultador de precios');
await p.goto(`${BASE}/precio`);
await p.fill('input[type=search]', nombre);
await p.locator('main li button', { hasText: nombre }).first().waitFor({ timeout: 15000 });
await p.locator('main li button', { hasText: nombre }).first().click();
const precio = await p.locator('main').innerText();
ok('M5-24', /\$1\.000/.test(precio), 'muestra el precio del producto buscado',
  (precio.match(/[^\n]*\$1\.000[^\n]*/) ?? [''])[0]);
ok('M5-24', /IVA incluido/.test(precio), 'dice que el precio incluye IVA');

// ------------------------------------------------------ BARRA DEL CELULAR
console.log('RNF-16 · En el celular se llega más allá de Inventario');
const barra = await p.locator('nav[aria-label="Navegación principal"]').last().innerText();
const masCelular = p.locator('nav[aria-label="Navegación principal"]').last().getByRole('button', { name: 'Más' });
if (await masCelular.count()) {
  await masCelular.click();
  await p.getByRole('dialog').waitFor({ timeout: 5000 });
  const menu = await p.getByRole('dialog').innerText();
  ok('RNF-16', /Proveedores/.test(menu) && /Ventas/.test(menu) && /Reportes/.test(menu),
    'el menú "Más" lleva a lo que no cabe en la barra', menu.replace(/\n+/g, ' · '));
  await p.keyboard.press('Escape');
} else {
  // Un vendedor ve pocas secciones y le caben todas: no necesita "Más".
  ok('RNF-16', /Precio/.test(barra), 'a este rol le caben todas las secciones en la barra',
    barra.replace(/\n+/g, ' · '));
}

console.log(`\nErrores de JavaScript: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
await nav.close();
await admin.cli.from('products').update({ is_active: false }).eq('id', producto);

const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-documento.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
