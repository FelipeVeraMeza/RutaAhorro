/**
 * Recorrido del MODO DEMO (NEXT_PUBLIC_DEMO=true, `npm run dev`), 2026-09-30.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-datos.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 */
// Ingreso de datos en demo a 360 px: producto (código sin agregar, nombre repetido, precio de bodega), recepción (borrador, barra), inventario.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
// En Windows, pathname trae "/C:/...": sin la barra inicial, mkdir arma "C:C:...".
const SP = new URL('./.capturas/demo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(SP, { recursive: true });
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
let ok = 0, mal = 0;
const check = (c, t) => { c ? ok++ : mal++; console.log(c ? '✔' : '✖', t); };
const errores = [];

async function pagina(rol) {
  const ctx = await nav.newContext({ viewport: { width: 360, height: 780 } });
  await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol}: ${e.message.slice(0, 150)}`));
  return p;
}

// --- admin: producto nuevo
let p = await pagina('admin');
await p.goto(BASE + '/productos', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
await p.getByRole('button', { name: '🟠 Bajo' }).click();
await p.getByRole('button', { name: 'Nuevo producto' }).click();
await p.getByRole('textbox', { name: 'Nombre (obligatorio)' }).fill('Arroz grado 1 · 1 kg');
await p.getByLabel(/Precio de venta/).click();
await p.waitForTimeout(1200);
check((await p.locator('[role=dialog]').innerText()).includes('Ya hay un producto llamado'), 'avisa nombre repetido');
await p.getByRole('textbox', { name: 'Nombre (obligatorio)' }).fill('Galletas QA');
await p.getByLabel(/Precio de venta/).fill('1290');
await p.getByLabel(/Cuántos tienes hoy en la bodega/).fill('5');   // 0032: una sola bodega
await p.getByPlaceholder('Escribe o escanea').fill('7800000000017');
check((await p.locator('[role=dialog]').innerText()).includes('Falta la fecha'), 'avisa perecible sin fecha');
// 0032: con stock, la fecha es obligatoria y dice cuántos días le quedan.
await p.getByLabel(/Cuándo vence/).fill(new Date(Date.now() + 20 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }));
await p.getByRole('button', { name: 'Crear producto' }).click();
await p.waitForTimeout(1500);
const lista = await p.locator('main').innerText();
check(lista.includes('Galletas QA creado'), 'aviso de creado');
check(/Galletas QA/.test(lista.split('creado')[1] ?? ''), 'el nuevo se ve aunque había filtro "Bajo"');
await p.getByRole('button', { name: 'Editar' }).first().click();
await p.waitForTimeout(800);
check((await p.locator('[role=dialog]').innerText()).includes('7800000000017'), 'el código escrito sin "Agregar" quedó guardado');
await p.screenshot({ path: SP + '/d-editar.png', fullPage: true });
await p.context().close();

// --- bodega: no cambia precio, no ve Quitar
p = await pagina('bodega');
await p.goto(BASE + '/productos', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
check(await p.getByRole('button', { name: 'Quitar' }).count() === 0, 'bodega no ve "Quitar"');
await p.getByRole('button', { name: 'Editar' }).first().click(); await p.waitForTimeout(500);
check(await p.getByLabel(/Precio de venta/).getAttribute('readonly') !== null, 'bodega no puede cambiar el precio al editar');
await p.keyboard.press('Escape');

// --- bodega: recepción con borrador y barra visible
await p.goto(BASE + '/proveedores/recepcion', { waitUntil: 'networkidle' });
await p.getByPlaceholder('Buscar por nombre o SKU…').fill('leche'); await p.waitForTimeout(800);
await p.locator('main ul button').first().click(); await p.waitForTimeout(300);
const tapado = await p.evaluate(() => {
  const b = [...document.querySelectorAll('[data-acciones] button')].find((x) => x.textContent.includes('Confirmar'));
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !(b === el || b.contains(el));
});
check(!tapado, 'botón "Confirmar recepción" no queda tapado por la barra');
await p.screenshot({ path: SP + '/d-recepcion.png' });
await p.goto(BASE + '/inventario', { waitUntil: 'networkidle' });
await p.goto(BASE + '/proveedores/recepcion', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
check((await p.locator('main').innerText()).includes('Se recuperó la recepción'), 'la recepción a medio cargar se recupera');

// --- inventario: nombre completo y "Mover todo"
await p.goto(BASE + '/inventario', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
check((await p.locator('main').innerText()).includes('Aceite vegetal · 900 ml'), 'inventario muestra el nombre completo en 360 px');
// Reponer y "Mover todo" quedaron fuera el 2026-10-01: una sola bodega (0032).
check(await p.getByRole('button', { name: /^(Reponer|Mover)$/ }).count() === 0, 'Inventario sin "Reponer": una sola bodega');
await p.screenshot({ path: SP + '/d-inventario.png' });
await p.context().close();

console.log(`\n${ok}/${ok + mal}  errores JS: ${JSON.stringify(errores)}`);
await nav.close();
