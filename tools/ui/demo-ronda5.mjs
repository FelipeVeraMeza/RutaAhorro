/**
 * Recorrido del MODO DEMO, ronda 5 (2026-10-01): la revisión por rol de
 * docs/26. Cada comprobación cita el N° del error que demuestra corregido.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-ronda5.mjs
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
async function pagina(rol, zona) {
  const ctx = await nav.newContext({ viewport: { width: 360, height: 780 }, ...(zona ? { timezoneId: zona } : {}) });
  await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol}: ${e.message.slice(0, 150)}`));
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

// ------------------------------------------------------------- vendedor
let p = await pagina('vendedor');
await ir(p, '/pos');
await p.waitForTimeout(1000);
await agregar(p, 'Yogurt');
ok('QA-15', /lote vencido/.test(await aviso(p)), 'Vender avisa que el producto tiene un lote vencido');
await agregar(p, 'Cloro');
for (let i = 0; i < 3; i++) await p.getByRole('button', { name: 'Agregar una unidad de Cloro · 900 ml' }).click();
await p.waitForTimeout(300);
ok('QA-24', /así no se podrá cobrar/i.test(await aviso(p)), 'subir con "+" por sobre el stock avisa al momento');
await p.getByRole('button', { name: 'Quitar Yogurt frutilla · 150 g de la venta' }).click();
await p.waitForTimeout(300);
ok('QA-05', /Se quitó Yogurt/.test(await aviso(p)) && await p.getByRole('button', { name: 'Deshacer' }).count() === 1,
  'quitar una línea ofrece "Deshacer"');
await p.getByRole('button', { name: 'Deshacer' }).click();
await p.waitForTimeout(300);
ok('QA-05', /Yogurt frutilla/.test(await texto(p)), '"Deshacer" devuelve la línea quitada');
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /Transferencia/ }).click();
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.waitForTimeout(800);
const dlg = await p.getByRole('dialog').innerText().catch(() => '');
ok('QA-23', /No hay stock suficiente de Cloro/.test(dlg), 'el motivo de que no se registre se ve DENTRO del cobro');
await p.getByRole('button', { name: /Efectivo/ }).click();
await p.fill('#recibido', '20000,5');
await p.waitForTimeout(200);
ok('QA-46/47', /sin decimales/.test(await p.getByRole('dialog').innerText()), '"20000,5" recibido se rechaza (antes $200.005)');
await p.keyboard.press('Escape');
await p.context().close();

// Vaciar suelta al cliente (6) y búsqueda sin tildes al elegir cliente (22).
p = await pagina('admin');
await ir(p, '/clientes');
await p.getByRole('button', { name: 'Nuevo cliente' }).click();
await p.getByRole('dialog').getByLabel('Nombre o razón social').fill('José Muñoz');
await p.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
await p.waitForTimeout(700);
await p.fill('input[type=search]', 'jose munoz');
await p.waitForTimeout(300);
ok('QA-22', /José Muñoz/.test(await texto(p)), 'Clientes encuentra "José Muñoz" buscando "jose munoz"');
await ir(p, '/pos');
await p.waitForTimeout(800);
await agregar(p, 'Arroz');
await p.getByRole('button', { name: /Elegir cliente/ }).click();
await p.getByRole('dialog').getByLabel('Buscar cliente por nombre o RUT').fill('jose');
await p.waitForTimeout(200);
ok('QA-22', await p.getByRole('dialog').getByRole('button', { name: /José Muñoz/ }).count() === 1, 'en Vender también, sin tildes');
await p.getByRole('dialog').getByRole('button', { name: /José Muñoz/ }).click();
await p.waitForTimeout(300);
await p.fill('input[type=search]', 'Aceite');
await p.waitForTimeout(600);
// QA-09 mostraba el precio del cliente ($2.291 con 8 %). Desde 0032 el cliente
// no tiene precio propio: la búsqueda muestra el normal, sin tachar nada.
const listaAceite = await p.locator('main ul').first().innerText();
ok('0032', /\$2\.490/.test(listaAceite) && !/\$2\.291/.test(listaAceite), 'con un cliente elegido, la búsqueda muestra el precio normal ($2.490)');
await p.fill('input[type=search]', '');
await p.getByRole('button', { name: 'Vaciar' }).click();
await p.getByRole('button', { name: 'Sí, vaciar' }).click();
await p.waitForTimeout(300);
ok('QA-06', await p.getByRole('button', { name: /Elegir cliente/ }).count() === 1, 'vaciar la venta suelta al cliente');

// ------------------------------------------------------------- jefe
await ir(p, '/ventas');
const ventas = await texto(p);
ok('QA-11', /\b\d{2}-\d{2} \d{2}:\d{2}\b/.test(ventas) && !/\d{1,2}\/\d{1,2}, \d/.test(ventas), 'fecha y hora como "30-09 22:50" en cualquier equipo');
await ir(p, '/productos');
ok('QA-12', /margen \d+(,\d)? %/.test(await texto(p)), 'el margen se escribe con coma decimal ("25,7 %")');
await ir(p, '/inventario');
// QA-14 ("Mover" o "Reponer") quedó fuera el 2026-10-01: una sola bodega (0032).
ok('0032', await p.getByRole('button', { name: 'Mover' }).count() === 0 && await p.getByRole('button', { name: 'Reponer' }).count() === 0,
  'Inventario sin "Mover" ni "Reponer": una sola bodega');
await ir(p, '/proveedores?vista=comprar');
await p.getByLabel('Cantidad a pedir de Cloro · 900 ml').fill('0');
await p.waitForTimeout(300);
ok('QA-49', /3 productos en el pedido/.test(await texto(p)), 'con 0, el producto sale del pedido');
await ir(p, '/usuarios');
await p.getByRole('button', { name: 'Desactivar' }).first().click();
await p.waitForTimeout(300);
ok('QA-32', /¿Desactivar a/.test(await p.getByRole('dialog').innerText().catch(() => '')), 'desactivar a alguien pide confirmar');
await p.keyboard.press('Escape');
await ir(p, '/ayuda');
await p.getByText('Recibir mercadería').first().click();
ok('QA-35', /Recibir mercadería": elige el proveedor/.test(await texto(p)), 'Ayuda nombra el botón real');
const menu = await p.locator('body').innerText();
await p.getByRole('button', { name: 'Más' }).click().catch(() => {});
await p.waitForTimeout(300);
ok('QA-34', /Compras/.test(await p.locator('body').innerText()) && !/\bProv\.\b/.test(menu), 'el menú dice "Compras", como la pantalla');
await p.context().close();

// Supervisor: sin costos en el Inicio (25) y sin "Anular" en ventas de otro día (18).
p = await pagina('supervisor');
await ir(p, '/');
ok('QA-25', !/en riesgo/.test(await texto(p)) && /Vencimientos/.test(await texto(p)), 'el Inicio del supervisor no muestra el valor al costo de lo que vence');
const wa = decodeURIComponent(await p.getByRole('link', { name: 'Enviar el resumen de hoy por WhatsApp' }).getAttribute('href') ?? '');
ok('QA-41', !/al costo/.test(wa) && /Almacén RutaAhorro/.test(wa), 'su resumen por WhatsApp no lleva costos y sí el nombre del local');
await p.context().close();

// Un celular en otra zona horaria (UTC) a esta hora: la caja de hoy no es "de otro día" (1).
p = await pagina('vendedor', 'UTC');
await ir(p, '/caja');
const caja = await texto(p);
ok('QA-01', !/quedó abierta de otro día/.test(caja), 'la caja de hoy no se marca "de otro día" en un celular con otra zona');
ok('QA-02', !/\$-/.test(caja), 'los egresos no salen como "$-5.000"');
await p.context().close();

ok('RNF-40', errores.length === 0, `sin errores de JavaScript (${errores.length})`, errores.slice(0, 3).join(' | '));
await nav.close();
const fallas = resultados.filter((r) => !r.cumple);
writeFileSync(new URL('./.resultado-demo-ronda5.json', import.meta.url), JSON.stringify(resultados, null, 2));
console.log(`\n${resultados.length - fallas.length}/${resultados.length} comprobaciones`);
process.exit(fallas.length ? 1 : 0);
