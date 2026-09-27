/**
 * Ofertas por cantidad, impuestos adicionales y configuración del local (0018),
 * como lo hace el administrador desde el celular, en "QA · pruebas internas".
 *
 *   node tools/ui/ofertas.mjs          (la app compilada en http://localhost:3001)
 *
 * Lo que pidió el cliente el 2026-09-26, textual: «1 por $2.000 y si llevas 3
 * te llevas los 3 a $1.400 cada uno» y «poder modificar el impuesto adicional
 * y las tasas por producto o productos en general».
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

// ---------------------------------------------------------------- preparación
const admin = await usuario('admin');
const { data: perfil } = await servicio.from('profiles').select('tenant_id').eq('id', admin.id).single();
const tenant = perfil.tenant_id;
const sufijo = Date.now().toString().slice(-5);
async function producto(nombre, precio) {
  const { data, error } = await admin.cli.rpc('fn_create_product', {
    p_name: nombre, p_sku: null, p_description: 'Producto de prueba QA', p_category_id: null, p_unit: 'unidad',
    p_sale_price: precio, p_avg_cost: Math.round(precio * 0.5), p_min_stock: 0, p_tracks_expiry: false,
    p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0, p_initial_stock_sala: 50 });
  if (error) throw error;
  return data.product_id;
}
const nJugo = `QA Jugo ${sufijo}`, nBebida = `QA Bebida ${sufijo}`;
const pJugo = await producto(nJugo, 2000);
const pBebida = await producto(nBebida, 1990);
// Impuestos de corridas anteriores: fuera, para que el botón del preset aparezca.
await servicio.from('products').update({ impuesto_adicional_id: null }).eq('tenant_id', tenant);
await servicio.from('impuestos_adicionales').delete().eq('tenant_id', tenant);
// Caja del administrador abierta para vender.
const { data: abierta } = await servicio.from('cash_sessions').select('id').eq('user_id', admin.id).eq('status', 'abierta').maybeSingle();
if (!abierta) await admin.cli.rpc('fn_open_cash_session', { p_opening_amount: 0 });

// ---------------------------------------------------------------- navegador
const nav = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errores.push(`${r.status()} ${r.url().slice(0, 140)}`); });
await p.goto(`${BASE}/login`);
await p.fill('#email', admin.correo);
await p.fill('#password', admin.clave);
await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);

console.log('Configuración · impuesto adicional desde el celular');
await p.getByRole('button', { name: 'Más' }).click();
await p.getByRole('link', { name: /Configuración/ }).click();
await p.waitForURL('**/configuracion');
ok('RQ-06', true, 'se llega a Configuración desde "Más" en el celular');
await p.getByRole('button', { name: /IABA bebidas con alto azúcar/ }).click();
await p.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
await p.getByText(/agregado/).first().waitFor({ timeout: 15000 });
const { data: imps } = await servicio.from('impuestos_adicionales').select('id, tasa, codigo_sii').eq('tenant_id', tenant);
ok('RQ-06', imps?.length === 1 && Number(imps[0].tasa) === 18 && imps[0].codigo_sii === 271,
  'crea IABA 18 % con código SII 271', JSON.stringify(imps?.map((i) => [Number(i.tasa), i.codigo_sii])));
const iaba = imps[0].id;

await p.getByRole('button', { name: 'Elegir productos' }).click();
const dlg = p.getByRole('dialog');
await dlg.getByLabel('Buscar producto').fill(nBebida);
await dlg.getByText(nBebida).click();
await dlg.getByRole('button', { name: /Guardar \(1 producto\)/ }).click();
await p.getByText(/1 producto agregado/).waitFor({ timeout: 15000 });
const { data: b1 } = await servicio.from('products').select('impuesto_adicional_id').eq('id', pBebida).single();
ok('RQ-06', b1.impuesto_adicional_id === iaba, 'asigna el impuesto a un producto elegido de la lista');

console.log('Productos · la oferta del cliente en el formulario');
await p.goto(`${BASE}/productos`);
await p.fill('input[placeholder^="Buscar por nombre"]', nJugo);
await p.waitForTimeout(1500);
await p.getByRole('button', { name: 'Editar' }).first().click();
await p.getByRole('button', { name: '+ Agregar oferta' }).click();
await p.getByLabel('Oferta 1: desde cuántas unidades').fill('3');
await p.getByLabel('Oferta 1: precio de cada unidad').fill('1.400');
const ejemplo = await p.getByText(/3 unidades = \$4\.200 · ahorra \$1\.800/).count();
ok('RQ-04', ejemplo > 0, 'el formulario muestra el ejemplo: 3 unidades = $4.200, ahorra $1.800');
await p.getByRole('button', { name: 'Guardar cambios' }).click();
await p.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
const { data: tr } = await servicio.from('product_price_tiers').select('desde, precio').eq('product_id', pJugo);
ok('RQ-04', tr?.length === 1 && Number(tr[0].desde) === 3 && tr[0].precio === 1400, 'la oferta quedó en la base', JSON.stringify(tr));

// Una oferta que no es oferta se rechaza en el formulario, sin guardar nada.
await p.getByRole('button', { name: 'Editar' }).first().click();
await p.getByLabel('Oferta 1: precio de cada unidad').fill('2.500');
await p.getByRole('button', { name: 'Guardar cambios' }).click();
const errOferta = await p.getByRole('alert').first().innerText({ timeout: 5000 }).catch(() => '');
ok('RQ-04', /menor que el precio normal/.test(errOferta), 'una "oferta" más cara que el precio normal no se guarda', errOferta);
await p.locator('footer').getByRole('button', { name: 'Cancelar' }).click();

console.log('Consultor de precio');
await p.goto(`${BASE}/precio`);
await p.waitForTimeout(2500);  // el catálogo del celular se sincroniza al entrar
await p.getByLabel('Buscar un producto para ver su precio').fill(nJugo);
await p.getByRole('button', { name: new RegExp(nJugo) }).first().click();
const consultor = await p.locator('main').innerText();
ok('RQ-04', /Desde 3: \$1\.400 c\/u/.test(consultor), 'el consultador muestra la oferta', consultor.replace(/\n+/g, ' · ').slice(0, 120));

console.log('POS · el carrito aplica la oferta y separa el impuesto');
await p.goto(`${BASE}/pos`);
const buscar = async (nombre) => {
  await p.fill('input[type=search]', nombre);
  const b = p.locator('main li button', { hasText: nombre }).first();
  await b.waitFor({ timeout: 15000 });
  await b.click();
};
await buscar(nJugo);
await p.getByRole('button', { name: `Agregar una unidad de ${nJugo}` }).click();
let barra = await p.locator('.sticky.bottom-0').innerText();
ok('RQ-04', /\$4\.000/.test(barra), 'con 2 unidades, precio normal: $4.000', barra.replace(/\n+/g, ' · '));
const pista = await p.getByText(/Llevando 1 más: \$1\.400 c\/u/).count();
ok('RQ-04', pista > 0, 'el POS le dice al cajero cuántas faltan para la oferta');
await p.getByRole('button', { name: `Agregar una unidad de ${nJugo}` }).click();
barra = await p.locator('.sticky.bottom-0').innerText();
ok('RQ-04', /\$4\.200/.test(barra), 'con 3 unidades, las 3 a $1.400: $4.200', barra.replace(/\n+/g, ' · '));
ok('RQ-04', (await p.getByText(/Oferta aplicada · ahorra \$1\.800/).count()) > 0, 'muestra el ahorro en la línea');
await buscar(nBebida);
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.fill('#recibido', '10000');
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.locator('#ticket').first().waitFor({ timeout: 15000 });
const ticket = await p.getByRole('dialog').innerText().catch(async () => p.locator('body').innerText());
ok('RQ-04', /ahorra \$1\.800/.test(ticket), 'el comprobante dice cuánto se ahorró');
ok('RQ-06', /IABA bebidas con alto azúcar 18%/.test(ticket), 'el comprobante separa el IABA 18 %');
await p.waitForTimeout(2500);
const { data: venta } = await servicio.from('sales').select('id, total, neto, tax_amount, impuestos_adicionales')
  .eq('sold_by', admin.id).order('folio', { ascending: false }).limit(1).single();
ok('RQ-04', venta.total === 6190, 'la base registró $4.200 + $1.990 = $6.190', `total ${venta.total}`);
ok('RQ-06', venta.neto + venta.tax_amount + venta.impuestos_adicionales === venta.total && venta.impuestos_adicionales > 0,
  'neto + IVA + IABA = total, en la base', `${venta.neto} + ${venta.tax_amount} + ${venta.impuestos_adicionales}`);
const nueva = p.getByRole('button', { name: 'Nueva venta' });
if (await nueva.count()) await nueva.click();

console.log('Configuración · cambiar la tasa (la ley cambia)');
await p.goto(`${BASE}/configuracion`);
await p.getByRole('button', { name: 'Cambiar tasa' }).click();
await p.getByRole('dialog').getByLabel(/Tasa/).fill('10');
await p.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
await p.getByText(/quedó en 10%/).waitFor({ timeout: 15000 });
const { data: i2 } = await servicio.from('impuestos_adicionales').select('tasa').eq('id', iaba).single();
const { data: v2 } = await servicio.from('sales').select('impuestos_adicionales').eq('id', venta.id).single();
ok('RQ-06', Number(i2.tasa) === 10, 'la tasa nueva quedó en la base');
ok('RQ-06', v2.impuestos_adicionales === venta.impuestos_adicionales, 'la venta ya hecha no cambió');

console.log('Configuración · operación del local (T-18)');
const antesCfg = (await servicio.from('tenants').select('settings').eq('id', tenant).single()).data.settings;
await p.getByText('Cualquier cajero vende aunque el sistema diga que no hay stock', { exact: true }).click();
await p.waitForTimeout(2500);
const despuesCfg = (await servicio.from('tenants').select('settings').eq('id', tenant).single()).data.settings;
ok('T-18', despuesCfg.vender_sin_stock === !antesCfg.vender_sin_stock, 'el interruptor cambia la configuración en la base');
await p.getByText('Cualquier cajero vende aunque el sistema diga que no hay stock', { exact: true }).click();
await p.waitForTimeout(2500);
const finalCfg = (await servicio.from('tenants').select('settings').eq('id', tenant).single()).data.settings;
ok('T-18', finalCfg.vender_sin_stock === antesCfg.vender_sin_stock, 'y vuelve');

// Medición de la pantalla nueva en el celular.
const med = await p.evaluate(() => ({
  desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
ok('RNF-16', med.desborde <= 1, 'Configuración sin desplazamiento horizontal a 390 px', `${med.desborde} px`);

console.log(`\nErrores de JavaScript o HTTP: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
if (errores.length) ok('RNF', false, 'sin errores de JavaScript ni respuestas 4xx/5xx');
await nav.close();
for (const id of [pJugo, pBebida]) await admin.cli.from('products').update({ is_active: false }).eq('id', id);
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-ofertas.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
