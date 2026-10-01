/**
 * Recorrido del MODO DEMO, ronda 6 (2026-10-01): los errores 51 a 100 de
 * docs/27 que se pueden ver en la maqueta. Cada comprobación cita su N°.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-ronda6.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const resultados = [];
const errores = [];
const ok = (id, cumple, texto, detalle = '') => {
  resultados.push({ rf: id, cumple: Boolean(cumple), texto });
  console.log(cumple ? '✔' : '✖', id, texto, detalle ? `· ${detalle}` : '');
};
async function pagina(rol) {
  const ctx = await nav.newContext({ viewport: { width: 360, height: 780 } });
  await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol}: ${e.message.slice(0, 150)}`));
  p.on('dialog', (d) => void d.accept());
  return p;
}
const ir = async (p, ruta) => { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); };
const texto = (p) => p.locator('main').first().innerText();
const plano = (s) => s.replace(/\s+/g, ' ');
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

// ============================================================ admin
// El stock de la maqueta no se comprueba acá: SyncCatalogo vuelve a sembrar
// el catálogo en cada carga de página (error encontrado después del 100,
// docs/27). Lo de la base lo prueba tools/pg-test/anular-recepcion.test.mjs.
let p = await pagina('admin');

await ir(p, '/proveedores/recepcion');
await p.locator('#prov').selectOption({ label: 'Lácteos del Valle' });
await p.locator('#tipo').selectOption('factura');
await p.locator('#num').fill('R6');
await p.getByRole('radio', { name: /A crédito/ }).click();   // el vencimiento se pide al elegir "A crédito"
await p.getByRole('button', { name: '30 días' }).click();
await p.getByPlaceholder(/Buscar por nombre/).fill('Arroz');
await p.waitForTimeout(700);
await p.locator('main li button', { hasText: 'Arroz' }).first().click();
await p.waitForTimeout(300);
const vence = await p.inputValue('#vence');
await ir(p, '/proveedores/recepcion');
ok('QA-69', vence !== '' && (await p.inputValue('#vence')) === vence, 'la recepción a medio cargar recuerda el vencimiento de la factura');

const cant = p.getByLabel(/Cantidad recibida de Arroz/);
await cant.fill('7');
await p.getByRole('button', { name: /Quitar Arroz/ }).click();
await p.getByPlaceholder(/Buscar por nombre/).fill('Arroz');
await p.waitForTimeout(700);
await p.locator('main li button', { hasText: 'Arroz' }).first().click();
await p.waitForTimeout(300);
ok('QA-70', (await cant.inputValue()) === '1', 'quitar y volver a agregar parte en 1, no en lo escrito antes');
await cant.fill('5');
await p.getByRole('button', { name: /Confirmar/ }).last().click();
await p.waitForURL(/\/proveedores\?/, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(800);

await ir(p, '/proveedores?vista=pagar');
ok('QA-65', /Factura N° R6/.test(await texto(p)), 'antes de anular, la factura R6 está por pagar');
await ir(p, '/proveedores?vista=recepciones');
await p.getByRole('button', { name: 'Anular', exact: true }).first().click();
await p.getByRole('dialog').locator('textarea').fill('Costo mal escrito');
await p.getByRole('dialog').getByRole('button', { name: 'Anular recepción' }).click();
await p.waitForTimeout(900);
ok('QA-68', /Recepción anulada: se sacó el stock/.test(await texto(p)), 'anular dice qué pasó con el stock, el costo y la factura');
await ir(p, '/proveedores?vista=pagar');
ok('QA-65', !/Factura N° R6/.test(await texto(p)), 'su factura por pagar se anula con ella');

// 100 · emisión futura
await p.getByRole('button', { name: 'Registrar factura' }).click();
const dlg = p.getByRole('dialog');
await dlg.getByLabel('Emitida el').fill('2099-01-01');
await p.waitForTimeout(200);
ok('QA-100', /No puede ser una fecha futura/.test(await dlg.innerText())
  && await dlg.getByRole('button', { name: 'Registrar factura' }).isDisabled(), 'una factura emitida en el futuro no se registra');
await p.keyboard.press('Escape');

// 75 · correo del cliente
await ir(p, '/clientes');
await p.getByRole('button', { name: 'Nuevo cliente' }).click();
await p.getByRole('dialog').getByLabel('Nombre o razón social').fill('Juan Pérez');
await p.getByRole('dialog').getByLabel('Correo').fill('juan.gmail.com');
await p.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
await p.waitForTimeout(300);
ok('QA-75', /Revisa el correo/.test(await p.getByRole('dialog').innerText()), 'un correo sin @ no se guarda');
await p.keyboard.press('Escape');

// 73 · fiado
await ir(p, '/fiado');
ok('QA-73', !(await p.getByRole('button', { name: 'Dar crédito a un cliente' }).isDisabled()), '"Dar crédito" no queda desactivado sin explicación');

// 84 · bitácora
await ir(p, '/bitacora');
await p.getByLabel('Qué').selectOption({ label: 'Venta anulada' });
await p.waitForTimeout(500);
ok('QA-84', /Nada registrado/.test(await texto(p)), 'la fila de ejemplo respeta el filtro');

// 85 y 99 · configuración
await ir(p, '/configuracion');
await p.getByLabel(/Avisar una caja abierta/).fill('0');
ok('QA-85', /al menos 1 hora/.test(await texto(p)), 'con 0 horas dice por qué no se puede guardar');
const casilla = p.locator('main input[type=checkbox]').first();
await casilla.focus();
await p.keyboard.press('Space');
await p.waitForTimeout(1200);
const conFoco = await p.evaluate(() => document.activeElement?.getAttribute('type'));
ok('QA-99', conFoco === 'checkbox', 'el interruptor conserva el foco después de guardar', String(conFoco));
await p.keyboard.press('Space');
await p.waitForTimeout(1200);

// 80 y 81 (devolver) no se pueden ver en la maqueta: no lleva devoluciones.
await p.context().close();

// ============================================================ vendedor
p = await pagina('vendedor');
await ir(p, '/caja');
if (await p.getByRole('button', { name: 'Abrir caja' }).count()) {
  await p.fill('#inicial', '20000');
  await p.getByRole('button', { name: 'Abrir caja' }).click();
  await p.waitForTimeout(900);
}
await p.getByRole('button', { name: '− Egreso' }).click();
await p.getByLabel(/Monto que sale/).fill('9.000.000');
await p.waitForTimeout(200);
ok('QA-78', /deja el cierre en negativo/.test(await texto(p)), 'un egreso mayor que lo que hay en la caja avisa');
await p.getByRole('button', { name: 'Cancelar' }).click();
await p.getByRole('button', { name: 'Cerrar caja' }).click();
await p.waitForTimeout(600);
await p.fill('#contado', '10000');
await p.getByRole('button', { name: 'Contar por billete' }).click();
await p.waitForTimeout(200);
ok('QA-77', /Total contado: \$0/.test(plano(await texto(p))), 'contar por billete parte en $0, no en lo escrito a mano');
await p.context().close();

ok('RNF-40', errores.length === 0, `sin errores de JavaScript (${errores.length})`, errores.slice(0, 3).join(' | '));
await nav.close();
const fallas = resultados.filter((r) => !r.cumple);
writeFileSync(new URL('./.resultado-demo-ronda6.json', import.meta.url), JSON.stringify(resultados, null, 2));
console.log(`\n${resultados.length - fallas.length}/${resultados.length} comprobaciones (hoy ${hoy})`);
process.exit(fallas.length ? 1 : 0);
