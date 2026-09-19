/**
 * Qué documento corresponde emitir por una venta (RF-M5-16, reunión 2026-09-19).
 *
 * El cliente lo planteó así, y describe cómo funciona hoy su mostrador:
 *
 *   · Con efectivo o transferencia se entrega **boleta** y el ticket.
 *   · Con tarjeta el documento lo emite la **máquina** —el terminal integrado
 *     de la adquirente—, y al cliente se le entrega ese **voucher**. Emitir
 *     otra boleta por la misma venta sería declararla dos veces.
 *   · La **factura** es siempre una elección explícita del cajero, para
 *     cualquier medio de pago, y exige los datos del receptor.
 *
 * Que la tarjeta emita en la máquina es una característica del terminal, no
 * una ley: un local con una máquina no integrada sí tiene que emitir la
 * boleta. Por eso es un valor de `tenants.settings` y no una constante
 * (regla 13).
 *
 * **Lo que este módulo NO hace:** emitir el documento ante el SII. Eso pide
 * certificado digital y folios CAF (B-04 y B-05, `docs/18`). Acá se decide y
 * se registra *qué* documento corresponde; el timbre viene después y no
 * cambia estas reglas.
 */
import { isValidRut, formatRut } from './rut.js';

export type TipoDocumento = 'boleta' | 'factura' | 'voucher';

/** Datos del receptor. Solo la factura los exige; la boleta va sin nombre. */
export interface ReceptorDocumento {
  rut: string;
  razonSocial: string;
  giro?: string;
  direccion?: string;
}

export interface DocumentoVenta {
  tipo: TipoDocumento;
  receptor?: ReceptorDocumento | null;
}

export const NOMBRE_DOCUMENTO: Record<TipoDocumento, string> = {
  boleta: 'Boleta',
  factura: 'Factura',
  voucher: 'Voucher de la máquina',
};

/** Medios de pago que pasan por el terminal de la adquirente. */
const METODOS_CON_MAQUINA = new Set(['debito', 'credito']);

export interface OpcionesDocumento {
  /**
   * `true` si el terminal de tarjetas de este local emite la boleta.
   * `tenants.settings.tarjeta_emite_documento`.
   */
  tarjetaEmiteDocumento: boolean;
}

export const OPCIONES_DOCUMENTO_POR_OMISION: OpcionesDocumento = {
  tarjetaEmiteDocumento: true,
};

export function pagadaConTarjeta(pagos: Array<{ metodo?: string; method?: string }>): boolean {
  return pagos.some((p) => METODOS_CON_MAQUINA.has(String(p.metodo ?? p.method ?? '')));
}

/**
 * Tipos que el cajero puede elegir para estos pagos, en el orden en que se le
 * ofrecen. El primero es el que queda marcado.
 */
export function documentosDisponibles(
  pagos: Array<{ metodo?: string; method?: string }>,
  opciones: OpcionesDocumento = OPCIONES_DOCUMENTO_POR_OMISION,
): TipoDocumento[] {
  return enMaquina(pagos, opciones)
    ? ['voucher', 'factura']
    : ['boleta', 'factura'];
}

/** El documento que corresponde si el cajero no elige otro. Siempre el primero. */
export function documentoPorOmision(
  pagos: Array<{ metodo?: string; method?: string }>,
  opciones: OpcionesDocumento = OPCIONES_DOCUMENTO_POR_OMISION,
): TipoDocumento {
  return documentosDisponibles(pagos, opciones)[0];
}

/**
 * Valida el documento contra los pagos. Devuelve el mensaje en lenguaje del
 * negocio, nunca técnico, porque llega tal cual al cajero.
 */
export function validarDocumento(
  documento: DocumentoVenta,
  pagos: Array<{ metodo?: string; method?: string }>,
  opciones: OpcionesDocumento = OPCIONES_DOCUMENTO_POR_OMISION,
): { valido: true } | { valido: false; error: string } {
  const disponibles = documentosDisponibles(pagos, opciones);

  if (!disponibles.includes(documento.tipo)) {
    if (documento.tipo === 'voucher') {
      return { valido: false, error: 'El voucher lo emite la máquina de tarjetas: esta venta no se cobró con tarjeta.' };
    }
    return {
      valido: false,
      error: 'Con tarjeta el documento lo emite la máquina. Si necesitas boleta, cobra en efectivo o por transferencia.',
    };
  }

  if (documento.tipo !== 'factura') return { valido: true };

  const receptor = documento.receptor;
  if (!receptor || !String(receptor.razonSocial ?? '').trim()) {
    return { valido: false, error: 'Para hacer una factura falta el nombre o razón social del cliente.' };
  }
  if (!isValidRut(String(receptor.rut ?? ''))) {
    return { valido: false, error: 'El RUT del cliente no es válido. Revísalo antes de emitir la factura.' };
  }
  return { valido: true };
}

/** Deja el receptor listo para guardar: RUT con puntos y guion, sin espacios sobrantes. */
export function normalizarReceptor(receptor: ReceptorDocumento): ReceptorDocumento {
  const limpiar = (v: string | undefined) => {
    const t = String(v ?? '').trim();
    return t === '' ? undefined : t;
  };
  return {
    rut: formatRut(receptor.rut),
    razonSocial: String(receptor.razonSocial ?? '').trim(),
    giro: limpiar(receptor.giro),
    direccion: limpiar(receptor.direccion),
  };
}

function enMaquina(
  pagos: Array<{ metodo?: string; method?: string }>,
  opciones: OpcionesDocumento,
): boolean {
  return opciones.tarjetaEmiteDocumento && pagadaConTarjeta(pagos);
}
