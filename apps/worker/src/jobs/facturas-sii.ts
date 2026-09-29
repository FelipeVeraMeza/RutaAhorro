import { descifrar, planFacturaPortal, type LineaParaPortal } from '@rutaahorro/core';
import { admin, recordJobRun } from '../supabase.js';
import { env } from '../env.js';
import { log } from '../logger.js';
import { emitirEnPortal, ErrorDespuesDeFirmar } from '../sii/portal.js';

/**
 * La cola del emisor real (0026): toma las facturas "por_emitir" y las emite
 * con el robot del portal del SII.
 *
 * Está APAGADA por diseño hasta que el cliente entregue su clave tributaria y
 * la del certificado (B-04, B-05). Tres llaves, las tres necesarias:
 *   · SII_CLAVE_CIFRADO en el worker (sin ella no se descifran las claves)
 *   · CHROME_PATH en el worker (el Chromium del contenedor)
 *   · "Emitir en el SII" encendido en /facturacion por el administrador, con
 *     las credenciales guardadas (fn_emision_sii_activa)
 * Si falta cualquiera, no se emite nada y las facturas se emiten simuladas.
 *
 * Una factura a la vez: el portal del SII no soporta sesiones en paralelo de
 * la misma cuenta, y un error a medias con dos robots es imposible de seguir.
 */

const MENSAJES: Record<string, string> = {
  PORTAL_SIN_IMPUESTO_ADICIONAL:
    'Esta factura tiene productos con impuesto adicional (IABA/ILA). El robot todavía no los emite: '
    + 'emítela a mano en el portal del SII y descártala acá.',
  PORTAL_MONTOS_NO_CUADRAN: 'Los montos de la factura no cuadran; no se envió al SII.',
  PORTAL_LINEAS_FUERA_DE_RANGO: 'El SII admite entre 1 y 60 líneas por factura.',
  CIFRADO_INVALIDO: 'No se pudieron descifrar las credenciales del SII: vuelve a guardarlas en Facturación.',
  LLAVE_CIFRADO_INVALIDA: 'La llave SII_CLAVE_CIFRADO del worker no es válida.',
};
const mensaje = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return MENSAJES[m] ?? m;
};

let ocupado = false;

/** ¿Está el worker preparado para emitir? No dice si algún local lo encendió. */
export function emisionRealConfigurada(): boolean {
  return Boolean(env.siiClaveCifrado && env.chromePath);
}

async function emitirUna(): Promise<'nada' | 'emitida' | 'error'> {
  const { data: f, error } = await admin.rpc('fn_sii_tomar_factura');
  if (error) throw new Error(`No se pudo leer la cola de facturas: ${error.message}`);
  if (!f) return 'nada';

  const factura = f as {
    id: string; numero: number; neto: number; iva: number; total: number; forma_pago: 'contado' | 'credito';
    receptor: { rut: string; razon_social: string; ciudad?: string; correo?: string; contacto?: string };
    emisor: { ciudad?: string | null };
    lineas_sii: LineaParaPortal[];
    credenciales: { tenant_id: string; rut_usuario: string; clave_sii: string; clave_certificado: string; rut_empresa: string };
  };
  const tenant = factura.credenciales.tenant_id;

  const resultado = await recordJobRun('facturas-sii', async () => {
    try {
      const plan = planFacturaPortal(factura.lineas_sii, factura.neto, factura.iva, factura.total);
      const [claveSii, claveCertificado] = await Promise.all([
        descifrar(factura.credenciales.clave_sii, env.siiClaveCifrado),
        descifrar(factura.credenciales.clave_certificado, env.siiClaveCifrado),
      ]);
      const r = await emitirEnPortal(
        { receptor: factura.receptor, ciudadEmisor: factura.emisor?.ciudad, formaPago: factura.forma_pago, plan },
        { rutUsuario: factura.credenciales.rut_usuario, claveSii, claveCertificado, rutEmpresa: factura.credenciales.rut_empresa },
        { chromePath: env.chromePath, alPaso: (t) => log.info('Factura SII', { numero: factura.numero, paso: t }) },
      );

      let pdfPath: string | null = null;
      if (r.pdf) {
        // Bucket privado; el servidor web entrega el PDF con un enlace firmado.
        await admin.storage.createBucket('facturas', { public: false }).catch(() => {});
        pdfPath = `${tenant}/F33-${r.folio}.pdf`;
        const { error: eSubir } = await admin.storage.from('facturas')
          .upload(pdfPath, r.pdf, { contentType: 'application/pdf', upsert: true });
        if (eSubir) pdfPath = null; // la factura igual está emitida
      }
      const { error: eReg } = await admin.rpc('fn_sii_registrar_emision', {
        p_factura: factura.id, p_folio: r.folio, p_pdf_path: pdfPath });
      if (eReg) {
        // Emitida en el SII y no registrada acá: queda "emitiendo" y a los 15
        // minutos pasa a error pidiendo revisar el portal. Nunca se reintenta sola.
        throw new ErrorDespuesDeFirmar(`El SII emitió el folio ${r.folio}, pero no se pudo registrar: ${eReg.message}`);
      }
      return { factura: factura.numero, folio: r.folio, pdf: Boolean(pdfPath) };
    } catch (e) {
      await admin.rpc('fn_sii_registrar_error', { p_factura: factura.id, p_error: mensaje(e) });
      throw e;
    }
  });
  return resultado.ok ? 'emitida' : 'error';
}

/**
 * Corre cada minuto. Sin trabajo, sale enseguida y no escribe nada (un
 * registro por minuto en job_runs no le sirve a nadie): solo queda registro
 * de las facturas que de verdad se intentaron.
 */
export async function runFacturasSii(): Promise<Record<string, unknown>> {
  if (!emisionRealConfigurada()) return { apagado: true };
  if (ocupado) return { ocupado: true };
  ocupado = true;
  const cuenta = { emitidas: 0, errores: 0 };
  try {
    // Hasta 10 por vuelta: el resto espera al minuto siguiente.
    for (let i = 0; i < 10; i++) {
      const r = await emitirUna();
      if (r === 'nada') break;
      cuenta[r === 'emitida' ? 'emitidas' : 'errores']++;
    }
  } finally {
    ocupado = false;
  }
  return cuenta;
}
