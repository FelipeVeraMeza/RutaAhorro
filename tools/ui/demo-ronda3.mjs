/**
 * Recorrido del MODO DEMO, ronda 3 (2026-09-30): los requerimientos de
 * docs/25. Cita los que prueba.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-ronda3.mjs
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
  if (rol) await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol}: ${e.message.slice(0, 150)}`));
  return p;
}
const ir = async (p, ruta) => { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); };
const texto = (p) => p.locator('main').first().innerText();
const desborda = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

// ---------------------------------------------------------------- login
let p = await pagina(null);
await ir(p, '/login');
await p.fill('#email', 'vendedor@demo.cl');
// Chromium sin pantalla no cambia el estado de Bloq Mayús con el teclado
// simulado: se manda la tecla con el modificador puesto, como la vería el navegador.
await p.locator('#password').dispatchEvent('keyup', { key: 'X', modifierCapsLock: true });
await p.waitForTimeout(200);
const mayus = await p.getByText('Las mayúsculas están activadas').count();
ok('RF-M1-16', mayus === 1, 'el login avisa cuando Bloq Mayús está activado');
for (let i = 0; i < 5; i++) {
  await p.fill('#password', `mala${i}`);
  await p.getByRole('button', { name: /Ingresar|Espera/ }).click();
  await p.waitForTimeout(250);
}
ok('RF-M1-17', await p.getByRole('button', { name: /Espera \d+ s/ }).isDisabled(), 'tras 5 intentos fallidos el botón pide esperar');
await p.context().close();

p = await pagina(null);
await ir(p, '/login');
await p.fill('#email', 'vendedor@demo.cl');
await p.fill('#password', 'demo1234');
await p.getByRole('button', { name: 'Ingresar' }).click();
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
await p.context().clearCookies();
await ir(p, '/login');
ok('RF-M1-18', await p.inputValue('#email') === 'vendedor@demo.cl', 'el celular recuerda el correo de quien entró');
await p.context().close();

// ---------------------------------------------------------------- admin
p = await pagina('admin');
await ir(p, '/');
const inicio = await texto(p);
ok('RF-M8-07', /Para revisar/.test(inicio), 'el Inicio junta lo que hay que revisar');
const wa = await p.getByRole('link', { name: 'Enviar el resumen de hoy por WhatsApp' }).getAttribute('href').catch(() => null);
ok('RF-M7-17', decodeURIComponent(wa ?? '').includes('Resumen de hoy'), 'el resumen del día sale por WhatsApp');

await ir(p, '/productos');
ok('RF-M2-16', await p.getByLabel(/Ordenar/).count() > 0, 'la lista de productos se puede ordenar');
const revisar = p.getByRole('button', { name: /Revisar datos|Datos completos/ });
ok('RF-M2-18', await revisar.count() === 1, 'Productos dice cuántos tienen datos incompletos');
const [csv] = await Promise.all([
  p.waitForEvent('download', { timeout: 10000 }).catch(() => null),
  p.getByRole('button', { name: /Exportar/ }).first().click(),
]);
ok('RF-M2-19', csv && /\.(csv|xlsx?)$/.test(csv.suggestedFilename()), 'el catálogo se exporta para Excel');
await p.fill('input[type=search]', 'azucar');
await p.waitForTimeout(900);
ok('RF-M2-20', /Azúcar/i.test(await texto(p)), '"azucar" sin tilde encuentra "Azúcar"');

await ir(p, '/productos/etiquetas');
ok('RF-M2-22', /Precio de góndola/.test(await texto(p)), 'Etiquetas ofrece el cartel de precio de góndola');

await ir(p, '/inventario');
// RF-M4-21 (reponer la sala) quedó fuera el 2026-10-01: una sola bodega (0032).
ok('0032', !/Qué reponer/.test(await texto(p)), 'Inventario sin "Qué reponer": una sola bodega');

await ir(p, '/reportes?vista=horas');
ok('RF-M7-13', /\b(0?9|10|11|12):00\b|Por hora/.test(await texto(p)), 'Reportes muestra las ventas por hora');
await ir(p, '/reportes?vista=control');
ok('RF-M7-15', /Anulaciones/.test(await texto(p)), 'Reportes controla anulaciones y devoluciones por persona');
await ir(p, '/reportes?vista=productos');
ok('RF-M7-14', /\bA\b/.test(await texto(p)) || /ABC/.test(await texto(p)), 'Reportes clasifica los productos en A, B y C');

await ir(p, '/productos');
await p.getByRole('button', { name: /^Cambiar el precio de/ }).first().click();
await p.waitForTimeout(400);
ok('RF-M2-17', /^Precio de /.test(await p.getByRole('dialog').locator('h2, h1').first().innerText().catch(() => '')),
  'tocar el precio abre el cambio rápido de precio');
await p.keyboard.press('Escape');

await ir(p, '/proveedores?vista=comprar');
ok('RF-M3-12', /Pedido para/.test(await texto(p)), 'Qué comprar arma el pedido de un proveedor');

await ir(p, '/inventario');
await p.getByRole('tab', { name: 'Toma de inventario' }).click();
await p.waitForTimeout(400);
ok('RF-M4-22', await p.getByRole('button', { name: /Imprimir hoja para contar/ }).count() === 1, 'la toma de inventario imprime una hoja para contar');
await p.getByRole('tab', { name: 'Lotes' }).click();
await p.waitForTimeout(400);
ok('RF-M4-23', await p.getByRole('link', { name: /Poner en oferta/ }).count() > 0, 'un lote por vencer se pone en oferta con un toque');

await ir(p, '/reportes');
const [detalle] = await Promise.all([
  p.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  p.getByRole('button', { name: /Exportar ventas línea por línea/ }).click(),
]);
ok('RF-M7-16', Boolean(detalle), 'Reportes exporta las ventas línea por línea para el contador');

await ir(p, '/ventas');
await p.locator('main li button').first().click();
await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Reimprimir o compartir el comprobante' }).click();
await p.waitForTimeout(500);
ok('RF-M5-23', /COPIA/.test(await p.getByRole('dialog').innerText().catch(() => '')), 'una venta pasada se reimprime marcada COPIA');
await p.keyboard.press('Escape');

const resp = await p.goto(BASE + '/precio', { waitUntil: 'networkidle' });
const h = resp?.headers() ?? {};
ok('RNF-60', /max-age=\d+/.test(h['strict-transport-security'] ?? '') && h['cross-origin-opener-policy'] === 'same-origin',
  'la app responde con HSTS y Cross-Origin-Opener-Policy');

await ir(p, '/bitacora');
ok('RF-M9-11', /Bitácora/.test(await texto(p)), 'el administrador lee la bitácora de quién hizo qué');

await ir(p, '/ayuda');
const guiasAdmin = await p.locator('main details').count();
ok('RF-M9-12', guiasAdmin >= 8, `Ayuda trae guías paso a paso (${guiasAdmin} para el administrador)`);

await ir(p, '/cuenta');
ok('RF-M9-14', /Tus datos/.test(await texto(p)) && await p.getByLabel('Bloquear la pantalla si nadie la usa').count() === 1,
  'Mi cuenta muestra los datos y las preferencias del celular');
await p.getByText('Grande', { exact: true }).click();
await p.waitForTimeout(300);
ok('RNF-59', await p.evaluate(() => document.documentElement.dataset.letra) === 'grande', 'letra grande se aplica al instante');
await p.reload({ waitUntil: 'networkidle' });
ok('RNF-59', await p.evaluate(() => document.documentElement.dataset.letra) === 'grande', 'y se mantiene al recargar');
// RNF-64 · letra grande en un celular angosto (equivale a 200 % de zoom en 640 px).
await p.setViewportSize({ width: 320, height: 700 });
const sinDesborde = [];
for (const ruta of ['/pos', '/caja', '/productos', '/cuenta']) {
  await ir(p, ruta);
  if (!(await desborda(p))) sinDesborde.push(ruta);
}
ok('RNF-64', sinDesborde.length === 4, `con letra grande y 320 px nada se sale de la pantalla (${sinDesborde.join(', ')})`);
await p.screenshot({ path: `${SP}/r3-letra-grande.png`, fullPage: true });
await ir(p, '/cuenta');
await p.getByText('Normal', { exact: true }).click();
await p.setViewportSize({ width: 360, height: 780 });

// Bloqueo por inactividad (RF-M1-19): se pone en 2 min y se adelanta el reloj.
await p.clock.install();
await ir(p, '/cuenta');
await p.getByLabel('Bloquear la pantalla si nadie la usa').selectOption('2');
await p.clock.fastForward('02:15');
await p.waitForTimeout(300);
ok('RF-M1-19', await p.getByRole('dialog', { name: 'Pantalla bloqueada' }).count() === 1, 'sin uso por 2 minutos la pantalla se bloquea');
await p.reload({ waitUntil: 'networkidle' });
ok('RF-M1-19', await p.getByRole('dialog', { name: 'Pantalla bloqueada' }).count() === 1, 'recargar no quita el bloqueo');
await p.fill('#clave-bloqueo', 'otra');
await p.getByRole('button', { name: 'Desbloquear' }).click();
await p.waitForTimeout(400);
ok('RF-M1-19', /Contraseña incorrecta/.test(await p.locator('body').innerText()), 'con otra contraseña no se desbloquea');
await p.fill('#clave-bloqueo', 'demo1234');
await p.getByRole('button', { name: 'Desbloquear' }).click();
await p.waitForTimeout(400);
ok('RF-M1-19', await p.getByRole('dialog', { name: 'Pantalla bloqueada' }).count() === 0, 'con la suya, sí');
await p.getByLabel('Bloquear la pantalla si nadie la usa').selectOption('0');
await p.context().close();

// RNF-66 · una versión nueva publicada se ofrece para actualizar.
p = await pagina('vendedor');
await p.route('**/api/version', (r) => r.fulfill({ json: { commit: 'otra-version' } }));
await ir(p, '/precio');
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await p.waitForTimeout(600);
ok('RNF-66', await p.getByRole('button', { name: 'Actualizar' }).count() === 1, 'aparece "Hay una versión nueva · Actualizar"');
await p.context().close();

// ---------------------------------------------------------------- vendedor
p = await pagina('vendedor');
await ir(p, '/ayuda');
const guiasVendedor = await p.locator('main details').count();
ok('RF-M9-12', guiasVendedor > 0 && guiasVendedor < guiasAdmin, `el vendedor ve solo sus guías (${guiasVendedor})`);
await ir(p, '/bitacora');
ok('RF-M9-11', new URL(p.url()).pathname !== '/bitacora' || !/Bitácora/.test(await texto(p)), 'el vendedor no entra a la bitácora');

await ir(p, '/pos');
ok('RF-M5-29', /Precios actualizados/.test(await texto(p)), 'Vender dice de cuándo son los precios');
await p.fill('input[type=search]', 'arroz');
await p.waitForTimeout(700);
await p.locator('ul button', { hasText: 'Arroz' }).first().click();
await p.waitForTimeout(400);
const deshacer = p.getByRole('button', { name: 'Deshacer' });
ok('RF-M5-24', await deshacer.count() === 1, 'al agregar un producto se ofrece deshacer');
if (await deshacer.count()) { await deshacer.click(); await p.waitForTimeout(300); }
ok('RF-M5-24', !/Cobrar \$/.test(await texto(p)) || /Cobrar \$0/.test(await texto(p)), 'deshacer saca la línea');
await p.screenshot({ path: `${SP}/r3-pos.png`, fullPage: true });
// RNF-63 · una venta a medio armar sobrevive a recargar la página.
await p.fill('input[type=search]', 'arroz');
await p.waitForTimeout(700);
await p.locator('ul button', { hasText: 'Arroz' }).first().click();
await p.waitForTimeout(400);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(900);
ok('RNF-63', /Arroz/.test(await texto(p)), 'la venta a medio armar sigue ahí después de recargar');
// RF-M5-25 · lo que más se vende en este celular aparece a un toque.
await p.evaluate(() => new Promise((listo) => {
  const r = indexedDB.open('rutaahorro');
  r.onsuccess = () => {
    const q = r.result.transaction('products').objectStore('products').getAll();
    q.onsuccess = () => {
      const ids = q.result.slice(0, 3).map((x) => x.id);
      localStorage.setItem('pos:frecuentes', JSON.stringify(Object.fromEntries(ids.map((id, i) => [id, 10 - i]))));
      listo();
    };
  };
}));
await ir(p, '/pos');
ok('RF-M5-25', /Frecuentes en este celular/.test(await texto(p)), 'Vender muestra los productos frecuentes del celular');

await ir(p, '/caja');
const tCaja = await texto(p);
ok('RNF-65', /\b\d{2}:\d{2}\b/.test(tCaja) && !/[ap]\.\s?m\./.test(tCaja), 'las horas se muestran en formato de 24 horas');
await p.getByRole('button', { name: 'Cerrar caja' }).first().click();
await p.waitForTimeout(500);
const porBillete = p.getByRole('button', { name: 'Contar por billete' });
ok('RF-M6-13', await porBillete.count() === 1, 'al cerrar la caja se puede contar por billete');
if (await porBillete.count()) {
  await porBillete.click();
  await p.waitForTimeout(300);
  ok('RF-M6-13', /\$20\.000/.test(await p.locator('body').innerText()), 'con las denominaciones chilenas, de $20.000 a $10');
}
await p.context().close();

// ---------------------------------------------------------------- bodega
p = await pagina('bodega');
await ir(p, '/cuenta');
ok('RF-M9-14', /Bodega/.test(await texto(p)), 'bodega también tiene Mi cuenta');
await ir(p, '/usuarios');
ok('RF-M1-20', new URL(p.url()).pathname !== '/usuarios', 'bodega no ve Usuarios (ni el estado de las contraseñas)');
await p.context().close();

// Usuarios: la contraseña temporal sin cambiar (RF-M1-20).
p = await pagina('admin');
await ir(p, '/usuarios');
await p.getByRole('button', { name: /Nueva cuenta|Crear cuenta/ }).first().click();
await p.waitForTimeout(300);
const dlg = p.getByRole('dialog');
await dlg.getByLabel(/Nombre/).first().fill('Ana QA');
await dlg.getByLabel(/Correo/).first().fill(`ana${Date.now()}@demo.cl`);
await dlg.getByRole('button', { name: /Crear/ }).last().click();
await p.waitForTimeout(800);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
ok('RF-M1-20', /Contraseña temporal sin cambiar/.test(await texto(p)), 'Usuarios marca a quien aún tiene la contraseña temporal');
await p.context().close();

writeFileSync(new URL('./.resultado-demo-ronda3.json', import.meta.url), JSON.stringify(resultados, null, 1));
const bien = resultados.filter((r) => r.cumple).length;
console.log(`\n${bien}/${resultados.length}  errores JS: ${JSON.stringify(errores)}`);
await nav.close();
process.exit(bien === resultados.length && errores.length === 0 ? 0 : 1);
