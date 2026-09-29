/**
 * Un portal de facturación del SII de mentira, en localhost, para probar el
 * robot (`src/sii/portal.ts`) sin credenciales ni folios reales.
 *
 * Reproduce lo que el robot espera encontrar, con los mismos `name` e `id`:
 * login (#rutcntr, #clave, #bt_ingresar), elección de empresa (RUT_EMP), el
 * formulario (EFXP_*), la recarga que hace el SII al validar el RUT del
 * receptor, "Validar" (Button_Update), "Firmar" (btnSign → #myPass → #btnFirma),
 * el folio en la página siguiente, el listado de emitidos y el PDF.
 *
 * LO QUE NO PRUEBA: que el SII real tenga estos nombres. Los del login, el
 * receptor, la primera línea y la firma vienen del robot de VSV, que funciona
 * a diario contra el portal. Tres cosas NO vienen de VSV y son supuestos hasta
 * la primera emisión real (B-04, B-05):
 *   · el botón para agregar una segunda línea (VSV emite siempre una),
 *   · los campos de totales que se leen antes de firmar (EFXP_MNT_NETO,
 *     EFXP_IVA, EFXP_MNT_TOTAL; VSV no los lee),
 *   · que el portal redondee el IVA como `ivaDeNeto` de core.
 * Si alguno está mal, el robot no firma: se detiene con "No se pudo leer el
 * total" o "El portal no mostró la línea 2" y dice en qué página quedó.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OpcionesPortal {
  /** Empresas que ofrece la cuenta; con una sola, el SII no pregunta. */
  empresas?: Array<{ rut: string; nombre: string }>;
  /** El portal suma $1 más que la base: el robot no debe firmar. */
  totalDistinto?: boolean;
  /** Después de firmar, la página no muestra el folio. */
  sinFolio?: boolean;
  folio?: number;
}

export interface Firma {
  campos: Record<string, string>;
  lineas: Array<{ nombre: string; cantidad: string; unidad: string; precio: string; descripcion: string }>;
}

export interface PortalSimulado {
  url: string;
  logins: Array<{ rut: string; clave: string }>;
  empresaElegida: string | null;
  firmas: Firma[];
  pdfsPedidos: number;
  salidas: number;
  cerrar(): Promise<void>;
}

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32), Buffer.from('\n%%EOF')]);

const pagina = (titulo: string, cuerpo: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title></head><body>${cuerpo}</body></html>`;

function cookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => c.split('=') as [string, string]));
}

async function cuerpo(req: http.IncomingMessage): Promise<URLSearchParams> {
  let s = '';
  for await (const trozo of req) s += trozo;
  return new URLSearchParams(s);
}

function lineaHtml(n: string) {
  return `<tr id="linea_${n}">
    <td><input name="EFXP_NMB_${n}" size="30"></td>
    <td><input name="EFXP_QTY_${n}" size="6"></td>
    <td><input name="EFXP_UNMD_${n}" size="4"></td>
    <td><input name="EFXP_PRC_${n}" size="10"></td>
    <td><input type="checkbox" name="DESCRIP_${n}"
               onclick="document.querySelector('[name=EFXP_DSC_ITEM_${n}]').style.display = this.checked ? '' : 'none'"></td>
    <td><textarea name="EFXP_DSC_ITEM_${n}" style="display:none"></textarea></td>
  </tr>`;
}

function formulario(rut: string, dv: string, o: OpcionesPortal) {
  // El SII valida el RUT con AJAX y RECARGA el formulario: el robot tiene que esperarlo.
  const script = `
    const dos = (n) => String(n).padStart(2, '0');
    document.getElementById('EFXP_DV_RECEP').addEventListener('change', () => {
      const r = document.getElementById('EFXP_RUT_RECEP').value, d = document.getElementById('EFXP_DV_RECEP').value;
      if (r && d) setTimeout(() => { location.href = location.pathname + '?OPCION=33&TIPO=4&rut=' + r + '&dv=' + d; }, 300);
    });
    function agregarLinea() {
      const n = document.querySelectorAll('#detalle tr').length + 1;
      const t = document.createElement('tbody');
      t.innerHTML = ${JSON.stringify(lineaHtml('@@'))}.replaceAll('@@', dos(n));
      document.getElementById('detalle').appendChild(t.firstElementChild);
    }
    function calcular() {
      let neto = 0;
      document.querySelectorAll('#detalle tr').forEach((tr, i) => {
        const q = parseFloat(document.querySelector('[name=EFXP_QTY_' + dos(i + 1) + ']').value || '0');
        const p = parseFloat(document.querySelector('[name=EFXP_PRC_' + dos(i + 1) + ']').value || '0');
        neto += Math.round(q * p);
      });
      const iva = Math.round(neto * 19 / 100);
      const miles = (n) => n.toLocaleString('es-CL');
      document.querySelector('[name=EFXP_MNT_NETO]').value = miles(neto);
      document.querySelector('[name=EFXP_IVA]').value = miles(iva);
      document.querySelector('[name=EFXP_MNT_TOTAL]').value = miles(neto + iva + ${o.totalDistinto ? 1 : 0});
      document.querySelector('[name=btnSign]').disabled = false;
    }`;
  return pagina('Emisión de Factura Electrónica', `
    <form id="f" method="POST" action="/firmar">
      <input id="EFXP_RUT_RECEP" name="EFXP_RUT_RECEP" value="${rut}">
      <input id="EFXP_DV_RECEP" name="EFXP_DV_RECEP" value="${dv}" size="1">
      <input name="EFXP_RZN_SOC_RECEP" value="${rut ? 'RAZÓN SOCIAL QUE TRAE EL SII' : ''}" readonly>
      <input name="EFXP_CIUDAD_ORIGEN"><input name="EFXP_CIUDAD_RECEP"><input name="EFXP_CONTACTO">
      <table><tbody id="detalle">${lineaHtml('01')}</tbody></table>
      <input type="button" value="Agregar línea" onclick="agregarLinea()">
      <select name="EFXP_FMA_PAGO"><option value="1">Contado</option><option value="2">Crédito</option></select>
      <input name="EFXP_MNT_NETO" readonly><input name="EFXP_IVA" readonly><input name="EFXP_MNT_TOTAL" readonly>
      <button type="button" name="Button_Update" onclick="calcular()">Validar y visualizar</button>
      <input type="button" name="btnSign" value="Firmar" disabled
             onclick="document.getElementById('firma').style.display = ''">
      <div id="firma" style="display:none">
        <input type="password" id="myPass" name="myPass">
        <button type="button" id="btnFirma" onclick="document.getElementById('f').submit()">Firmar</button>
      </div>
    </form><script>${script}</script>`);
}

export async function levantarPortal(o: OpcionesPortal = {}): Promise<PortalSimulado> {
  const empresas = o.empresas ?? [{ rut: '76086428-5', nombre: 'EMPRESA QA SPA' }];
  const folio = o.folio ?? 4567;
  const estado: PortalSimulado = {
    url: '', logins: [], empresaElegida: empresas.length === 1 ? empresas[0].rut : null,
    firmas: [], pdfsPedidos: 0, salidas: 0, cerrar: async () => {},
  };

  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const c = cookies(req);
    const html = (s: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(s); };
    const ir = (a: string, cookie?: string) => {
      res.writeHead(302, { location: a, ...(cookie ? { 'set-cookie': `${cookie}; Path=/` } : {}) });
      res.end();
    };
    const emision = '/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=33&TIPO=4';

    if (u.pathname === '/cgi-bin/Portal001/mipeLaunchPage.cgi') {
      if (!c.sesion) {
        return html(pagina('Autenticación', `<form method="POST" action="/login">
          <input id="rutcntr" name="rutcntr"><input id="clave" name="clave" type="password">
          <button id="bt_ingresar" type="submit">Ingresar</button></form>`));
      }
      if (!c.empresa && empresas.length > 1) {
        return html(pagina('Selección de empresa', `<form method="POST" action="/elegir">
          <select name="RUT_EMP"><option value="">Seleccione</option>${empresas
            .map((e) => `<option value="${e.rut}">${e.nombre} ${e.rut}</option>`).join('')}</select>
          <input type="submit" name="btnContinuar" value="Continuar"></form>`));
      }
      return html(formulario(u.searchParams.get('rut') ?? '', u.searchParams.get('dv') ?? '', o));
    }
    if (u.pathname === '/login' && req.method === 'POST') {
      const b = await cuerpo(req);
      estado.logins.push({ rut: b.get('rutcntr') ?? '', clave: b.get('clave') ?? '' });
      return ir(emision, 'sesion=1');
    }
    if (u.pathname === '/elegir' && req.method === 'POST') {
      estado.empresaElegida = (await cuerpo(req)).get('RUT_EMP');
      return ir(emision, 'empresa=1');
    }
    if (u.pathname === '/firmar' && req.method === 'POST') {
      const b = await cuerpo(req);
      const campos = Object.fromEntries(b.entries());
      const lineas = [];
      for (let n = 1; b.has(`EFXP_NMB_${String(n).padStart(2, '0')}`); n++) {
        const k = String(n).padStart(2, '0');
        lineas.push({ nombre: b.get(`EFXP_NMB_${k}`) ?? '', cantidad: b.get(`EFXP_QTY_${k}`) ?? '',
          unidad: b.get(`EFXP_UNMD_${k}`) ?? '', precio: b.get(`EFXP_PRC_${k}`) ?? '',
          descripcion: b.get(`EFXP_DSC_ITEM_${k}`) ?? '' });
      }
      estado.firmas.push({ campos, lineas });
      return html(pagina('Documento emitido', o.sinFolio
        ? '<p>Su documento está siendo procesado. Intente más tarde.</p>'
        : `<p>Se ha emitido correctamente la Factura Electrónica N° ${folio}.</p>`));
    }
    if (u.pathname === '/cgi-bin/Portal001/mipeAdminDocsEmi.cgi') {
      const f = u.searchParams.get('FOLIO');
      return html(pagina('Documentos emitidos', `<table><tbody>
        <tr><td><a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?CODIGO=OTRO">ver</a></td><td></td><td></td>
            <td>Factura Exenta Electrónica</td><td>${f}</td></tr>
        <tr><td><a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?CODIGO=COD${f}">ver</a></td><td></td><td></td>
            <td>Factura Electrónica</td><td>${f}</td></tr></tbody></table>`));
    }
    if (u.pathname === '/cgi-bin/Portal001/mipeDisplayPDF.cgi') {
      if (!c.sesion || u.searchParams.get('DHDR_CODIGO') !== `COD${folio}`) return html(pagina('Error', 'Sesión expirada'));
      estado.pdfsPedidos++;
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return res.end(PDF);
    }
    if (u.pathname === '/cgi_misii/siu/cgi_misii_logout') {
      estado.salidas++;
      return html(pagina('Sesión cerrada', 'Adiós'));
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  estado.url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  estado.cerrar = () => new Promise<void>((ok) => { servidor.closeAllConnections(); servidor.close(() => ok()); });
  return estado;
}
