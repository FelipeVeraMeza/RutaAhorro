/**
 * Recorrido del MODO DEMO, ronda 2 (2026-09-30). Cita los requerimientos que prueba.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-ronda2.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
// En Windows, pathname trae "/C:/...": sin la barra inicial, mkdir arma "C:C:...".
const SP = new URL('./.capturas/demo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(SP, { recursive: true });
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const resultados = [];
const errores = [];
const ok = (rf, cumple, texto) => { resultados.push({ rf, cumple: Boolean(cumple), texto }); console.log(cumple ? '✔' : '✖', rf, texto); };

async function pagina(rol, ancho = 360, alto = 780) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, acceptDownloads: true });
  await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol}: ${e.message.slice(0, 150)}`));
  return p;
}
const ir = async (p, ruta) => { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); };
const texto = (p) => p.locator('main').first().innerText();

// ---------------------------------------------------------------- admin
let p = await pagina('admin');
await ir(p, '/');
ok('RF-M7-10', await p.getByText('Últimos 30 días').count() === 1 && await p.locator('figure table tbody tr').count() === 30,
  'el Inicio muestra los últimos 30 días, día por día');
ok('RF-M7-11', /vs los 30 días anteriores/.test(await texto(p)), 'y los compara con los 30 anteriores');
await p.screenshot({ path: `${SP}/r2-inicio.png`, fullPage: true });

await ir(p, '/reportes');
ok('RF-M7-11', /vs \d{2}-\d{2} al \d{2}-\d{2}/.test(await texto(p)), 'Reportes de ventas compara con el período anterior');

await ir(p, '/novedades');
ok('RF-M9-09', /Versión instalada: \d+\.\d+\.\d+/.test(await texto(p)), 'Novedades dice la versión instalada');

await ir(p, '/proveedores?vista=comprar');
const tc = await texto(p);
ok('RF-M3-11', /Qué comprar/.test(tc) && /Pedir/.test(tc) && await p.getByRole('link', { name: 'Enviar por WhatsApp' }).count() === 1,
  'Qué comprar lista lo bajo el mínimo con cuánto pedir y lo manda por WhatsApp');
const wa = await p.getByRole('link', { name: 'Enviar por WhatsApp' }).getAttribute('href');
ok('RF-M3-11', decodeURIComponent(wa ?? '').includes('Pedido de'), 'el mensaje de WhatsApp lleva el pedido');

await ir(p, '/productos');
await p.getByRole('button', { name: 'Editar' }).first().click();
await p.getByRole('button', { name: 'Duplicar' }).click();
await p.waitForTimeout(400);
const dlg = await p.getByRole('dialog').innerText();
ok('RF-M2-15', dlg.includes('Nuevo producto (copia)') && dlg.includes('(copia)'), 'Duplicar abre un alta con los datos del producto');
await p.keyboard.press('Escape');

await ir(p, '/pos');
await p.fill('input[type=search]', '7809999999999');
await p.waitForTimeout(700);
const crear = p.getByRole('link', { name: /Crear el producto con este código/ });
ok('RF-M5-04', await crear.count() === 1, 'un código desconocido en Vender ofrece crear el producto');
await crear.click();
await p.waitForURL('**/productos**');
await p.waitForTimeout(1200);
const alta = await p.getByRole('dialog').innerText().catch(() => '');
ok('RF-M2-04', alta.includes('7809999999999'), 'el alta se abre con el código ya puesto');
await p.keyboard.press('Escape');

await ir(p, '/configuracion');
const [descarga] = await Promise.all([
  p.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  p.getByRole('button', { name: 'Descargar mis datos' }).click(),
]);
ok('RF-M9-03', descarga && /rutaahorro-datos-.*\.json$/.test(descarga.suggestedFilename()), 'Configuración descarga los datos del local en JSON');

await ir(p, '/esto-no-existe');
ok('RNF-40', /No encontramos esta página/.test(await p.locator('body').innerText()), 'una dirección que no existe muestra una página en castellano');

// Aviso al salir con ventas sin enviar (RF-M1-07): se deja una en la cola.
await ir(p, '/pos');
await p.evaluate(() => new Promise((ok) => {
  const r = indexedDB.open('rutaahorro');
  r.onsuccess = () => {
    const tx = r.result.transaction('saleQueue', 'readwrite');
    tx.objectStore('saleQueue').put({ clientUuid: 'qa-pendiente', status: 'pendiente', createdAt: new Date().toISOString(), userId: 'demo', items: [], payments: [], total: 0, attempts: 0 });
    tx.oncomplete = ok;
  };
}));
await p.getByRole('button', { name: 'Salir' }).click();
await p.waitForTimeout(600);
ok('RF-M1-07', /Hay ventas sin enviar/.test(await p.locator('body').innerText()), 'salir con ventas sin enviar avisa y ofrece enviarlas');
await p.getByRole('button', { name: 'Seguir trabajando' }).click();
ok('RF-M1-07', new URL(p.url()).pathname === '/pos', '"Seguir trabajando" no cierra la sesión');
await p.evaluate(() => new Promise((ok) => {
  const r = indexedDB.open('rutaahorro');
  r.onsuccess = () => { const tx = r.result.transaction('saleQueue', 'readwrite'); tx.objectStore('saleQueue').delete('qa-pendiente'); tx.oncomplete = ok; };
}));
await p.context().close();

// ---------------------------------------------------------------- vendedor
p = await pagina('vendedor');
await ir(p, '/pos');
await p.fill('input[type=search]', '7809999999999');
await p.waitForTimeout(700);
ok('RF-M5-04', await p.getByRole('link', { name: /Crear el producto/ }).count() === 0 && /pídele a un supervisor/i.test(await texto(p)),
  'el vendedor no crea productos: se le dice a quién pedírselo');
await p.context().close();

// ---------------------------------------------------------------- escritorio
p = await pagina('admin', 1280, 800);
await ir(p, '/productos');
const pie = await p.getByRole('link', { name: 'Novedades' }).first().boundingBox();
ok('RNF-12', pie && pie.y + pie.height <= 800, 'en escritorio el menú lateral entero cabe en 800 px de alto');
await p.screenshot({ path: `${SP}/r2-escritorio.png` });
await p.context().close();

writeFileSync(new URL('./.resultado-demo-ronda2.json', import.meta.url), JSON.stringify(resultados, null, 1));
const bien = resultados.filter((r) => r.cumple).length;
console.log(`\n${bien}/${resultados.length}  errores JS: ${JSON.stringify(errores)}`);
await nav.close();
process.exit(bien === resultados.length && errores.length === 0 ? 0 : 1);
