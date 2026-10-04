/**
 * Recorrido del MODO DEMO, ronda 7 (2026-10-04): los hallazgos de docs/28 que
 * se pueden ver en la maqueta. Cada comprobación cita su N°.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-ronda7.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const resultados = [];
const errores = [];
const dialogos = [];
const ok = (id, cumple, texto, detalle = '') => {
  resultados.push({ rf: id, cumple: Boolean(cumple), texto });
  console.log(cumple ? '✔' : '✖', id, texto, detalle ? `· ${String(detalle).slice(0, 160)}` : '');
};
async function pagina(rol) {
  const ctx = await nav.newContext({ viewport: { width: 360, height: 780 } });
  await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol}: ${e.message.slice(0, 150)}`));
  p.on('dialog', (d) => { dialogos.push(d.message()); void d.accept(); });
  return p;
}
const ir = async (p, ruta) => { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); };
const texto = (p) => p.locator('main').first().innerText();
const plano = (s) => s.replace(/\s+/g, ' ');
const aviso = (p) => p.locator('[role=status]').first().innerText().catch(() => '');
async function agregar(p, nombre) {
  await p.fill('input[type=search]', nombre);
  await p.waitForTimeout(600);
  await p.locator('main li button', { hasText: nombre }).first().click();
  await p.waitForTimeout(300);
}

// ============================================================ admin · Vender
let p = await pagina('admin');
await ir(p, '/pos');
await p.waitForTimeout(800);

// N° 105 · el descuento a mano sigue a la cantidad.
await agregar(p, 'Arroz');
for (let i = 0; i < 2; i++) await p.getByRole('button', { name: 'Agregar una unidad de Arroz grado 1 · 1 kg' }).click();
await p.getByRole('button', { name: 'Descuento a Arroz grado 1 · 1 kg' }).click();
await p.getByRole('dialog').getByLabel(/Cuánto se descuenta/).fill('300');
await p.getByRole('button', { name: 'Aplicar descuento' }).click();
await p.waitForTimeout(300);
for (let i = 0; i < 2; i++) await p.getByRole('button', { name: 'Quitar una unidad de Arroz grado 1 · 1 kg' }).click();
await p.waitForTimeout(300);
const carro = plano(await texto(p));
ok('QA-105', /Descuento -\$100/.test(carro) && !/Descuento -\$300/.test(carro),
  'bajar de 3 a 1 deja el descuento en la misma proporción ($300 → $100)', (carro.match(/Descuento -\$[\d.]+/) ?? [''])[0]);

// N° 109 · Enter en "¿Con cuánto paga?" confirma la venta.
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.waitForTimeout(400);
await p.fill('#recibido', '5000');
await p.locator('#recibido').press('Enter');
await p.waitForTimeout(1200);
const comp = p.getByRole('dialog', { name: 'Comprobante de la venta' });
ok('QA-109', await comp.count() === 1, 'Enter en "¿Con cuánto paga?" confirma la venta y aparece el comprobante');

// N° 108 · el comprobante es un diálogo de verdad: Escape lo cierra.
ok('QA-108', (await comp.getAttribute('aria-modal').catch(() => null)) === 'true', 'el comprobante es un diálogo modal');
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
ok('QA-108', await p.getByRole('dialog', { name: 'Comprobante de la venta' }).count() === 0, 'Escape cierra el comprobante (= nueva venta)');

// N° 101 · una venta que quedó "enviando" (pestaña cerrada a medio enviar) se vuelve a enviar.
const uuid = await p.evaluate(() => new Promise((ok, mal) => {
  const id = crypto.randomUUID();
  const req = indexedDB.open('rutaahorro');
  req.onerror = () => mal(req.error);
  req.onsuccess = () => {
    const tx = req.result.transaction('saleQueue', 'readwrite');
    tx.objectStore('saleQueue').put({
      clientUuid: id, soldAt: new Date().toISOString(), userId: 'demo',
      items: [{ product_id: 'p09', quantity: 1, unit_price: 990, discount_amount: 0, name: 'Agua mineral · 1.5 L' }],
      payments: [{ method: 'transferencia', amount: 990 }], discountTotal: 0, total: 990,
      status: 'enviando', attempts: 0, createdAt: new Date().toISOString(),
    });
    tx.oncomplete = () => ok(id);
    tx.onerror = () => mal(tx.error);
  };
}));
await ir(p, '/pos');
await p.waitForTimeout(2500);
const sigue = await p.evaluate((id) => new Promise((ok) => {
  const req = indexedDB.open('rutaahorro');
  req.onsuccess = () => {
    const g = req.result.transaction('saleQueue').objectStore('saleQueue').get(id);
    g.onsuccess = () => ok(g.result ? g.result.status : null);
  };
}), uuid);
ok('QA-101', sigue === null, 'la venta que quedó "enviando" se reenvía sola y sale de la cola', `estado: ${sigue}`);

// N° 142 · escanear un producto desactivado lo dice, no ofrece crearlo.
await ir(p, '/productos');
await p.fill('input[type=search]', 'Cloro');
await p.waitForTimeout(700);
await p.getByRole('button', { name: 'Quitar' }).first().click();
await p.waitForTimeout(500);
await p.getByRole('dialog').getByRole('button', { name: 'Desactivar' }).click();
await p.waitForTimeout(800);
await ir(p, '/pos');
await p.fill('input[type=search]', '7801234000124');
await p.locator('input[type=search]').press('Enter');
await p.waitForTimeout(800);
const av = await aviso(p);
ok('QA-142', /desactivado/.test(av) && !/Crear el producto con este código/.test(await texto(p)),
  'un código de un producto desactivado dice que está desactivado', av);
await p.context().close();

// ============================================================ admin · Compras
p = await pagina('admin');
await ir(p, '/proveedores/recepcion');
await p.locator('#prov').selectOption({ label: 'Lácteos del Valle' });
await p.locator('#tipo').selectOption('factura');
ok('QA-143', await p.locator('#fecha-doc').count() === 1, 'con factura se pide la fecha del papel (libro de compras)');
await p.locator('#num').fill('R7');
await agregar(p, 'Arroz');
await p.getByLabel('Costo unitario de Arroz grado 1 · 1 kg').fill('0');
await p.waitForTimeout(200);
dialogos.length = 0;
// El diálogo se acepta solo (pagina): lo que importa es que se haya preguntado.
await p.getByRole('button', { name: /Confirmar recepción/ }).click();
await p.waitForTimeout(1500);
ok('QA-144', dialogos.some((d) => /costo \$0/.test(d)), 'confirmar con costo $0 pregunta si es mercadería sin costo', dialogos.join(' | '));

// N° 150 · la pestaña dice cuántas muestra.
await ir(p, '/proveedores');
ok('QA-150', /Recepciones \(/.test(await texto(p)), 'Compras muestra la pestaña de recepciones con su cantidad');

// N° 139 · las ofertas son por unidad.
await ir(p, '/productos/ofertas');
await p.getByLabel('Desde cuántas unidades').fill('2,5');
await p.getByLabel(/Porcentaje de rebaja|Precio de cada unidad/).fill('10');
await p.waitForTimeout(300);
ok('QA-139', /se cuenta entero/.test(await texto(p)), '"desde 2,5 unidades" se rechaza: todo es por unidad');

// N° 138 · elegir el mismo archivo otra vez vuelve a leerlo.
const dir = mkdtempSync(path.join(tmpdir(), 'ra-'));
// Un "Excel" que no lo es: el error deja la pantalla en el paso de elegir.
const archivo = path.join(dir, 'malo.xlsx');
writeFileSync(archivo, 'esto no es una planilla');
await ir(p, '/productos/importar');
await p.locator('input[type=file]').setInputFiles(archivo);
await p.waitForTimeout(800);
ok('QA-138', (await p.locator('input[type=file]').inputValue()) === '', 'el campo de archivo queda vacío después de leer (elegir el mismo archivo otra vez funciona)');
await p.context().close();

// ============================================================ vendedor · Caja
p = await pagina('vendedor');
await ir(p, '/caja');
await p.getByRole('button', { name: 'Cerrar caja' }).click();
await p.waitForTimeout(800);
await p.fill('#contado', '1');
await p.fill('#nota', 'prueba ronda 7');
await p.getByRole('button', { name: 'Cerrar caja' }).last().click();
await p.waitForTimeout(1200);
const resumen = plano(await p.locator('#ticket').innerText().catch(() => ''));
ok('QA-112', /Efectivo inicial/.test(resumen) && /Ventas en efectivo/.test(resumen) && /Debía haber/.test(resumen),
  'el resumen impreso trae las filas que suman el "debía haber"', resumen.slice(0, 160));
await p.context().close();

// ============================================================ bloqueo
// N° 163 · el bloqueo no se salta cerrando la app: al volver después del plazo, bloqueada.
p = await pagina('vendedor');
await ir(p, '/ayuda');
await p.evaluate(() => {
  localStorage.setItem('ra:preferencias', JSON.stringify({ letra: 'normal', bloqueoMin: 2 }));
  localStorage.setItem('ra:ultima-actividad', `vendedor@demo.cl|${Date.now() - 10 * 60_000}`);
});
// Otra pestaña, como al volver a abrir la app: sessionStorage vacío.
const otra = await p.context().newPage();
otra.on('pageerror', (e) => errores.push(`vendedor: ${e.message.slice(0, 150)}`));
await otra.goto(BASE + '/pos', { waitUntil: 'networkidle' });
await otra.waitForTimeout(1200);
ok('QA-163', await otra.locator('#t-bloqueo').count() === 1, 'abierta en otra pestaña después del plazo, la app aparece bloqueada');
await p.context().close();

// ============================================================ supervisor · Compras
p = await pagina('supervisor');
await ir(p, '/proveedores?vista=proveedores');
ok('QA-159', await p.getByRole('button', { name: 'Editar' }).count() === 0, 'el supervisor no ve "Editar" en los proveedores (solo el admin los cambia)');
await p.context().close();

ok('RNF-40', errores.length === 0, `sin errores de JavaScript (${errores.length})`, errores.join(' | '));
await nav.close();
const bien = resultados.filter((r) => r.cumple).length;
console.log(`\n${bien}/${resultados.length} comprobaciones (hoy ${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })})`);
writeFileSync(new URL('./.resultado-demo-ronda7.json', import.meta.url), JSON.stringify(resultados, null, 1));
process.exit(bien === resultados.length ? 0 : 1);
