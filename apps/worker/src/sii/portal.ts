/// <reference lib="dom" />
// Lo que corre dentro de `page.evaluate` se ejecuta en el navegador del SII: ahí sí hay DOM.
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { partirRut, type PlanPortal } from '@rutaahorro/core';

/**
 * El robot que emite una factura (33) en el portal gratuito del SII.
 *
 * Adaptado de `modelo-vsv/factura_manual.mjs` (VSV-Contadores), que Felipe
 * opera a diario: mismos selectores, mismas esperas y los mismos arreglos que
 * se ganaron fallando contra el portal real (ver los comentarios de allá). Lo
 * que cambió y por qué está en `modelo-vsv/README.md`.
 *
 * NO ESTÁ PROBADO CONTRA EL SII: falta que el cliente entregue su clave
 * tributaria y la del certificado (B-04, B-05). Por eso es conservador: ante
 * cualquier duda se detiene ANTES de firmar, y después de firmar nunca dice
 * "falló" a secas, porque la factura puede haber quedado emitida.
 */

export interface CredencialesSii {
  /** RUT de la PERSONA que entra al portal (no el de la empresa). */
  rutUsuario: string;
  claveSii: string;
  claveCertificado: string;
  /** RUT de la EMPRESA a nombre de la cual se emite. */
  rutEmpresa: string;
}

export interface FacturaParaPortal {
  receptor: { rut: string; razon_social: string; ciudad?: string | null; correo?: string | null; contacto?: string | null };
  ciudadEmisor?: string | null;
  formaPago: 'contado' | 'credito';
  plan: PlanPortal;
}

export interface ResultadoPortal {
  folio: number;
  /** El PDF que entrega el SII; null si no se pudo bajar (la factura igual quedó emitida). */
  pdf: Uint8Array | null;
}

/**
 * Un error después de apretar "Firmar". La factura PUEDE estar emitida: quien
 * lo reciba no debe reintentar sin revisar el portal.
 */
export class ErrorDespuesDeFirmar extends Error {}

const URL_EMISION = 'https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=33&TIPO=4';
const URL_SALIR = 'https://misiir.sii.cl/cgi_misii/siu/cgi_misii_logout';
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dos = (n: number) => String(n).padStart(2, '0');

/** Espera a que el SII deje de recargar el formulario (evita "context destroyed"). */
async function esperarEstable(page: Page) {
  for (let i = 0; i < 6; i++) {
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 });
      await espera(400);
    } catch {
      break;
    }
  }
  await espera(500);
}

async function escribir(page: Page, selector: string, texto: string | null | undefined) {
  if (!texto) return;
  await page.waitForSelector(selector, { visible: true, timeout: 5000 });
  await page.click(selector, { count: 3 });
  await page.keyboard.press('Backspace');
  await page.type(selector, texto, { delay: 40 });
}

/** Dónde quedó el robot, para que el error diga algo útil (lección del 31-08 en VSV). */
async function dondeQuedo(page: Page): Promise<string> {
  const d = await page.evaluate(() => ({
    url: location.href,
    titulo: document.title,
    texto: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  })).catch(() => ({ url: '?', titulo: '?', texto: '?' }));
  return `El robot quedó en ${d.url} («${d.titulo}»). La página decía: "${d.texto}".`;
}

async function elegirEmpresa(page: Page, rutEmpresa: string) {
  if (!(await page.$('select[name="RUT_EMP"]'))) return; // una sola empresa
  const r = await page.evaluate((objetivo: string) => {
    const sel = document.querySelector<HTMLSelectElement>('select[name="RUT_EMP"]');
    if (!sel) return { estado: 'sin-select', disponibles: [] as string[] };
    const cuerpo = (v: string) => {
      const m = String(v || '').match(/(\d{1,3}(?:\.\d{3}){1,2}|\d{7,8})\s*-?\s*([\dkK])?(?!\d)/);
      if (m) return m[1].replace(/\D/g, '');
      const n = String(v || '').replace(/\D/g, '');
      return n.length > 8 ? n.slice(0, -1) : n;
    };
    const opciones = Array.from(sel.options);
    const opt = opciones.find((o) => cuerpo(o.value) === objetivo || cuerpo(o.text) === objetivo);
    const disponibles = opciones.map((o) => o.text).filter(Boolean);
    if (!opt) return { estado: 'no-esta', disponibles };
    sel.selectedIndex = opt.index;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { estado: 'listo', disponibles };
  }, partirRut(rutEmpresa)?.cuerpo ?? '');
  if (r.estado === 'no-esta') {
    throw new Error(`La empresa ${rutEmpresa} no aparece entre las que puede emitir esta cuenta del SII. `
      + `Ofrecía: ${r.disponibles.join(' | ') || '(nada)'}.`);
  }
  // La pausa antes del envío no sobra (ver empresaEmisora.mjs).
  await espera(500);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
    page.evaluate(() => {
      document.querySelector<HTMLElement>(
        'input[type="submit"], button[type="submit"], input[name="btnContinuar"], button[name="btnContinuar"]')?.click();
    }).catch(() => {}),
  ]);
}

/** La línea N del detalle: si el formulario no la muestra, se pide una más. */
async function asegurarLinea(page: Page, n: number) {
  const campo = `input[name="EFXP_NMB_${dos(n)}"]`;
  if (await page.$(campo)) return campo;
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type="button"], button'))
      .find((x) => /agregar\s*l[ií]nea|agregar\s*detalle|m[aá]s\s*l[ií]neas/i.test((x as HTMLInputElement).value || x.innerText || ''));
    b?.click();
  });
  await espera(800);
  if (!(await page.$(campo))) {
    throw new Error(`El portal no mostró la línea ${n} del detalle. ${await dondeQuedo(page)}`);
  }
  return campo;
}

/** Los montos que el portal calculó, leídos del formulario después de "Validar". */
async function totalesDelPortal(page: Page): Promise<{ neto: number | null; iva: number | null; total: number | null }> {
  return page.evaluate(() => {
    const leer = (patron: RegExp) => {
      const el = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
        .find((i) => patron.test(`${i.name} ${i.id}`.toUpperCase()));
      const n = el ? Number(String(el.value).replace(/[^\d]/g, '')) : NaN;
      return Number.isFinite(n) && el?.value ? n : null;
    };
    return { neto: leer(/MNT_?NETO/), iva: leer(/(^|_)IVA(\b|_)/), total: leer(/MNT_?TOTAL/) };
  });
}

async function bajarPdf(page: Page, folio: number): Promise<Uint8Array | null> {
  const url = 'https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsEmi.cgi'
    + `?RUT_RECP=&FOLIO=${folio}&RZN_SOC=&FEC_DESDE=&FEC_HASTA=&TPO_DOC=&ESTADO=&ORDEN=&NUM_PAG=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const codigo = await page.evaluate((buscado: string) => {
    for (const fila of Array.from(document.querySelectorAll('table tbody tr'))) {
      const c = fila.querySelectorAll('td');
      const tipo = (c[3]?.textContent || '').toLowerCase();
      if (c[4]?.textContent?.trim() !== buscado || !tipo.includes('factura') || tipo.includes('exenta')) continue;
      const href = c[0]?.querySelector('a')?.href;
      if (href) return new URLSearchParams(href.split('?')[1] || '').get('CODIGO');
    }
    return null;
  }, String(folio)).catch(() => null);
  if (!codigo) return null;
  const cookies = await page.cookies();
  const r = await fetch(`https://www1.sii.cl/cgi-bin/Portal001/mipeDisplayPDF.cgi?DHDR_CODIGO=${codigo}`, {
    headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), Referer: page.url() },
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  // Un PDF de verdad empieza con "%PDF"; un HTML de error no se guarda.
  const esPdf = bytes.length > 1000 && String.fromCharCode(...bytes.subarray(0, 4)) === '%PDF';
  return esPdf ? bytes : null;
}

async function cerrar(browser: Browser | null) {
  if (!browser) return;
  try {
    await Promise.race([browser.close(), new Promise((_, no) => setTimeout(() => no(new Error('no cerró')), 8000))]);
  } catch {
    try { browser.process()?.kill('SIGKILL'); } catch { /* ya no está */ }
  }
}

export async function emitirEnPortal(
  f: FacturaParaPortal,
  cred: CredencialesSii,
  opciones: { chromePath: string; headless?: boolean; alPaso?: (texto: string) => void },
): Promise<ResultadoPortal> {
  const paso = opciones.alPaso ?? (() => {});
  const usuario = partirRut(cred.rutUsuario);
  const receptor = partirRut(f.receptor.rut);
  if (!usuario || !receptor) throw new Error('RUT del usuario o del receptor inválido');

  let browser: Browser | null = null;
  let page: Page | null = null;
  let firmado = false;
  try {
    paso('Abriendo el navegador');
    for (let intento = 1; ; intento++) {
      try {
        browser = await puppeteer.launch({
          executablePath: opciones.chromePath,
          headless: opciones.headless ?? true,
          protocolTimeout: 120_000,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
        });
        page = await browser.newPage();
        // Los avisos del SII bloqueaban los clics en VSV: se aceptan solos.
        page.on('dialog', (d) => { void d.accept().catch(() => {}); });
        page.setDefaultNavigationTimeout(60_000);
        await page.goto(URL_EMISION, { waitUntil: 'networkidle2', timeout: 45_000 });
        break;
      } catch (e) {
        await cerrar(browser);
        browser = null;
        if (intento >= 3) throw new Error(`El portal del SII no cargó tras 3 intentos: ${(e as Error).message}`);
        await espera(5000);
      }
    }
    const p = page!;

    if (await p.$('#rutcntr')) {
      paso('Entrando al SII');
      await p.type('#rutcntr', `${usuario.cuerpo}-${usuario.dv}`, { delay: 40 });
      await p.type('#clave', cred.claveSii, { delay: 40 });
      await Promise.all([p.waitForNavigation().catch(() => {}), p.click('#bt_ingresar')]);
      await espera(1500);
      await elegirEmpresa(p, cred.rutEmpresa);
    }

    paso('Escribiendo el RUT del receptor');
    try {
      await p.waitForSelector('input[name="EFXP_RUT_RECEP"], #EFXP_RUT_RECEP', { visible: true, timeout: 45_000 });
    } catch {
      throw new Error(`No apareció el formulario de la factura (¿clave incorrecta o SII lento?). ${await dondeQuedo(p)}`);
    }
    const rutSel = (await p.$('#EFXP_RUT_RECEP')) ? '#EFXP_RUT_RECEP' : 'input[name="EFXP_RUT_RECEP"]';
    const dvSel = (await p.$('#EFXP_DV_RECEP')) ? '#EFXP_DV_RECEP' : 'input[name="EFXP_DV_RECEP"]';
    await p.click(rutSel);
    await p.type(rutSel, receptor.cuerpo, { delay: 80 });
    await p.keyboard.press('Tab');
    await espera(300);
    await p.type(dvSel, receptor.dv, { delay: 80 });
    // El SII valida el RUT con AJAX y RECARGA el formulario: se espera eso.
    await p.keyboard.press('Tab');
    await p.mouse.click(10, 10);
    paso('Esperando que el SII valide el RUT');
    await espera(1200);
    await esperarEstable(p);
    await espera(1200);

    await escribir(p, 'input[name="EFXP_CIUDAD_ORIGEN"]', f.ciudadEmisor || 'Santiago').catch(() => {});
    await escribir(p, 'input[name="EFXP_CIUDAD_RECEP"]', f.receptor.ciudad || 'Santiago').catch(() => {});
    await escribir(p, 'input[name="EFXP_CONTACTO"]', f.receptor.correo || f.receptor.contacto).catch(() => {});

    paso(`Ingresando ${f.plan.lineas.length} línea(s) de detalle`);
    for (const [i, l] of f.plan.lineas.entries()) {
      const n = i + 1;
      await asegurarLinea(p, n);
      await escribir(p, `input[name="EFXP_NMB_${dos(n)}"]`, l.nombre);
      await escribir(p, `input[name="EFXP_QTY_${dos(n)}"]`, l.cantidad);
      await escribir(p, `input[name="EFXP_UNMD_${dos(n)}"]`, l.unidad).catch(() => {});
      await escribir(p, `input[name="EFXP_PRC_${dos(n)}"]`, l.precioNeto);
      if (l.descripcion) {
        const marca = await p.$(`input[name="DESCRIP_${dos(n)}"]`);
        if (marca) {
          await marca.click();
          await p.waitForSelector(`textarea[name="EFXP_DSC_ITEM_${dos(n)}"]`, { visible: true, timeout: 5000 }).catch(() => {});
          await p.type(`textarea[name="EFXP_DSC_ITEM_${dos(n)}"]`, l.descripcion, { delay: 20 }).catch(() => {});
        }
      }
    }
    await p.select('select[name="EFXP_FMA_PAGO"]', f.formaPago === 'credito' ? '2' : '1').catch(() => {});

    paso('Validando los montos con el SII');
    await p.evaluate(() => document.querySelector<HTMLElement>('button[name="Button_Update"]')?.click());
    await p.waitForFunction(() => {
      const b = document.querySelector<HTMLInputElement>('input[name="btnSign"]');
      return b && !b.disabled;
    }, { timeout: 8000, polling: 200 }).catch(() => {});

    // Lo que no estaba en VSV: antes de firmar, el total del portal tiene que
    // ser el de la base. Si no se puede leer o no coincide, no se firma.
    const portal = await totalesDelPortal(p);
    if (portal.total !== f.plan.total) {
      throw new Error(portal.total === null
        ? `No se pudo leer el total que calculó el portal; por seguridad no se firmó. ${await dondeQuedo(p)}`
        : `El portal calculó un total de $${portal.total} y la factura es de $${f.plan.total}. No se firmó.`);
    }

    paso('Firmando la factura');
    let caja = false;
    for (let intento = 0; intento < 3 && !caja; intento++) {
      const estado = await p.evaluate(() => {
        const b = document.querySelector<HTMLInputElement>('input[name="btnSign"]');
        if (!b) return 'no-existe';
        if (b.disabled) return 'deshabilitado';
        b.click();
        return 'apretado';
      });
      if (estado === 'apretado') {
        caja = await p.waitForSelector('#myPass', { visible: true, timeout: 4000 }).then(() => true, () => false);
      }
      if (!caja) {
        await p.evaluate(() => document.querySelector<HTMLElement>('button[name="Button_Update"]')?.click()).catch(() => {});
        await espera(2000);
      }
    }
    if (!caja) throw new Error(`El SII no abrió el cuadro de la clave del certificado. ${await dondeQuedo(p)}`);

    await p.focus('#myPass');
    await p.type('#myPass', cred.claveCertificado, { delay: 40 });
    await espera(500);
    firmado = true;
    await Promise.all([
      p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => {}),
      p.evaluate(() => document.querySelector<HTMLElement>('#btnFirma')?.click()),
    ]);

    paso('Esperando el folio del SII');
    let folio: number | null = null;
    for (let j = 0; j < 30 && folio === null; j++) {
      const texto = await p.evaluate(() => document.body.innerText).catch(() => '');
      const m = texto.match(/N[°º]\s*(\d+)/i) || texto.match(/Folio\s*(\d+)/i);
      if (m) folio = Number(m[1]);
      else await espera(1000);
    }
    if (folio === null) throw new Error(`Se firmó, pero no se leyó el folio. ${await dondeQuedo(p)}`);

    paso('Bajando el PDF');
    // Que el PDF no baje no invalida la factura: ya está emitida.
    const pdf = await bajarPdf(p, folio).catch(() => null);
    return { folio, pdf };
  } catch (e) {
    if (firmado) {
      throw new ErrorDespuesDeFirmar(`${(e as Error).message} ATENCIÓN: se apretó "Firmar"; la factura puede estar `
        + 'emitida. Revisa el portal del SII antes de reintentar o descartar.');
    }
    throw e;
  } finally {
    if (page && !page.isClosed()) await page.goto(URL_SALIR, { timeout: 5000 }).catch(() => {});
    await cerrar(browser);
  }
}
