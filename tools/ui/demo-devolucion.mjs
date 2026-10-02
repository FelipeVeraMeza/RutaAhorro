/**
 * Recorrido del MODO DEMO, 2026-10-01 (tarde), a 360 px:
 *   RA_BASE=http://localhost:3005 node tools/ui/demo-devolucion.mjs
 *
 *  1. Devolver a proveedor (RQ-35, 0035): desde Compras, con motivo, sale de
 *     la bodega y queda en el kardex y en el historial.
 *  2. Reportes: la utilidad es sin IVA (0033).
 *  3. Ventas en la maqueta: no ofrece "Devolver productos" vacío.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.RA_BASE ?? 'http://localhost:3005';
const SP = new URL('./.capturas/demo-0035', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
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
const desborda = () => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

await p.goto(BASE + '/login', { waitUntil: 'networkidle' });
await p.fill('#email', 'admin@demo.cl');
await p.fill('#password', 'demo1234');
await p.click('button[type=submit]');
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {});
await p.waitForLoadState('networkidle'); await p.waitForTimeout(2000);

const stockArroz = async () => {
  await p.goto(BASE + '/inventario', { waitUntil: 'networkidle' });
  await p.fill('input[type=search]', 'Arroz'); await p.waitForTimeout(800);
  return Number(((await main()).match(/En bodega (\d+)/) ?? [])[1]);
};
const antes = await stockArroz();

// ------------------------------------------------------------ 1. devolver
await p.goto(BASE + '/proveedores', { waitUntil: 'networkidle' });
await p.getByRole('link', { name: 'Devolver' }).click();
await p.waitForURL((u) => u.pathname === '/proveedores/devolucion', { timeout: 15000 });
check((await p.locator('main h1').innerText()).includes('Devolver a proveedor'), 'Compras → "Devolver" abre la devolución');
await p.selectOption('#prov', { label: 'Distribuidora Sur Ltda.' });
await p.getByRole('button', { name: 'Dañado' }).click();
await p.fill('#doc', 'GD-77');
await p.fill('input[type=search]', 'Arroz'); await p.waitForTimeout(800);
await p.locator('main li button', { hasText: 'Arroz' }).first().click();
const cant = p.getByLabel(/Cantidad a devolver de Arroz/);
await cant.fill(String(antes + 1));
await p.waitForTimeout(200);
check(await p.getByRole('button', { name: /Devolver 1 producto/ }).isDisabled(), 'no deja devolver más de lo que hay en bodega');
await cant.fill('2');
check((await main()).includes('Valor al costo: $2.200'), 'el administrador ve el valor al costo: 2 × $1.100');
check(!(await desborda()), 'no se desborda a 360 px');
await foto('1-devolucion');
await p.getByRole('button', { name: /Devolver 1 producto/ }).click();
await p.waitForTimeout(1500);
const t = await main();
check(/Devolución a Distribuidora Sur Ltda\. registrada/.test(t), 'confirma la devolución');
check(/GD-77/.test(t) && /Dañado/.test(t), 'queda en "Últimas devoluciones" con su documento y motivo');
await foto('2-hecha');

const despues = await stockArroz();
check(despues === antes - 2, `la bodega bajó de ${antes} a ${despues}`);
await p.getByRole('tab', { name: 'Movimientos' }).click(); await p.waitForTimeout(600);
check((await main()).includes('Devolución a proveedor'), 'el kardex dice "Devolución a proveedor"');

// ------------------------------------------------------------ 2. reportes
await p.goto(BASE + '/reportes?vista=productos', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
const r = await main();
check(/Utilidad \(sin IVA\)/.test(r) || /utilidad_sin_iva/.test(r) || /util\./.test(r), 'Reportes muestra la utilidad');
// Arroz: $1.590 con IVA = $1.336 neto; costo $1.100 → 17,7 %. Con IVA mostraba 31 %.
check(/Arroz[^\n]*\n[^\n]*margen 18 %/.test(r) || /margen 18 %/.test(r), 'el margen del arroz es sobre el neto: 18 % (antes 31 %)');
await foto('3-reportes');

// ------------------------------------------------------------ 3. ventas
await p.goto(BASE + '/ventas', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.locator('main li button').first().click(); await p.waitForTimeout(600);
const v = await p.locator('[role=dialog]').last().innerText().catch(() => '');
check(await p.locator('[role=dialog]').last().getByRole('button', { name: 'Devolver productos' }).count() === 0,
  'la maqueta no ofrece el botón "Devolver productos" (abría vacío)');
check(/modo de prueba las devoluciones no se hacen/.test(v), 'y dice por qué');

console.log(`\n${ok}/${ok + mal}${errores.length ? ` · errores JS: ${errores.join(' | ')}` : ' · sin errores de JavaScript'}`);
await nav.close();
process.exit(mal ? 1 : 0);
