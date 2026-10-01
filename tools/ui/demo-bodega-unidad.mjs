/**
 * Recorrido del MODO DEMO de 0032 (2026-10-01), a 360 px:
 *   RA_BASE=http://localhost:3005 node tools/ui/demo-bodega-unidad.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 *
 * Lo que pidió Felipe ese día, de punta a punta:
 *  1. Producto: sin unidad (todo por unidad), una sola cantidad "en la
 *     bodega", perecible con stock pide la fecha y dice cuántos días le
 *     quedan, y el precio por mayor se pone en el producto.
 *  2. Inventario: sin "Qué reponer" ni sala/bodega.
 *  3. Vender: con 2 no hay precio por mayor y avisa desde cuántas; con 3, sí.
 *     El botón del cliente ya no habla de "precio mayorista".
 *  4. Recibir mercadería: producto y proveedor nuevos ahí mismo, costos netos,
 *     total del papel que cuadra, pago con efectivo de la caja (sale de la
 *     caja) y la factura en el libro de compras.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.RA_BASE ?? 'http://localhost:3005';
const SP = new URL('./.capturas/demo-0032', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
mkdirSync(SP, { recursive: true });
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const ctx = await nav.newContext({ viewport: { width: 360, height: 780 } });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message.slice(0, 150)));
let ok = 0, mal = 0;
const check = (cond, t) => { cond ? ok++ : mal++; console.log(cond ? '✔' : '✖', t); };
const main = async () => (await p.locator('main').innerText().catch(() => ''));
const foto = (n) => p.screenshot({ path: `${SP}/${n}.png`, fullPage: true }).catch(() => {});
const sufijo = Math.random().toString(16).slice(2, 6);
const hoyMas = (d) => { const f = new Date(); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10); };

async function entrar(correo, clave) {
  await p.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await p.fill('#email', correo);
  await p.fill('#password', clave);
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {});
  await p.waitForLoadState('networkidle'); await p.waitForTimeout(2000);
}

await entrar('admin@demo.cl', 'demo1234');

// ------------------------------------------------------------ 1. producto
const nombre = `Papas QA ${sufijo}`;
await p.goto(BASE + '/productos', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /Nuevo producto/ }).first().click();
const modal = p.locator('[role=dialog]').last();
await modal.waitFor();
check(await modal.getByLabel(/^Unidad/).count() === 0, 'el formulario ya no pregunta la unidad');
check(!(await modal.innerText()).includes('a la vista'), 'el formulario no habla de "a la vista"');
check(!(await modal.innerText()).includes('días antes'), 'no pregunta "cuántos días antes avisar"');
await modal.getByPlaceholder('Ej: Arroz grado 1 · 1 kg').fill(nombre);
await modal.getByLabel(/^Precio de venta/).fill('1000');
const perecible = modal.getByRole('checkbox', { name: /Producto perecible/ });
if (!(await perecible.isChecked())) await perecible.check();
await modal.getByLabel(/Cuántos tienes hoy en la bodega/).fill('5');
await modal.getByRole('button', { name: 'Crear producto' }).click();
await p.waitForTimeout(600);
check((await modal.innerText()).includes('Falta la fecha de vencimiento'), 'perecible con stock y sin fecha no se guarda');
await modal.getByLabel(/Cuándo vence/).fill(hoyMas(10));
await p.waitForTimeout(300);
check((await modal.innerText()).includes('vence en 10 días'), 'dice cuántos días le quedan (10)');
// Precio por mayor: desde 3 a $800.
await modal.getByText(/Precio por mayor, ofertas e impuesto/).click();
await modal.getByRole('button', { name: /Agregar oferta/ }).click();
await modal.getByLabel('Oferta 1: desde cuántas unidades').fill('3');
await modal.getByLabel('Oferta 1: precio de cada unidad').fill('800');
await foto('1-producto');
await modal.getByRole('button', { name: 'Crear producto' }).click();
await p.waitForTimeout(1500);
check(await p.locator('[role=dialog]').count() === 0, 'producto creado');
check((await main()).includes('en bodega'), `el aviso dice "en bodega" (${(await main()).match(/creado[^.\n]*/)?.[0] ?? ''})`);

// ------------------------------------------------------------ 2. inventario
await p.goto(BASE + '/inventario', { waitUntil: 'networkidle' });
const pestanas = await p.locator('[role=tablist]').innerText();
check(!/reponer/i.test(pestanas), 'Inventario sin "Qué reponer"');
await p.fill('input[type=search]', nombre); await p.waitForTimeout(800);
const inv = await main();
check(inv.includes('En bodega 5') && !/a la vista/i.test(inv), 'Inventario dice "En bodega 5", sin "a la vista"');
await foto('2-inventario');

// ------------------------------------------------------------ 3. vender
await p.goto(BASE + '/caja', { waitUntil: 'networkidle' });
if (await p.locator('#inicial').count()) {
  await p.fill('#inicial', '20000');
  await p.getByRole('button', { name: 'Abrir caja' }).click();
  await p.waitForTimeout(1500);
}
await p.goto(BASE + '/pos', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
check((await main()).includes('para factura o fiado') && !/precio mayorista/i.test(await main()),
  'el botón del cliente dice "para factura o fiado"');
await p.fill('input[type=search]', nombre); await p.waitForTimeout(900);
await p.locator('ul button', { hasText: nombre }).first().click();
const cant = p.getByLabel(new RegExp(`Cantidad de ${nombre}`));
await cant.click(); await cant.fill('2'); await cant.press('Enter'); await p.waitForTimeout(500);
let pos = await main();
check(/Por mayor desde 3: llevando 1 más/.test(pos), 'con 2 avisa "Por mayor desde 3: llevando 1 más"');
check(!/Precio por mayor \(desde/.test(pos), 'con 2 no cobra precio por mayor');
await cant.click(); await cant.fill('3'); await cant.press('Enter'); await p.waitForTimeout(500);
pos = await main();
check(/Precio por mayor \(desde 3\)/.test(pos), 'con 3 aplica "Precio por mayor (desde 3)"');
check(pos.includes('$2.400'), 'con 3 el total es $2.400 (3 × $800)');
await foto('3-vender');
await p.getByRole('button', { name: /Vaciar/ }).first().click().catch(() => {});
p.once('dialog', (d) => d.accept());

// ------------------------------------------------------------ 4. recibir
const jalea = `Jalea con azúcar QA ${sufijo}`;
await p.goto(BASE + '/proveedores/recepcion', { waitUntil: 'networkidle' });
// Proveedor nuevo ahí mismo
await p.getByRole('button', { name: '+ Nuevo' }).click();
const mp = p.locator('[role=dialog]').last();
await mp.getByLabel(/Nombre o razón social/).fill(`Dulces del Sur ${sufijo}`);
await mp.getByLabel(/^RUT/).fill('76.086.428-5');
await mp.getByRole('button', { name: 'Crear proveedor' }).click();
await p.waitForTimeout(1200);
check((await p.locator('#prov option:checked').innerText()).includes('Dulces del Sur'), 'el proveedor nuevo queda elegido');
await p.selectOption('#tipo', 'factura');
await p.fill('#num', String(9000 + Math.floor(Math.random() * 999)));
// Producto nuevo ahí mismo, desde la búsqueda
await p.fill('input[type=search]', jalea); await p.waitForTimeout(1200);
await p.getByRole('button', { name: new RegExp(`Crear «${jalea}» como producto nuevo`) }).click();
const mj = p.locator('[role=dialog]').last();
check((await mj.getByPlaceholder('Ej: Arroz grado 1 · 1 kg').inputValue()) === jalea, 'el formulario trae el nombre buscado');
check(await mj.getByLabel(/Cuántos tienes hoy/).count() === 0, 'desde la recepción no pregunta stock');
await mj.getByLabel(/^Precio de venta/).fill('2490');
await mj.getByRole('button', { name: 'Crear y agregar' }).click();
await p.waitForTimeout(1500);
check(await p.getByLabel(`Cantidad recibida de ${jalea}`).count() === 1, 'la jalea quedó como línea de la recepción');
await p.getByLabel(`Cantidad recibida de ${jalea}`).fill('3');
await p.getByLabel(`Costo unitario de ${jalea}`).fill('1000');
await p.getByLabel(`Fecha de vencimiento de ${jalea} (obligatoria)`).fill(hoyMas(30));
await p.waitForTimeout(300);
check((await main()).includes('vence en 30 días'), 'la línea dice "vence en 30 días"');
// 3 × $1.000 neto = $3.000 + IVA $570 = $3.570
await p.fill('#total-doc', '3570'); await p.waitForTimeout(300);
check((await main()).includes('Cuadra con lo anotado'), 'el total del papel ($3.570) cuadra');
await p.fill('#total-doc', '3600'); await p.waitForTimeout(300);
check((await main()).includes('No cuadra'), 'un total distinto ($3.600) avisa que no cuadra');
await p.fill('#total-doc', '3570');
await p.getByRole('radio', { name: /Efectivo de la caja/ }).click();
await foto('4-recepcion');
await p.getByRole('button', { name: /Confirmar recepción/ }).click();
await p.waitForURL((u) => u.pathname === '/proveedores', { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1500);
const aviso = await main();
check(aviso.includes('Mercadería recibida'), 'recibida');
check(aviso.includes('salida de $3.570 de tu caja'), 'el pago salió de la caja por el total con IVA');
check(aviso.includes('libro de compras'), `menciona el libro de compras (${aviso.match(/Mercadería recibida[^\n]*/)?.[0] ?? ''})`);
await foto('5-compras');

await p.goto(BASE + '/caja', { waitUntil: 'networkidle' });
check((await main()).includes('Pago factura N°'), 'la caja muestra el egreso "Pago factura N°"');
await p.goto(BASE + '/inventario', { waitUntil: 'networkidle' });
await p.fill('input[type=search]', jalea); await p.waitForTimeout(800);
check((await main()).includes('En bodega 3'), 'la jalea quedó con 3 en bodega');

console.log(`\n${ok}/${ok + mal}${errores.length ? ` · errores JS: ${errores.join(' | ')}` : ' · sin errores de JavaScript'}`);
await nav.close();
process.exit(mal ? 1 : 0);
