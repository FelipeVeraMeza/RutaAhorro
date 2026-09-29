/**
 * Ofertas a varios productos a la vez y el interruptor del local (0021),
 * como lo hace el administrador desde el celular y como lo cobra un cajero,
 * en "QA · pruebas internas".
 *
 *   node tools/ui/ofertas-masivas.mjs   (la app compilada en http://localhost:3001)
 *
 * El cajero tiene tope de descuento 0 %: si la base le acepta la venta a
 * precio de oferta, es porque la oferta es legítima y no un descuento.
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
const cajero = await usuario('cajero');
const { data: perfil } = await servicio.from('profiles').select('tenant_id').eq('id', admin.id).single();
const tenant = perfil.tenant_id;
const cfgInicial = (await servicio.from('tenants').select('settings').eq('id', tenant).single()).data.settings;
const sufijo = Date.now().toString().slice(-5);
const PREFIJO = `QA Masiva ${sufijo}`;
async function producto(nombre, precio) {
  const { data, error } = await admin.cli.rpc('fn_create_product', {
    p_name: nombre, p_sku: null, p_description: 'Producto de prueba QA', p_category_id: null, p_unit: 'unidad',
    p_sale_price: precio, p_avg_cost: Math.round(precio * 0.5), p_min_stock: 0, p_tracks_expiry: false,
    p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0, p_initial_stock_sala: 100 });
  if (error) throw error;
  return data.product_id;
}
const nA = `${PREFIJO} Cerveza A`, nB = `${PREFIJO} Cerveza B`, nC = `${PREFIJO} Chicle`;
const pA = await producto(nA, 1990);
const pB = await producto(nB, 2490);
const pC = await producto(nC, 300);
// Por si una corrida anterior quedó a medias.
if (cfgInicial?.ofertas_activas === false) {
  await admin.cli.rpc('fn_guardar_configuracion', { p_cambios: { ofertas_activas: true } });
}
for (const u of [admin, cajero]) {
  const { data: abierta } = await servicio.from('cash_sessions').select('id').eq('user_id', u.id).eq('status', 'abierta').maybeSingle();
  if (!abierta) await u.cli.rpc('fn_open_cash_session', { p_opening_amount: 0 });
}
const tramosDe = async (id) => (await servicio.from('product_price_tiers')
  .select('desde, precio, descuento_pct').eq('product_id', id).order('desde')).data ?? [];

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

console.log('Productos → Ofertas, desde el celular');
await p.goto(`${BASE}/productos`);
await p.getByTitle('Una oferta a varios productos a la vez').click();
await p.waitForURL('**/productos/ofertas');
ok('RQ-42', true, 'se llega a "Ofertas a varios productos" desde Productos');

console.log('Una oferta por porcentaje a tres productos');
await p.getByRole('radio', { name: '% menos' }).click();
await p.getByLabel('Desde cuántas unidades').fill('6');
await p.getByLabel('Porcentaje de rebaja').fill('10');
await p.getByLabel('Buscar producto').fill(PREFIJO);
await p.getByText(/Marcar los 3 de la lista/).click();
const lista = await p.getByRole('list', { name: 'Productos' }).innerText();
ok('RQ-42', /desde 6: \$1\.791 c\/u/.test(lista) && /desde 6: \$2\.241 c\/u/.test(lista) && /desde 6: \$270 c\/u/.test(lista),
  'antes de guardar, muestra a cuánto queda cada uno (10 % de $1.990, $2.490 y $300)', lista.replace(/\n+/g, ' · ').slice(0, 200));
await p.getByRole('button', { name: 'Aplicar a 3 productos' }).click();
await p.getByRole('dialog').getByRole('button', { name: 'Sí, aplicar' }).click();
await p.getByText(/aplicada a 3 productos/).waitFor({ timeout: 15000 });
const tA = await tramosDe(pA), tC = await tramosDe(pC);
ok('RQ-42', tA.length === 1 && Number(tA[0].descuento_pct) === 10 && tA[0].precio === null && tC.length === 1,
  'quedó un tramo "desde 6, 10 % menos" en cada producto', JSON.stringify(tA));

console.log('Un precio fijo que a uno no le sirve');
await p.getByRole('radio', { name: 'Precio fijo c/u' }).click();
await p.getByLabel('Desde cuántas unidades').fill('12');
await p.getByLabel('Precio de cada unidad').fill('1.500');
await p.getByText(/Marcar los 3 de la lista/).click();
const lista2 = await p.getByRole('list', { name: 'Productos' }).innerText();
ok('RQ-42', /Se salta: la oferta no es más barata/.test(lista2), 'avisa, antes de guardar, que el chicle ($300) se salta');
ok('RQ-42', await p.getByRole('button', { name: 'Aplicar a 2 productos' }).count() === 1, 'el botón cuenta solo los 2 que sí');
await p.getByRole('button', { name: 'Aplicar a 2 productos' }).click();
await p.getByRole('dialog').getByRole('button', { name: 'Sí, aplicar' }).click();
const aviso2 = await p.getByText(/aplicada a 2 productos/).innerText({ timeout: 15000 });
ok('RQ-42', /Se saltaron 1: .*Chicle/.test(aviso2), 'y después dice cuál se saltó y por qué', aviso2.slice(0, 160));
ok('RQ-42', (await tramosDe(pA)).length === 2 && (await tramosDe(pC)).length === 1,
  'la cerveza quedó con sus dos ofertas; el chicle, solo con la del 10 %');

console.log('Medición en el celular (360 px)');
const med = await p.evaluate(() => {
  const b = [...document.querySelectorAll('[data-acciones] button')].at(-1);
  const r = b.getBoundingClientRect();
  const encima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    alto: Math.round(r.height), tapado: !b.contains(encima),
  };
});
ok('RNF-16', med.desborde <= 1, 'sin desplazamiento horizontal', `${med.desborde} px`);
ok('RNF-16', med.alto >= 44 && !med.tapado, 'el botón de aplicar mide 44 px o más y no lo tapa la barra de navegación',
  `${med.alto} px, tapado: ${med.tapado}`);
await p.screenshot({ path: 'tools/ui/.capturas/ofertas-masivas-360.png', fullPage: false }).catch(() => {});

console.log('El formulario del producto muestra la oferta por porcentaje');
await p.goto(`${BASE}/productos`);
await p.fill('input[placeholder^="Buscar por nombre"]', nA);
await p.waitForTimeout(1500);
await p.getByRole('button', { name: 'Editar' }).first().click();
const pct = await p.getByLabel('Oferta 1: porcentaje de rebaja').inputValue().catch(() => '');
ok('RQ-44', pct === '10', 'la oferta 1 se ve como "10 % menos", no como un precio', `"${pct}"`);
const ej = await p.getByText(/6 unidades = \$10\.746 \(\$1\.791 c\/u\)/).count();
ok('RQ-44', ej > 0, 'y el ejemplo: 6 unidades = $10.746');
await p.locator('footer').getByRole('button', { name: 'Cancelar' }).click();

console.log('El cajero (tope 0 %) cobra la oferta por porcentaje');
const c = await entrar(cajero);
async function carro(pag, nombre, veces) {
  await pag.goto(`${BASE}/pos`);
  await pag.waitForTimeout(2500);
  // La venta a medio armar sobrevive a la recarga (2026-09-28): la del paso
  // anterior se vacía, como haría el cajero antes de empezar otra.
  if (await pag.getByRole('button', { name: 'Vaciar' }).count()) {
    await pag.getByRole('button', { name: 'Vaciar' }).click();
    await pag.getByRole('button', { name: 'Sí, vaciar' }).click();
  }
  await pag.fill('input[type=search]', nombre);
  const b = pag.locator('main li button', { hasText: nombre }).first();
  await b.waitFor({ timeout: 15000 });
  await b.click();
  for (let i = 1; i < veces; i++) await pag.getByRole('button', { name: `Agregar una unidad de ${nombre}` }).click();
  return pag.locator('.sticky.bottom-0').innerText();
}
let barra = await carro(c, nA, 6);
ok('RQ-42', /\$10\.746/.test(barra), 'con 6 unidades el POS cobra 6 × $1.791 = $10.746', barra.replace(/\n+/g, ' · '));
await c.getByRole('button', { name: 'Cobrar' }).click();
await c.fill('#recibido', '20000');
await c.getByRole('button', { name: 'Confirmar venta' }).click();
await c.locator('#ticket').first().waitFor({ timeout: 15000 });
await c.waitForTimeout(2000);
const { data: v1 } = await servicio.from('sales').select('total, discount_total')
  .eq('sold_by', cajero.id).order('folio', { ascending: false }).limit(1).single();
ok('RQ-42', v1.total === 10746, 'la base aceptó la venta del cajero a precio de oferta', `total ${v1.total}`);
const nueva = c.getByRole('button', { name: 'Nueva venta' });
if (await nueva.count()) await nueva.click();

console.log('Interruptor: apagar las ofertas en todo el local');
await p.goto(`${BASE}/configuracion`);
await p.getByText('Rigen las ofertas y promociones', { exact: true }).click();
await p.waitForTimeout(2500);
const cfgOff = (await servicio.from('tenants').select('settings').eq('id', tenant).single()).data.settings;
ok('RQ-43', cfgOff.ofertas_activas === false && !!cfgOff.ofertas_pausadas_desde,
  'queda apagado en la base, con la hora en que se apagó', String(cfgOff.ofertas_pausadas_desde));
ok('RQ-43', (await tramosDe(pA)).length === 2, 'apagar no borra ninguna oferta');
await p.goto(`${BASE}/productos/ofertas`);
ok('RQ-43', await p.getByText(/Las ofertas están apagadas en todo el local/)
  .waitFor({ timeout: 10000 }).then(() => true, () => false),
  'la pantalla de ofertas avisa que están apagadas');

barra = await carro(c, nA, 6);
ok('RQ-43', /\$11\.940/.test(barra), 'el POS del cajero cobra el precio normal: 6 × $1.990 = $11.940', barra.replace(/\n+/g, ' · '));
await c.goto(`${BASE}/precio`);
await c.waitForTimeout(2500);
await c.getByLabel('Buscar un producto para ver su precio').fill(nA);
await c.getByRole('button', { name: new RegExp(nA) }).first().click();
const consultor = await c.locator('main').innerText();
ok('RQ-43', !/Desde 6/.test(consultor), 'el consultador de precios no muestra ofertas apagadas');

console.log('Encenderlas de nuevo');
await p.goto(`${BASE}/configuracion`);
await p.getByText('Rigen las ofertas y promociones', { exact: true }).click();
await p.waitForTimeout(2500);
const cfgOn = (await servicio.from('tenants').select('settings').eq('id', tenant).single()).data.settings;
ok('RQ-43', cfgOn.ofertas_activas === true && !cfgOn.ofertas_pausadas_desde, 'encendidas, y la hora se borra');
barra = await carro(c, nA, 6);
ok('RQ-43', /\$10\.746/.test(barra), 'el POS vuelve a cobrar la oferta', barra.replace(/\n+/g, ' · '));

console.log('Quitar las ofertas de varios');
await p.goto(`${BASE}/productos/ofertas`);
await p.getByLabel('Buscar producto').fill(PREFIJO);
await p.getByText(/Marcar los 3 de la lista/).click();
await p.getByRole('button', { name: 'Quitar ofertas' }).click();
await p.getByRole('dialog').getByRole('button', { name: 'Sí, quitar' }).click();
await p.getByText(/Se quitaron las ofertas de 3 productos/).waitFor({ timeout: 15000 });
ok('RQ-42', (await tramosDe(pA)).length + (await tramosDe(pB)).length + (await tramosDe(pC)).length === 0,
  'quedaron sin ofertas');

console.log(`\nErrores de JavaScript o HTTP: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
if (errores.length) ok('RNF', false, 'sin errores de JavaScript ni respuestas 4xx/5xx');
await nav.close();
for (const id of [pA, pB, pC]) await admin.cli.from('products').update({ is_active: false }).eq('id', id);
if (cfgInicial?.ofertas_activas === false) {
  await admin.cli.rpc('fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
}
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-ofertas-masivas.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
