/// <reference lib="dom" />
// Lo que corre dentro de `page.evaluate` se ejecuta en el navegador del SII: ahí sí hay DOM.
import type { Page } from 'puppeteer-core';
import { cleanRut } from '@rutaahorro/core';

/**
 * Entrar al SII con RUT y clave tributaria, en cualquiera de sus dos pantallas.
 *
 *  · La nueva (clave.w.sii.cl, la de e-Boleta): #inputRut, #inputPass, #bt_ingresar.
 *    El campo RUT pone puntos y guión MIENTRAS se escribe: escribir
 *    "77736858-3" dejaba "777.368.583.777-3" (2026-10-11). Por eso se escriben
 *    solo dígitos y DV, y se comprueba lo que quedó.
 *  · La antigua (la de VSV, factura TIPO=4): #rutcntr, #clave, #bt_ingresar.
 *    Ahí el campo no da formato y el SII espera "12345678-9".
 *
 * Y lo más importante: si el SII contesta "Clave incorrecta" (o RUT no válido,
 * contribuyente no encontrado, clave bloqueada) se lanza `ErrorClaveSii` y
 * quien llame NO debe volver a intentar. El SII bloquea la clave tras varios
 * intentos fallidos, y un robot que reintenta solo la bloquea en minutos.
 */

/** El SII rechazó el RUT o la clave. No se reintenta: hay que corregir la credencial. */
export class ErrorClaveSii extends Error {}

const PANTALLAS = [
  { rut: '#inputRut', clave: '#inputPass' },
  { rut: '#rutcntr', clave: '#clave' },
];

/** Lo que el SII escribe cuando la credencial está mal: reintentar no lo arregla. */
const RECHAZO = /clave incorrecta|rut no v[aá]lido|contribuyente no encontrado|debes obtener clave|bloquead|suspendid/i;

/** ¿Está a la vista un formulario de login del SII? */
export async function hayLogin(page: Page): Promise<boolean> {
  for (const p of PANTALLAS) if (await page.$(p.rut)) return true;
  return false;
}

/** Los avisos que el SII muestra bajo el formulario (spans .alert_dni, alertas). Solo los visibles. */
async function avisosVisibles(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.alert_dni, .alert, .error, [role=alert]'))
    .filter((el) => el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)).catch(() => []);
}

/**
 * Entra con la pantalla de login que esté a la vista. Si no hay ninguna, no
 * hace nada (ya hay sesión). Termina cuando el formulario desapareció; si no
 * desaparece, lanza `ErrorClaveSii` (credencial rechazada) o `Error` (otra cosa).
 */
export async function entrarAlSii(page: Page, rut: string, clave: string): Promise<void> {
  let pantalla: (typeof PANTALLAS)[number] | undefined;
  for (const p of PANTALLAS) if (await page.$(p.rut)) { pantalla = p; break; }
  if (!pantalla) return;

  const limpio = cleanRut(rut);
  if (limpio.length < 2) throw new ErrorClaveSii('RUT del usuario del SII vacío o inválido');
  const conGuion = `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;

  await page.click(pantalla.rut, { count: 3 });
  await page.keyboard.press('Backspace');
  await page.type(pantalla.rut, limpio, { delay: 60 });
  const quedo = await page.$eval(pantalla.rut, (i) => (i as HTMLInputElement).value);
  // Sin formato automático (pantalla antigua) quedó "123456789": se pone con guión.
  // Con formato, o si el campo lo descuadró, se escribe el valor de una vez.
  if (cleanRut(quedo) !== limpio || !quedo.includes('-')) {
    await page.$eval(pantalla.rut, (i, v) => {
      const campo = i as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, v);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      campo.dispatchEvent(new Event('change', { bubbles: true }));
    }, conGuion);
  }
  const final = await page.$eval(pantalla.rut, (i) => (i as HTMLInputElement).value);
  if (cleanRut(final) !== limpio) throw new Error(`El campo RUT del SII quedó "${final}" y no "${conGuion}"; no se envió.`);

  await page.click(pantalla.clave, { count: 3 });
  await page.keyboard.press('Backspace');
  await page.type(pantalla.clave, clave, { delay: 40 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {}),
    page.click('#bt_ingresar'),
  ]);

  // El login nuevo puede responder sin navegar (avisa en la misma página):
  // se espera a que el formulario se vaya o aparezca un aviso.
  for (let i = 0; i < 20; i++) {
    if (!(await hayLogin(page))) return;
    const avisos = await avisosVisibles(page);
    const rechazo = avisos.find((a) => RECHAZO.test(a));
    if (rechazo) throw new ErrorClaveSii(`El SII rechazó la entrada de ${conGuion}: «${rechazo}». No se reintenta.`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const avisos = await avisosVisibles(page);
  throw new Error(`El SII no dejó entrar y no dijo por qué${avisos.length ? ` (avisos: ${avisos.join(' | ')})` : ''}.`);
}
