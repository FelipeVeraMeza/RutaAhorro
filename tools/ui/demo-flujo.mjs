/**
 * Recorrido del MODO DEMO (NEXT_PUBLIC_DEMO=true, `npm run dev`), 2026-09-30.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-flujo.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 */
// Demo, a 360 px: ingreso real del vendedor → vender → Mis ventas → caja (movimiento, cierre) → POS pide abrir → abrir → salir.
// Después: admin crea una cuenta nueva de vendedor con clave temporal y se entra con ella.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
const SP = new URL('./.capturas/demo', import.meta.url).pathname;
mkdirSync(SP, { recursive: true });
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const ctx = await nav.newContext({ viewport: { width: 360, height: 780 } });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message.slice(0, 150)));
let ok = 0, mal = 0;
const check = (cond, t) => { cond ? ok++ : mal++; console.log(cond ? '✔' : '✖', t); };
const h1 = async () => (await p.locator('main h1').first().innerText().catch(() => '')).trim();

async function entrar(correo, clave) {
  await p.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await p.fill('#email', correo);
  await p.fill('#password', clave);
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {});
  await p.waitForLoadState('networkidle'); await p.waitForTimeout(2500);
}

// 0. sin sesión → login
await p.goto(BASE + '/caja', { waitUntil: 'networkidle' });
check(new URL(p.url()).pathname === '/login', 'sin sesión, /caja manda a /login');
await p.fill('#email', 'vendedor@demo.cl'); await p.fill('#password', 'mala');
await p.click('button[type=submit]'); await p.waitForTimeout(2500);
check((await p.locator('main [role=alert], form [role=alert]').first().innerText().catch(() => '')).includes('incorrectos'), 'clave mala avisa');

// 1. ingreso real del vendedor
await entrar('vendedor@demo.cl', 'demo1234');
check(new URL(p.url()).pathname === '/pos', `vendedor entra al POS (${new URL(p.url()).pathname})`);
await p.screenshot({ path: SP + '/v-pos.png' });

// 2. vender 2 arroz en efectivo
await p.fill('input[type=search]', 'arroz'); await p.waitForTimeout(700);
await p.locator('ul button', { hasText: 'Arroz' }).first().click();
const cant = p.getByLabel(/Cantidad de Arroz/); await cant.click(); await cant.fill('2'); await cant.press('Enter');
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.fill('#recibido', '5000');
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.waitForTimeout(1500);
check((await p.locator('body').innerText()).includes('Venta registrada'), 'venta registrada');
await p.keyboard.press('Escape');

// 3. Mis ventas
await p.goto(BASE + '/ventas', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
const tv = await p.locator('main').innerText();
check((await h1()) === 'Mis ventas', 'vendedor ve "Mis ventas"');
check(/Cobrado por medio de pago/.test(tv) && /Efectivo/.test(tv), 'Mis ventas muestra medios de pago');
check(!/Anular esta venta/.test(tv), 'sin botón de anular');
await p.screenshot({ path: SP + '/v-ventas.png', fullPage: true });

// 4. caja: medios de pago, egreso, cierre
await p.goto(BASE + '/caja', { waitUntil: 'networkidle' });
const tc = await p.locator('main').innerText();
check(/Cobrado por medio de pago/.test(tc), 'caja muestra medios de pago');
await p.getByRole('button', { name: '− Egreso' }).click();
await p.getByLabel(/Monto que sale/).fill('2000');
await p.getByLabel(/Motivo/).fill('Bolsas');
await p.getByRole('button', { name: /Registrar egreso/ }).click();
await p.waitForTimeout(1500);
check((await p.locator('main').innerText()).includes('Bolsas'), 'egreso registrado en demo');
await p.getByRole('button', { name: 'Cerrar caja' }).first().click();
await p.fill('#contado', '100000');
if (await p.locator('#nota').count()) await p.fill('#nota', 'prueba QA');
await p.getByRole('button', { name: 'Cerrar caja' }).last().click();
await p.waitForTimeout(2000);
check((await h1()) === 'Abrir caja', `caja cerrada en demo (h1=${await h1()})`);
await p.screenshot({ path: SP + '/v-caja-cerrada.png', fullPage: true });

// 5. POS pide abrir caja; abrir
await p.goto(BASE + '/pos', { waitUntil: 'networkidle' });
check((await p.locator('main').innerText()).includes('Abre tu caja'), 'POS pide abrir caja');
await p.goto(BASE + '/caja', { waitUntil: 'networkidle' });
await p.fill('#inicial', '20000');
await p.getByRole('button', { name: 'Abrir caja' }).click();
await p.waitForTimeout(2000);
check((await h1()) === 'Caja abierta', 'caja reabierta');

/** Salir, pasando el aviso de caja abierta si aparece. */
async function salir() {
  await p.getByRole('button', { name: 'Salir' }).click();
  const igual = p.getByRole('button', { name: 'Salir igual (sigo después)' });
  await igual.waitFor({ timeout: 2500 }).then(() => igual.click(), () => {});
  await p.waitForURL('**/login').catch(() => {});
}

// 6. salir: con la caja abierta, avisa antes (RF-M8-08)
await p.getByRole('button', { name: 'Salir' }).click();
await p.waitForTimeout(800);
check(/Tu caja sigue abierta/.test(await p.locator('body').innerText()), 'salir con la caja abierta avisa');
await p.getByRole('button', { name: 'Salir igual (sigo después)' }).click();
await p.waitForURL('**/login', { timeout: 15000 }).catch(() => {});
check(new URL(p.url()).pathname === '/login', 'Salir vuelve a /login');

// 7. bodega entra a inventario
await entrar('bodega@demo.cl', 'demo1234');
check(new URL(p.url()).pathname === '/inventario', `bodega entra a Inventario (${new URL(p.url()).pathname})`);
await salir();

// 8. admin crea cuenta con clave temporal
await entrar('admin@demo.cl', 'demo1234');
check(new URL(p.url()).pathname === '/', 'admin entra al Inicio');
await p.goto(BASE + '/usuarios', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Crear cuenta' }).click();
await p.getByLabel(/^Nombre/).fill('Ana Cajera');
await p.getByLabel(/^Correo/).fill('ana@demo.cl');
await p.getByLabel(/Contraseña temporal/).fill('ana12345');
await p.getByRole('button', { name: 'Crear cuenta' }).last().click();
await p.waitForTimeout(1200);
const tu = await p.locator('main').innerText();
check(/Cuenta de Ana Cajera creada/.test(tu) && tu.includes('ana12345'), 'admin ve las credenciales de la cuenta nueva');
await p.screenshot({ path: SP + '/a-usuarios.png', fullPage: true });
await salir();
await entrar('ana@demo.cl', 'ana12345');
check(new URL(p.url()).pathname === '/pos', 'la cuenta nueva entra al POS');
check((await p.locator('body').innerText()).includes('Ana Cajera'), 'con su nombre');

console.log(`\n${ok}/${ok + mal}  errores JS: ${JSON.stringify(errores)}`);
await nav.close();
