/**
 * Recorrido del MODO DEMO de 0036 (descuento autorizado con PIN), a 360 px:
 *   RA_BASE=http://localhost:3005 node tools/ui/demo-descuento.mjs
 *
 * El administrador crea su PIN en Mi cuenta; el vendedor (tope 0 %) hace un
 * descuento a una línea, el administrador lo autoriza con su PIN en ese mismo
 * celular, y la autorización no sirve para la venta siguiente.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.RA_BASE ?? 'http://localhost:3005';
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const ctx = await nav.newContext({ viewport: { width: 360, height: 780 } });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message.slice(0, 150)));
let ok = 0, mal = 0;
const check = (cond, t) => { cond ? ok++ : mal++; console.log(cond ? '✔' : '✖', t); };
const rol = (r) => ctx.addCookies([{ name: 'demo_rol', value: r, url: BASE }]);
const ir = async (ruta) => { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); };
const dialogo = () => p.getByRole('dialog').last();
// La caja de la maqueta vive en una cookie: abierta para el vendedor.
await ctx.addCookies([{ name: 'demo_caja', url: BASE, value: encodeURIComponent(JSON.stringify({
  usuario: 'demo-vendedor', abierta: true, id: `caja-${Date.now()}`, apertura: 20000, abiertaEn: new Date().toISOString(),
  ventas: { n: 0, total: 0, porMedio: {}, redondeo: 0 }, movs: [], abonos: 0, cierres: [] })) }]);

// ------------------------------------------------------------ 1. PIN
await rol('admin');
await ir('/cuenta');
check((await p.locator('main').innerText()).includes('PIN para autorizar descuentos'), 'Mi cuenta del administrador ofrece el PIN');
await p.getByLabel('PIN nuevo').fill('4821');
await p.getByLabel('Repítelo').fill('4812');
await p.getByRole('button', { name: 'Guardar PIN' }).click();
check((await p.locator('main').innerText()).includes('no coinciden'), 'dos PIN distintos no se guardan');
await p.getByLabel('Repítelo').fill('4821');
await p.getByRole('button', { name: 'Guardar PIN' }).click();
await p.waitForTimeout(500);
check((await p.locator('main').innerText()).includes('PIN guardado'), 'PIN guardado');
await rol('vendedor');
await ir('/cuenta');
check(!(await p.locator('main').innerText()).includes('PIN para autorizar'), 'el vendedor no tiene PIN de autorización');

// ------------------------------------------------------------ 2. descuento
async function venderConDescuento() {
  await ir('/pos');
  await p.fill('input[type=search]', 'Arroz'); await p.waitForTimeout(700);
  await p.locator('main li button', { hasText: 'Arroz' }).first().click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Descuento a Arroz/ }).click();
  await dialogo().getByLabel(/Cuánto se descuenta/).fill('159');
  await dialogo().getByRole('button', { name: 'Aplicar descuento' }).click();
  await p.waitForTimeout(300);
}
await venderConDescuento();
const t = await p.locator('main').innerText();
check(t.includes('Descuento -$159') && t.includes('$1.431'), 'la línea dice "Descuento -$159" y el total baja a $1.431');
check(await p.getByRole('button', { name: 'Pedir autorización y cobrar' }).count() === 1, 'con tope 0 %, el botón pide autorización');
await p.getByRole('button', { name: 'Pedir autorización y cobrar' }).click();
const d = dialogo();
await d.getByRole('radio', { name: /Felipe Vera/ }).waitFor({ timeout: 10000 }).catch(() => {});
check((await d.innerText()).includes('Felipe Vera'), 'aparece quién puede autorizar');
await d.getByLabel('PIN de quien autoriza').fill('0000');
await d.getByRole('button', { name: /Autorizar .* y cobrar/ }).click();
await p.waitForTimeout(500);
check((await d.innerText()).includes('PIN incorrecto'), 'un PIN malo no autoriza');
await d.getByLabel('PIN de quien autoriza').fill('4821');
await d.getByRole('button', { name: /Autorizar 10 % y cobrar/ }).click();
await p.waitForTimeout(800);
check(await p.locator('#recibido').count() === 1, 'con el PIN correcto se abre el cobro');
await p.fill('#recibido', '2000');
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.locator('#ticket').waitFor({ timeout: 15000 }).catch(() => {});
check(/1\.431/.test(await p.locator('#ticket').innerText().catch(() => '')), 'la venta sale con el descuento ($1.431)');
await p.getByRole('button', { name: 'Nueva venta' }).click().catch(() => {});

await venderConDescuento();
check(await p.getByRole('button', { name: 'Pedir autorización y cobrar' }).count() === 1,
  'la venta siguiente vuelve a pedir autorización: era de un solo uso');

console.log(`\n${ok}/${ok + mal}${errores.length ? ` · errores JS: ${errores.join(' | ')}` : ' · sin errores de JavaScript'}`);
await nav.close();
process.exit(mal ? 1 : 0);
