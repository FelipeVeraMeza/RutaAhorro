/**
 * El flujo completo, de crear un producto al cierre de caja, como lo hace el
 * local desde el celular (360 px), en "QA · pruebas internas".
 *
 *   node tools/ui/flujo-completo.mjs   (la app compilada en http://localhost:3001)
 *   RA_BASE=https://rutaahorroweb-production.up.railway.app node tools/ui/flujo-completo.mjs
 *
 * Es el pedido de Felipe del 2026-09-28 («el flujo, perfecto») y cubre los
 * siete hallazgos de ese día (HANDOFF, "CÓMO SEGUIR"):
 *   1 · el formulario pregunta "¿Cuántos tienes hoy?" arriba, no al fondo
 *   2 · al crear, avisa y muestra el producto recién creado
 *   3 · al editar, dice cuánto stock hay y lleva a "Ajustar stock"
 *   3b· quién lo modificó, historial de precios y edición simultánea (0020)
 *   4 · en el POS la cantidad se escribe; decimales solo por kilo, litro…
 *   5 · el consultador agrega a la venta, y la venta no se pierde al salir
 *   6 · un perecible creado con stock nace con su lote y vencimiento (0024)
 *   7 · los botones de la cabecera de Productos dicen qué hacen
 *
 * Nada espera un tiempo fijo a que baje el catálogo: se espera a que el
 * producto aparezca. Por internet (Railway) tarda más que en local, y los
 * 2,5 s fijos de otros recorridos eran la sospecha de sus fallas allá.
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
const CAPTURAS = 'tools/ui/.capturas/flujo';
fs.mkdirSync(CAPTURAS, { recursive: true });
const ESPERA = 30_000;

const resultados = [];
function ok(rf, cumple, texto, detalle = '') {
  resultados.push({ rf, cumple: Boolean(cumple), texto, detalle });
  console.log(`  ${cumple ? '✔' : '✖'} ${rf} · ${texto}${detalle ? ' — ' + detalle : ''}`);
}
/** Un paso que se cae no corta los siguientes: queda como falla y se sigue. */
async function paso(titulo, fn) {
  console.log(titulo);
  try { await fn(); } catch (e) { ok('flujo', false, `el paso se cortó: ${titulo}`, String(e?.message ?? e).split('\n')[0]); }
}
async function usuario(alias) {
  const correo = `qa-${alias}-${ref}@example.com`;
  const { data } = await servicio.auth.admin.listUsers({ perPage: 1000 });
  const u = data.users.find((x) => x.email === correo);
  const clave = randomBytes(12).toString('base64url');
  await servicio.auth.admin.updateUserById(u.id, { password: clave });
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opc);
  await cli.auth.signInWithPassword({ email: correo, password: clave });
  const { data: perfil } = await servicio.from('profiles').select('full_name, tenant_id').eq('id', u.id).single();
  return { id: u.id, correo, clave, cli, nombre: perfil.full_name, tenant: perfil.tenant_id };
}
async function cerrarSiAbierta(u) {
  const { data: s } = await servicio.from('cash_sessions').select('id').eq('user_id', u.id).eq('status', 'abierta').maybeSingle();
  if (!s) return;
  const { data: r } = await u.cli.rpc('fn_cash_session_summary', { p_session_id: s.id });
  await u.cli.rpc('fn_close_cash_session', { p_session_id: s.id, p_counted_amount: r.expected_amount, p_notes: 'QA' });
}
/** Día del local más N días, como 'AAAA-MM-DD'. */
const diaMas = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const alto = (loc) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().height));
const desborde = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------------------------------------------------------------- preparación
const admin = await usuario('admin');
const cajero = await usuario('cajero');
await cerrarSiAbierta(cajero);
const sufijo = Date.now().toString().slice(-5);
const nPan = `QA Flujo ${sufijo} Pan amasado`;
const nQueso = `QA Flujo ${sufijo} Queso granel`;
const vence = diaMas(10);
// El queso por kilo se crea por la base: el formulario ya se prueba con el pan.
const { data: rq, error: eq } = await admin.cli.rpc('fn_create_product', {
  p_name: nQueso, p_sku: null, p_description: 'Queso gauda a granel', p_category_id: null, p_unit: 'kg',
  p_sale_price: 9990, p_avg_cost: 6000, p_min_stock: 0, p_tracks_expiry: false, p_expiry_alert_days: 30,
  p_barcodes: null, p_initial_stock: 0, p_initial_stock_sala: 3.5 });
if (eq) throw eq;
const idQueso = rq.product_id;
let idPan = null;

const nav = await chromium.launch({ channel: 'msedge', headless: true });
const movil = { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true };
const errores = [];
async function entrar(u) {
  const ctx = await nav.newContext(movil);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`JS: ${e.message}`));
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errores.push(`${r.status()} ${r.url().slice(0, 140)}`); });
  await p.goto(`${BASE}/login`);
  await p.fill('#email', u.correo);
  await p.fill('#password', u.clave);
  await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: ESPERA }), p.click('button[type=submit]')]);
  return p;
}
let n = 0;
const foto = (p, nombre) => p.screenshot({ path: `${CAPTURAS}/${String(++n).padStart(2, '0')}-${nombre}.png`, fullPage: true });

const p = await entrar(admin);

// ---------------------------------------------------------------- 1 · crear
await paso('1 · Productos: la cabecera y el formulario, en el celular', async () => {
  await p.goto(`${BASE}/productos`);
  await p.getByRole('button', { name: '+ Producto' }).waitFor({ timeout: ESPERA });
  const cabecera = await p.locator('main').first().innerText();
  ok('hallazgo 7', ['Etiquetas', 'Ofertas', 'Importar'].every((t) => cabecera.includes(t)),
    'los botones de la cabecera dicen Etiquetas, Ofertas e Importar');
  await p.getByRole('button', { name: '+ Producto' }).click();
  const f = p.getByRole('dialog');
  await f.getByRole('button', { name: 'Crear producto' }).waitFor();
  // Expresiones con mayúscula y ancladas: "unidad" también aparece en ayudas y totales.
  const y = async (re) => (await f.getByText(re).first().boundingBox({ timeout: 5000 }))?.y ?? -1;
  const orden = [];
  for (const [t, re] of [['Precio de venta', /^Precio de venta/], ['Unidad', /^Unidad$/], ['¿Cuántos tienes hoy?', /^¿Cuántos tienes hoy\?$/],
    ['Producto perecible', /^Producto perecible$/], ['Códigos de barras', /^Códigos de barras$/]]) orden.push([t, await y(re)]);
  const creciente = orden.every(([, v], i) => v > 0 && (i === 0 || v > orden[i - 1][1]));
  ok('hallazgo 1', creciente, 'el orden es Precio → Unidad → ¿Cuántos tienes hoy? → Perecible → Códigos',
    orden.map(([t, v]) => `${t} ${Math.round(v)}`).join(' · '));
  const cuantos = orden[2][1];
  ok('hallazgo 1', cuantos > 0 && cuantos < 780, '"¿Cuántos tienes hoy?" se ve sin desplazarse, en la primera pantalla', `${Math.round(cuantos)} px de 780`);
  ok('hallazgo 1', await f.locator('details').first().evaluate((d) => !d.open), '"Más datos (opcional)" parte plegado');
  await foto(p, 'formulario-nuevo');

  await f.getByRole('textbox', { name: 'Nombre (obligatorio)' }).fill(nPan);
  await f.getByRole('textbox', { name: 'Precio de venta (obligatorio)' }).fill('250');
  await f.getByLabel('Costo', { exact: true }).fill('120');
  await f.getByLabel('En la sala de ventas').fill('20');
  await f.getByLabel('En la bodega').fill('5');
  ok('hallazgo 1', /Total en el local:\s*25 unidades/.test(await f.innerText()), 'suma el total: 25 unidades');
  const fecha = f.getByLabel('¿Cuándo vence lo que tienes?');
  ok('hallazgo 6', await fecha.count() === 1, 'como es perecible y tiene stock, pregunta cuándo vence');
  await fecha.fill(vence);
  ok('RNF-12', (await desborde(p)) <= 1, 'el formulario no se desborda a 360 px');
  await f.getByRole('button', { name: 'Crear producto' }).click();
  const aviso = p.getByRole('status').filter({ hasText: 'creado' });
  await aviso.waitFor({ timeout: ESPERA });
  const textoAviso = await aviso.innerText();
  ok('hallazgo 2', textoAviso.includes(nPan) && /20 a la vista/.test(textoAviso) && /5 en bodega/.test(textoAviso),
    'avisa lo creado y dónde quedó', textoAviso.replace(/\s+/g, ' '));
  const cerrarAviso = p.getByRole('button', { name: 'Cerrar aviso' });
  ok('RNF-16', (await alto(cerrarAviso)) >= 44, 'la × del aviso mide 44 px o más', `${await alto(cerrarAviso)} px`);
  await p.locator('main li', { hasText: nPan }).first().waitFor({ timeout: ESPERA });
  const filas = await p.locator('main li').count();
  const fila = await p.locator('main li', { hasText: nPan }).first().innerText();
  ok('hallazgo 2', filas === 1, 'la lista queda filtrada en el recién creado', `${filas} fila(s)`);
  ok('hallazgo 2', /a la vista 20 · en bodega 5/.test(fila), 'y la fila dice a la vista 20 · en bodega 5', fila.replace(/\s+/g, ' '));
  await foto(p, 'creado');

  const { data: prod } = await servicio.from('products').select('id, sale_price, avg_cost, tracks_expiry').eq('tenant_id', admin.tenant).eq('name', nPan).single();
  idPan = prod.id;
  const { data: lotes } = await servicio.from('product_lots').select('expiry_date, quantity').eq('product_id', idPan);
  ok('hallazgo 6', lotes?.length === 1 && lotes[0].expiry_date === vence && Number(lotes[0].quantity) === 25,
    'en la base nace un lote de 25 que vence en 10 días (0024)', JSON.stringify(lotes));
  ok('RF-M2-01', prod.sale_price === 250 && prod.avg_cost === 120 && prod.tracks_expiry, 'precio $250, costo $120, perecible');
});

// ---------------------------------------------------------------- 3 · editar
await paso('3 · Editar: stock, quién lo tocó, historial de precios', async () => {
  const abrirEdicion = async () => {
    await p.locator('main li', { hasText: nPan }).first().getByRole('button', { name: 'Editar' }).click();
    const f = p.getByRole('dialog');
    await f.getByRole('button', { name: 'Guardar cambios' }).waitFor({ timeout: ESPERA });
    return f;
  };
  let f = await abrirEdicion();
  const t = await f.innerText();
  ok('hallazgo 3', /Stock ahora:\s*25 unidades/.test(t) && /a la vista 20 · en bodega 5/.test(t),
    'dice el stock: 25, a la vista 20 y en bodega 5');
  ok('RF-M10-11', t.includes(`Última modificación: ${admin.nombre}`), 'dice quién lo modificó por última vez', (t.match(/Última modificación:[^\n]*/) ?? [''])[0]);
  for (const b of ['Ajustar stock', 'Ingresar mercadería']) {
    const l = f.getByRole('link', { name: b });
    ok('hallazgo 3', (await l.count()) === 1 && (await alto(l)) >= 44, `ofrece "${b}" con 44 px o más`);
  }
  await foto(p, 'editar');
  await f.getByRole('textbox', { name: 'Precio de venta (obligatorio)' }).fill('300');
  await f.getByRole('button', { name: 'Guardar cambios' }).click();
  await p.getByRole('status').filter({ hasText: 'guardado' }).waitFor({ timeout: ESPERA });
  f = await abrirEdicion();
  // El historial llega después que el formulario: se espera, no se cuenta al tiro.
  const resumen = f.getByText(/^Historial de precios \(1\)$/);
  await resumen.waitFor({ timeout: ESPERA }).catch(() => {});
  ok('RF-M2-09', (await resumen.count()) === 1, 'el formulario muestra "Historial de precios (1)"');
  if (await resumen.count()) {
    await resumen.click();
    const h = await f.innerText();
    ok('RF-M2-09', /\$250\s*→\s*\$300/.test(h) && h.includes(admin.nombre), 'con el cambio $250 → $300 y quién lo hizo');
  }
  // El de abajo: el <Modal> tiene otro "Cancelar" en la cabecera.
  await f.getByRole('button', { name: 'Cancelar', exact: true }).last().click();
});

await paso('3b · Edición simultánea: el segundo en guardar es avisado (0020)', async () => {
  await p.locator('main li', { hasText: nPan }).first().getByRole('button', { name: 'Editar' }).click();
  const f = p.getByRole('dialog');
  await f.getByRole('button', { name: 'Guardar cambios' }).waitFor({ timeout: ESPERA });
  // Otra persona lo cambia mientras este formulario está abierto.
  const { data: x } = await servicio.from('products').select('*').eq('id', idPan).single();
  const { error } = await admin.cli.rpc('fn_update_product', {
    p_product_id: idPan, p_name: x.name, p_sku: x.sku, p_description: 'Cambiado por otra persona',
    p_category_id: x.category_id, p_unit: x.unit, p_sale_price: x.sale_price, p_avg_cost: x.avg_cost,
    p_min_stock: x.min_stock, p_tracks_expiry: x.tracks_expiry, p_expiry_alert_days: x.expiry_alert_days,
    p_barcodes: null, p_expected_updated_at: null });
  if (error) throw error;
  await f.getByRole('textbox', { name: 'Precio de venta (obligatorio)' }).fill('320');
  await f.getByRole('button', { name: 'Guardar cambios' }).click();
  const alerta = f.getByRole('alert');
  await alerta.waitFor({ timeout: ESPERA });
  // La base dice quién fue: "QA admin cambió este producto mientras lo editabas…".
  ok('RF-M10-03', new RegExp(`${admin.nombre} cambió este producto mientras lo editabas`).test(await alerta.innerText()),
    'avisa que otra persona lo cambió, y quién', await alerta.innerText());
  // Ese 400 es el rechazo que se está probando, no un error de la pantalla.
  const i = errores.findIndex((e) => /^400 .*\/rpc\/fn_update_product/.test(e));
  if (i >= 0) errores.splice(i, 1);
  const { data: y } = await servicio.from('products').select('sale_price, description').eq('id', idPan).single();
  ok('RNF-56', y.sale_price === 300 && y.description === 'Cambiado por otra persona', 'y no pisa el cambio del otro: la base sigue en $300 con su descripción');
  await foto(p, 'conflicto');
  const recargar = f.getByRole('button', { name: /Recargar el producto/ });
  ok('RF-M10-03', (await recargar.count()) === 1, 'ofrece "Recargar el producto"');
  await recargar.click();
  await p.waitForFunction(() => {
    const d = document.querySelector('[role=dialog]');
    return d && !d.querySelector('[role=alert]');
  }, null, { timeout: ESPERA });
  const precio = await f.getByRole('textbox', { name: 'Precio de venta (obligatorio)' }).inputValue();
  const desc = await f.getByLabel('Descripción', { exact: true }).inputValue();
  ok('RF-M10-03', precio === '300' && desc === 'Cambiado por otra persona', 'al recargar ve lo que guardó el otro', `precio ${precio} · "${desc}"`);
});

await paso('3 · "Ajustar stock" abre el ajuste de ese producto en Inventario', async () => {
  const f = p.getByRole('dialog');
  await f.getByRole('link', { name: 'Ajustar stock' }).click();
  await p.waitForURL((u) => u.pathname === '/inventario', { timeout: ESPERA });
  const titulo = p.getByRole('dialog').getByText(`Ajustar stock de ${nPan}`);
  await titulo.first().waitFor({ timeout: ESPERA });
  ok('hallazgo 3', true, 'se abre "Ajustar stock" del producto, sin buscarlo');
  await p.waitForFunction(() => !location.search.includes('ajustar'), null, { timeout: 5000 }).catch(() => {});
  ok('hallazgo 3', !p.url().includes('ajustar='), 'y la dirección queda limpia (recargar no lo vuelve a abrir)', p.url());
  await foto(p, 'ajustar');
});

// ---------------------------------------------------------------- 4 · 5 · vender
const c = await entrar(cajero);
await paso('Caja · el cajero abre con $10.000', async () => {
  await c.goto(`${BASE}/caja`);
  await c.fill('#inicial', '10.000');
  await c.getByRole('button', { name: 'Abrir caja' }).click();
  await c.getByRole('heading', { name: 'Abrir caja' }).waitFor({ state: 'detached', timeout: ESPERA });
  ok('RF-M6-01', true, 'caja abierta con $10.000');
});

await paso('5 · Carrera: lo agregado mientras el POS baja el catálogo también se guarda', async () => {
  // Lo destapó Railway: el sincronizador global terminaba antes que el del
  // POS, el producto ya se podía buscar, el cajero lo agregaba… y ese cambio
  // no se guardaba nunca, porque el POS restauraba recién con su catálogo
  // listo. Acá se fuerza ese orden: la segunda consulta de ofertas (la del
  // POS; el sincronizador global pide primero) tarda 12 s. Visto fallar el
  // 2026-09-28 contra la compilación sin el arreglo.
  const ctx2 = await nav.newContext(movil);
  let bloquear = true;
  let ofertas = 0;
  await ctx2.route('**/rest/v1/**', async (r) => {
    if (bloquear) return r.abort();
    if (r.request().url().includes('/product_price_tiers') && ++ofertas === 2) {
      await new Promise((listo) => setTimeout(listo, 12_000));
    }
    return r.continue().catch(() => {});
  });
  const q = await ctx2.newPage();
  await q.goto(`${BASE}/login`);
  await q.fill('#email', cajero.correo);
  await q.fill('#password', cajero.clave);
  await Promise.all([q.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: ESPERA }), q.click('button[type=submit]')]);
  // Con la base bloqueada, el celular sigue sin catálogo: el POS parte de cero.
  bloquear = false;
  await q.goto(`${BASE}/pos`);
  await q.getByLabel('Buscar por nombre o código').fill(nPan);
  const r = q.locator('main li button', { hasText: nPan }).first();
  await r.waitFor({ timeout: ESPERA });
  const antes = ofertas;
  await r.click();
  await q.waitForTimeout(800);
  await q.reload();
  const linea = q.getByRole('textbox', { name: new RegExp(`^Cantidad de ${nPan}`) });
  const volvio = await linea.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  ok('hallazgo 5', volvio, 'lo agregado antes de que el POS terminara de bajar el catálogo sigue ahí al recargar',
    `consultas de ofertas antes de agregar: ${antes}`);
  await ctx2.close();
});

const cantidadDe = (nombre) => c.getByRole('textbox', { name: new RegExp(`^Cantidad de ${nombre}`) });
const barra = () => c.locator('.sticky.bottom-0').innerText().then((t) => t.replace(/\s+/g, ' '));

await paso('5 · Consultador: "Agregar a la venta" lleva al POS con la cantidad', async () => {
  await c.goto(`${BASE}/precio`);
  await c.getByLabel('Buscar un producto para ver su precio').fill(nPan);
  const r = c.locator('main li button', { hasText: nPan }).first();
  await r.waitFor({ timeout: ESPERA });
  await r.click();
  ok('RQ consultador', /\$300/.test(await c.locator('main').innerText()), 'muestra el precio nuevo: $300');
  const cant = c.getByRole('textbox', { name: 'Cantidad' });
  const boton = c.getByRole('button', { name: /Agregar a la venta/ });
  ok('RNF-16', (await alto(cant)) >= 44 && (await alto(boton)) >= 44, 'cantidad y botón miden 44 px o más');
  await cant.fill('1,5');
  await boton.click();
  const err = c.getByRole('alert').filter({ hasText: 'entero' });
  ok('hallazgo 4', (await err.count()) === 1 && c.url().endsWith('/precio'), 'un pan no se vende en 1,5: avisa y no se va');
  await cant.fill('2');
  await foto(c, 'consultador');
  await boton.click();
  await c.waitForURL((u) => u.pathname === '/pos', { timeout: ESPERA });
  await cantidadDe(nPan).waitFor({ timeout: ESPERA });
  ok('hallazgo 5', (await cantidadDe(nPan).inputValue()) === '2', 'en el POS aparece el pan con cantidad 2');
  ok('hallazgo 5', /\$600/.test(await barra()), 'y el total es 2 × $300 = $600', await barra());
});

await paso('4 · POS: la cantidad se escribe', async () => {
  const q = cantidadDe(nPan);
  ok('RNF-16', (await alto(q)) >= 44, 'el campo de cantidad mide 44 px o más', `${await alto(q)} px`);
  await q.fill('12');
  await q.press('Enter');
  ok('RF-M5-06', /\$3\.600/.test(await barra()) && /12 unidades/.test(await barra()), '12 panes escritos: $3.600', await barra());
  await q.fill('1,5');
  await q.press('Enter');
  const aviso = await c.getByRole('status').first().innerText().catch(() => '');
  ok('hallazgo 4', /entero/.test(aviso) && (await q.inputValue()) === '12', 'un pan no acepta 1,5: avisa y queda en 12', aviso);
  await q.fill('0');
  await q.press('Enter');
  ok('hallazgo 4', (await q.count()) === 1 && (await q.inputValue()) === '12', 'escribir 0 no saca la línea por accidente');

  await c.getByLabel('Buscar por nombre o código').fill(nQueso);
  const r = c.locator('main li button', { hasText: nQueso }).first();
  await r.waitFor({ timeout: ESPERA });
  await r.click();
  const kg = cantidadDe(nQueso);
  ok('hallazgo 4', (await kg.getAttribute('inputmode')) === 'decimal' && (await q.getAttribute('inputmode')) === 'numeric',
    'el teclado del celular es decimal para el queso y numérico para el pan');
  await kg.fill('0,35');
  await kg.press('Enter');
  const b = await barra();
  // 0,35 × 9.990 = 3.496,5 → $3.497, igual que redondea la base.
  ok('RF-M2-14', (await kg.inputValue()) === '0,35' && /\$3\.497/.test(await c.locator('main').innerText()), '0,35 kg de queso: $3.497');
  ok('hallazgo 4', /\$7\.097/.test(b) && /2 productos/.test(b), 'total $7.097, y la barra dice "2 productos", no "12,35 unidades"', b);
  ok('RNF-12', (await desborde(c)) <= 1, 'el POS con dos líneas no se desborda a 360 px');
  await foto(c, 'pos-cantidades');
});

await paso('5 · La venta a medio armar no se pierde al salir del POS', async () => {
  await c.getByRole('link', { name: /Caja/ }).first().click();
  await c.waitForURL((u) => u.pathname === '/caja', { timeout: ESPERA });
  await c.getByRole('link', { name: /Vender/ }).first().click();
  await c.waitForURL((u) => u.pathname === '/pos', { timeout: ESPERA });
  await cantidadDe(nQueso).waitFor({ timeout: ESPERA });
  ok('hallazgo 5', (await cantidadDe(nPan).inputValue()) === '12' && (await cantidadDe(nQueso).inputValue()) === '0,35',
    'ida y vuelta a Caja por el menú: siguen 12 panes y 0,35 kg');
  await c.reload();
  await cantidadDe(nQueso).waitFor({ timeout: ESPERA });
  ok('hallazgo 5', /\$7\.097/.test(await barra()), 'y también si se recarga la página', await barra());
});

await paso('Cobro · boleta, stock y lote', async () => {
  await c.getByRole('button', { name: 'Cobrar' }).click();
  await c.fill('#recibido', '10000');
  await c.getByRole('button', { name: 'Confirmar venta' }).click();
  const ticket = c.locator('#ticket').first();
  await ticket.waitFor({ timeout: ESPERA });
  const tt = await ticket.innerText();
  ok('RF-M5-14', /12 x/.test(tt) && /0,35 x/.test(tt), 'el comprobante dice "12 x" y "0,35 x", con coma', (tt.match(/0[.,]35 x[^\n]*/) ?? [''])[0]);
  await foto(c, 'comprobante');
  const { data: v } = await servicio.from('sales').select('id, total, sale_items(product_id, quantity, subtotal)')
    .eq('sold_by', cajero.id).order('folio', { ascending: false }).limit(1).single();
  const lPan = v.sale_items.find((i) => i.product_id === idPan);
  const lQueso = v.sale_items.find((i) => i.product_id === idQueso);
  ok('RF-M5-12', v.total === 7097 && Number(lPan?.quantity) === 12 && Number(lQueso?.quantity) === 0.35 && lQueso?.subtotal === 3497,
    'la base registró $7.097: 12 panes y 0,35 kg ($3.497)', `total ${v.total}`);
  const { data: dte } = await servicio.from('dte_documentos').select('tipo').eq('sale_id', v.id);
  ok('RF-M5-14', dte?.some((d) => d.tipo === 39), 'con boleta electrónica (simulada)');
  const stock = async (id) => (await servicio.from('stock_ubicaciones').select('ubicacion, quantity').eq('product_id', id)).data
    .reduce((a, r) => ({ ...a, [r.ubicacion]: Number(r.quantity) }), {});
  const sPan = await stock(idPan);
  const sQueso = await stock(idQueso);
  ok('RF-M4-01', sPan.sala === 8 && sPan.bodega === 5, 'el pan queda en 8 a la vista y 5 en bodega', JSON.stringify(sPan));
  ok('RF-M4-01', Math.abs(sQueso.sala - 3.15) < 1e-9, 'el queso queda en 3,15 kg', JSON.stringify(sQueso));
  const { data: lote } = await servicio.from('product_lots').select('quantity').eq('product_id', idPan).single();
  ok('RF-M4-17', Number(lote.quantity) === 13, 'la venta salió del lote inicial (FEFO): quedan 13', lote.quantity);

  await c.getByRole('button', { name: 'Nueva venta' }).click();
  await c.goto(`${BASE}/caja`);
  await c.goto(`${BASE}/pos`);
  await c.getByLabel('Buscar por nombre o código').waitFor();
  await c.waitForTimeout(1500);
  ok('hallazgo 5', (await c.locator('.sticky.bottom-0').count()) === 0, 'cobrada la venta, el POS vuelve vacío (no revive la anterior)');
});

await paso('Regla 18 · la venta a medias guardada en la pestaña tiene dueño', async () => {
  await c.evaluate(([id]) => sessionStorage.setItem('pos:carro', JSON.stringify({
    usuario: 'otra-persona', clienteId: null,
    lineas: [{ productId: id, name: 'ajeno', unitPrice: 300, quantity: 5, unidad: 'unidad' }],
  })), [idPan]);
  await c.reload();
  await c.getByLabel('Buscar por nombre o código').waitFor();
  await c.waitForTimeout(1500);
  ok('regla 18', (await c.locator('.sticky.bottom-0').count()) === 0
    && (await c.evaluate(() => sessionStorage.getItem('pos:carro'))) === null,
    'un carrito guardado por otra persona no aparece, y se borra');
});

// ---------------------------------------------------------------- cierre
await paso('Cierre de caja · esperado, faltante y explicación', async () => {
  await c.goto(`${BASE}/caja`);
  const main = c.locator('main');
  await main.getByText(/17\.097/).first().waitFor({ timeout: ESPERA });
  ok('RF-M6-04', true, 'espera $17.097: $10.000 iniciales + $7.097 de la venta');
  await c.getByRole('button', { name: 'Cerrar caja' }).click();
  await c.fill('#contado', '16.997');
  const cerrar = c.getByRole('button', { name: 'Cerrar caja' }).last();
  ok('RF-M6-06', /Faltante[\s\S]*\$100/.test(await main.innerText()) && await cerrar.isDisabled(),
    'con $100 de menos muestra el faltante y no deja cerrar sin explicar');
  await c.fill('#nota', 'Recorrido de QA: faltan $100 a propósito');
  await foto(c, 'cierre');
  await cerrar.click();
  await main.getByRole('heading', { name: 'Abrir caja' }).waitFor({ timeout: ESPERA });
  const { data: s } = await servicio.from('cash_sessions').select('status, expected_amount, counted_amount, difference')
    .eq('user_id', cajero.id).order('opened_at', { ascending: false }).limit(1).single();
  ok('RF-M6-05', s.status === 'cerrada' && s.expected_amount === 17097 && s.counted_amount === 16997 && s.difference === -100,
    'la caja queda cerrada: esperado $17.097, contado $16.997, diferencia −$100', JSON.stringify(s));
});

console.log(`\nErrores de JavaScript o HTTP: ${errores.length ? [...new Set(errores)].join(' | ') : 'ninguno'}`);
ok('RNF', errores.length === 0, 'sin errores de JavaScript ni respuestas 4xx/5xx');
await nav.close();
for (const id of [idPan, idQueso].filter(Boolean)) await admin.cli.from('products').update({ is_active: false }).eq('id', id);
await cerrarSiAbierta(cajero);
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-flujo-completo.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
