/**
 * Recorrido de la app con un navegador real (Edge instalado, sin descargas).
 * Hace lo que haría una persona y registra lo que pasa y cuánto tarda.
 *
 *   node tools/ui/recorrido.mjs [url]   (por omisión http://localhost:3001)
 */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://localhost:3001';
const CORREO = process.env.QA_CORREO ?? 'admin@gmail.com';
const CLAVE = process.env.QA_CLAVE ?? 'admin123';

const navegador = await chromium.launch({ channel: 'msedge', headless: true });
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(`JS: ${e.message}`));
pagina.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errores.push(`consola: ${m.text().slice(0, 200)}`); });
pagina.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errores.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

const t0 = () => performance.now();
const ms = (a) => `${Math.round(performance.now() - a)} ms`;

async function entrar() {
  await pagina.goto(`${BASE}/login`);
  await pagina.fill('#email', CORREO);
  await pagina.fill('#password', CLAVE);
  const a = t0();
  await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), pagina.click('button[type=submit]')]);
  console.log(`  entrar: ${ms(a)} → ${new URL(pagina.url()).pathname}`);
}

async function salir() {
  await pagina.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await pagina.waitForURL('**/login', { timeout: 20000 });
  console.log('  salir: ok');
}

async function estadoCaja() {
  await pagina.goto(`${BASE}/caja`);
  const abrir = await pagina.getByRole('heading', { name: 'Abrir caja' }).count();
  return abrir ? 'CERRADA (pide abrir)' : 'ABIERTA';
}

async function navegarPorMenu(nombres) {
  for (const n of nombres) {
    const enlace = pagina.locator('nav a', { hasText: n }).first();
    if (!(await enlace.count())) { console.log(`  ${n}: no está en el menú`); continue; }
    const destino = await enlace.getAttribute('href');
    if (new URL(pagina.url()).pathname === destino) continue;
    const a = t0();
    await enlace.click();
    // Terminó cuando la URL cambió y el contenido nuevo está pintado, no
    // cuando el clic se registró.
    await pagina.waitForURL((u) => u.pathname === destino, { timeout: 30000 });
    await pagina.locator('main').first().waitFor({ state: 'visible' });
    await pagina.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30000 }).catch(() => {});
    console.log(`  → ${n.padEnd(12)} ${ms(a)}`);
  }
}

console.log('1. Entrar');
await entrar();
console.log(`2. Caja al entrar: ${await estadoCaja()}`);
console.log('3. Salir y volver a entrar');
await salir();
await entrar();
console.log(`4. Caja después de salir y entrar: ${await estadoCaja()}`);
console.log('5. Moverse por el menú (dos vueltas: la segunda ya tiene todo cargado)');
const menu = ['Inicio', 'Vender', 'Caja', 'Productos', 'Inventario', 'Ventas', 'Reportes'];
await navegarPorMenu(menu);
await navegarPorMenu(menu);
console.log('6. Vender');
await pagina.goto(`${BASE}/pos`);
const texto = await pagina.locator('main').innerText().catch(() => '');
console.log(`  POS dice caja abierta: ${!/abre (la )?caja|caja no est[aá] abierta/i.test(texto)}`);

console.log('7. Cerrar y volver a abrir la caja desde la pantalla, como una persona');
if ((await estadoCaja()) === 'ABIERTA') {
  await pagina.getByRole('button', { name: 'Cerrar caja' }).first().click();
  await pagina.fill('#contado', '10000');
  if (await pagina.locator('#nota').count()) await pagina.fill('#nota', 'Recorrido de QA');
  await pagina.getByRole('button', { name: 'Cerrar caja' }).last().click();
  await pagina.waitForTimeout(2500);
  const alerta = await pagina.locator('[role=alert]').allInnerTexts();
  console.log(`  cerrar: ${alerta.length ? 'ERROR ' + alerta.join(' | ') : 'ok'}`);
}
console.log(`  caja después de cerrar: ${await estadoCaja()}`);
await pagina.fill('#inicial', '10.000');
const a7 = t0();
await pagina.getByRole('button', { name: 'Abrir caja' }).click();
await pagina.getByRole('heading', { name: 'Abrir caja' }).waitFor({ state: 'detached', timeout: 15000 })
  .then(() => console.log(`  abrir: ok en ${ms(a7)}`))
  .catch(async () => console.log(`  abrir: NO SE ABRIÓ · ${(await pagina.locator('[role=alert]').allInnerTexts()).join(' | ') || 'sin mensaje en pantalla'}`));
await salir();
await entrar();
console.log(`  caja después de salir y entrar: ${await estadoCaja()}`);

console.log(`\nErrores vistos (${errores.length}):`);
for (const e of [...new Set(errores)].slice(0, 20)) console.log(`  · ${e}`);
await navegador.close();
