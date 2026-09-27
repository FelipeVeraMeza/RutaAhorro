/**
 * Boletas, facturas y notas de crédito (0019) y devoluciones, en el navegador,
 * como las usa el local desde el celular, en "QA · pruebas internas".
 *
 *   node tools/ui/documentos.mjs      (la app compilada en http://localhost:3001)
 *
 * El timbre no se da por bueno porque se dibuje: se captura de la pantalla y
 * se DECODIFICA con un lector de PDF417 (ZXing), y lo leído tiene que ser el
 * TED de ese documento.
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import zx from '@zxing/library';

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

/** Lee el PDF417 de una captura PNG. Devuelve el texto o null. */
async function leerPdf417(png) {
  const { data, info } = await sharp(png).flatten({ background: '#ffffff' }).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const lum = new Uint8ClampedArray(data);
  const fuente = new zx.RGBLuminanceSource(lum, info.width, info.height);
  // RGBLuminanceSource espera RGB; con un solo canal se arma la luminancia directo.
  const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.PlanarYUVLuminanceSource(
    lum, info.width, info.height, 0, 0, info.width, info.height, false)));
  void fuente;
  try {
    return new zx.PDF417Reader().decode(bitmap).getText();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------- preparación
const admin = await usuario('admin');
const { data: perfil } = await servicio.from('profiles').select('tenant_id').eq('id', admin.id).single();
const tenant = perfil.tenant_id;
const sufijo = Date.now().toString().slice(-5);
const nombre = `QA Arroz ${sufijo}`;
const { data: prod, error: eProd } = await admin.cli.rpc('fn_create_product', {
  p_name: nombre, p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 1500, p_avg_cost: 800, p_min_stock: 0, p_tracks_expiry: false, p_expiry_alert_days: 30,
  p_barcodes: null, p_initial_stock: 0, p_initial_stock_sala: 30 });
if (eProd) throw eProd;
const pid = prod.product_id;
const { data: abierta } = await servicio.from('cash_sessions').select('id').eq('user_id', admin.id).eq('status', 'abierta').maybeSingle();
if (!abierta) await admin.cli.rpc('fn_open_cash_session', { p_opening_amount: 20000 });

const nav = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, acceptDownloads: true });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errores.push(`${r.status()} ${r.url().slice(0, 140)}`); });
await p.goto(`${BASE}/login`);
await p.fill('#email', admin.correo);
await p.fill('#password', admin.clave);
await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);

// ---------------------------------------------------------------------------- emisor
console.log('Configuración · datos del emisor');
await p.goto(`${BASE}/configuracion`);
await p.getByLabel('RUT del emisor').fill('76.086.428-5');
await p.getByLabel('Razón social').fill('Comercial QA SpA');
await p.getByLabel('Giro', { exact: true }).fill('Almacén de abarrotes');
await p.getByLabel('Dirección').fill('Av. Prueba 123');
await p.getByLabel('Comuna').fill('Santiago');
await p.getByRole('button', { name: 'Guardar datos del emisor' }).click();
await p.getByText(/Datos del emisor guardados/).waitFor({ timeout: 15000 }).catch(async () => {
  console.log('  (aviso en pantalla:', (await p.locator('[role=alert],[role=status]').allInnerTexts()).join(' | '), ')');
});
const { data: em } = await servicio.from('dte_emisores').select('rut, razon_social, ambiente').eq('tenant_id', tenant).single();
ok('F5 T-21', em?.rut === '76.086.428-5' && em.ambiente === 'simulacion', 'el emisor queda guardado, en simulación', JSON.stringify(em));

// ---------------------------------------------------------------------------- boleta
console.log('POS · venta en efectivo con boleta electrónica simulada');
await p.goto(`${BASE}/pos`);
const agregar = async () => {
  await p.fill('input[type=search]', nombre);
  const b = p.locator('main li button', { hasText: nombre }).first();
  await b.waitFor({ timeout: 15000 });
  await b.click();
};
await agregar();
await p.getByRole('button', { name: `Agregar una unidad de ${nombre}` }).click();
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.fill('#recibido', '5000');
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.locator('#ticket').waitFor({ timeout: 15000 });
let ticket = await p.locator('#ticket').innerText();
const mBoleta = ticket.match(/BOLETA ELECTRÓNICA N° (\d+)/);
ok('RQ-19 F5', !!mBoleta, 'el ticket dice BOLETA ELECTRÓNICA con su número', mBoleta?.[0]);
ok('T-27', /SIMULADA · SIN VALIDEZ TRIBUTARIA/.test(ticket), 'y dice que es simulada, sin validez tributaria');
ok('F5 T-21', /RUT 76\.086\.428-5/.test(ticket), 'lleva el RUT del emisor');
const timbre = p.locator('figure[aria-label="Timbre electrónico"]');
ok('T-26', (await timbre.locator('svg').count()) === 1, 'lleva el timbre PDF417 dibujado');
const png = await timbre.locator('div').first().screenshot();
const leido = await leerPdf417(png);
ok('T-26', !!leido && leido.startsWith('<TED version="1.0">') && leido.includes(`<F>${mBoleta?.[1]}</F>`) && leido.includes('<TD>39</TD>'),
  'el PDF417 se LEE con un lector y es el TED de esa boleta', leido ? leido.slice(0, 70) + '…' : 'no se pudo leer');
await p.waitForTimeout(1500);
const { data: venta1 } = await servicio.from('sales').select('id, folio, total').eq('sold_by', admin.id).order('folio', { ascending: false }).limit(1).single();
const { data: doc1 } = await servicio.from('dte_documentos').select('tipo, folio, total').eq('sale_id', venta1.id).single();
ok('F5 T-23', doc1?.tipo === 39 && Number(doc1.folio) === Number(mBoleta?.[1]) && doc1.total === 3000,
  'la base registró la boleta con ese folio y el total de la venta', JSON.stringify(doc1));
await p.getByRole('button', { name: 'Nueva venta' }).click().catch(() => {});

// ---------------------------------------------------------------------------- tarjeta
console.log('POS · con tarjeta no se emite boleta (la emite la máquina)');
await agregar();
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.getByRole('button', { name: /Débito/ }).click();
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.locator('#ticket').waitFor({ timeout: 15000 });
ticket = await p.locator('#ticket').innerText();
ok('RQ punto 4', /EL DOCUMENTO LO EMITE LA MÁQUINA/.test(ticket) && !/BOLETA ELECTRÓNICA/.test(ticket),
  'con débito el papel no es boleta y no lleva timbre');
await p.waitForTimeout(1500);
const { data: venta2 } = await servicio.from('sales').select('id, folio').eq('sold_by', admin.id).order('folio', { ascending: false }).limit(1).single();
const { data: doc2 } = await servicio.from('dte_documentos').select('id').eq('sale_id', venta2.id);
ok('RQ punto 4', (doc2 ?? []).length === 0, 'y no se registró documento');
await p.getByRole('button', { name: 'Nueva venta' }).click().catch(() => {});

// ---------------------------------------------------------------------------- ventas: documento y XML
console.log('Ventas · ver la boleta, descargar el XML');
await p.goto(`${BASE}/ventas`);
await p.getByRole('button', { name: new RegExp(`Folio ${venta1.folio}\\b`) }).first().click();
const dlg = p.getByRole('dialog');
await dlg.getByRole('button', { name: /Boleta electrónica N°/ }).click();
const dlgDoc = p.getByRole('dialog', { name: /Boleta electrónica N°/ });
await dlgDoc.waitFor({ timeout: 10000 });
ok('F5', (await dlgDoc.locator('svg').count()) >= 1, 'el documento se reimprime con su timbre desde Ventas');
const [descarga] = await Promise.all([p.waitForEvent('download'), dlgDoc.getByRole('button', { name: 'Descargar XML' }).click()]);
const xml = fs.readFileSync(await descarga.path(), 'utf8');
ok('F5 T-23', xml.includes('<TipoDTE>39</TipoDTE>') && xml.includes(`<Folio>${mBoleta?.[1]}</Folio>`) && xml.includes('<RUTEmisor>76086428-5</RUTEmisor>') && xml.includes('<MntTotal>3000</MntTotal>'),
  'el XML descargado tiene tipo, folio, emisor y total', descarga.suggestedFilename());
// Escape cierra solo el de arriba: el detalle de la venta sigue abierto.
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
ok('RNF-45', (await p.getByRole('dialog').count()) === 1 && (await dlgDoc.count()) === 0,
  'con dos diálogos, Escape cierra el de arriba y deja el de abajo');
ok('RQ-19', (await dlg.getByRole('button', { name: 'Anular esta venta' }).count()) === 0,
  'una venta con boleta no ofrece "Anular": se devuelve con nota de crédito');

// ---------------------------------------------------------------------------- devolución parcial
console.log('Ventas · devolver 1 de 2 unidades, en efectivo, con nota de crédito');
const salaAntes = Number((await servicio.from('stock_ubicaciones').select('quantity').eq('product_id', pid).eq('ubicacion', 'sala').single()).data.quantity);
await dlg.getByRole('button', { name: 'Devolver productos' }).click();
const dlgDev = p.getByRole('dialog', { name: /Devolver productos/ });
await dlgDev.getByLabel(`Unidades de ${nombre} que vuelven`).fill('1');
await dlgDev.getByLabel('Motivo').fill('Producto en mal estado');
await dlgDev.getByLabel('Efectivo').check();
const boton = await dlgDev.getByRole('button', { name: /^Devolver \$/ }).innerText();
ok('RQ-18', /\$1\.500/.test(boton), 'antes de confirmar dice cuánto se devuelve: $1.500', boton);
await dlgDev.getByRole('button', { name: /^Devolver \$/ }).click();
const dlgNc = p.getByRole('dialog', { name: /Nota de crédito electrónica N°/ });
await dlgNc.waitFor({ timeout: 15000 });
const nc = await dlgNc.innerText();
ok('RQ-19', /Referencia: Boleta electrónica N° \d+ · corrige montos/.test(nc), 'la nota de crédito referencia la boleta y corrige montos',
  (nc.match(/Referencia[^\n]*/) ?? [''])[0]);
const ncPng = await dlgNc.locator('figure[aria-label="Timbre electrónico"] div').first().screenshot();
const ncLeido = await leerPdf417(ncPng);
ok('T-26', !!ncLeido && ncLeido.includes('<TD>61</TD>'), 'el timbre de la nota de crédito también se lee', ncLeido ? 'TD 61' : 'no se pudo leer');
const { data: dev } = await servicio.from('sale_returns').select('numero, monto, reembolso').eq('sale_id', venta1.id).single();
ok('RQ-18', dev?.monto === 1500 && dev.reembolso === 'efectivo', 'la devolución quedó en la base', JSON.stringify(dev));
const salaDespues = Number((await servicio.from('stock_ubicaciones').select('quantity').eq('product_id', pid).eq('ubicacion', 'sala').single()).data.quantity);
ok('RQ-18', salaDespues === salaAntes + 1, 'la unidad volvió a la sala de ventas', `${salaAntes} → ${salaDespues}`);
const { data: egreso } = await servicio.from('cash_movements').select('amount, type').like('reason', `Devolución N° ${dev?.numero} %`);
ok('RQ-18', egreso?.length === 1 && egreso[0].amount === 1500 && egreso[0].type === 'egreso', 'la plata salió de la caja como egreso');

console.log(`\nErrores de JavaScript o HTTP: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
if (errores.length) ok('RNF', false, 'sin errores de JavaScript ni respuestas 4xx/5xx');
await nav.close();
await admin.cli.from('products').update({ is_active: false }).eq('id', pid);
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-documentos.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
