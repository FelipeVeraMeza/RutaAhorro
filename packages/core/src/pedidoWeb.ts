/**
 * El pedido de la tienda online guardado en el sistema (docs/30, etapa 2;
 * docs/33). El cliente lo hace desde el carrito, queda con número y código de
 * seguimiento, y el personal lo mueve por sus estados en "Pedidos web".
 *
 * Lo de este archivo es puro y lo comparten la tienda, la pantalla del
 * personal y las pruebas. La base (0040) aplica las mismas reglas: lo de acá
 * es para avisar antes, no para confiar en el navegador.
 */
import { formatCLP } from './money.js';
import { enlaceWhatsApp, type DatosCliente } from './tienda.js';

export const ESTADOS_PEDIDO_WEB = ['recibido', 'preparando', 'listo', 'entregado', 'cancelado'] as const;
export type EstadoPedidoWeb = typeof ESTADOS_PEDIDO_WEB[number];

/** Cómo se llama cada estado, para el personal y para el cliente. */
export const NOMBRE_ESTADO_PEDIDO: Record<EstadoPedidoWeb, string> = {
  recibido: 'Recibido',
  preparando: 'En preparación',
  listo: 'Listo para retirar',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Lo que el cliente lee en el seguimiento. */
export const DETALLE_ESTADO_PEDIDO: Record<EstadoPedidoWeb, string> = {
  recibido: 'El local recibió tu pedido y lo va a preparar.',
  preparando: 'Están juntando tus productos.',
  listo: 'Tu pedido está listo. Puedes ir a retirarlo y pagar en el local.',
  entregado: 'Retiraste tu pedido. ¡Gracias por tu compra!',
  cancelado: 'El pedido se canceló.',
};

/** A qué estados puede pasar cada uno. Entregado y cancelado son finales. */
export const TRANSICIONES_PEDIDO: Record<EstadoPedidoWeb, readonly EstadoPedidoWeb[]> = {
  recibido: ['preparando', 'listo', 'cancelado'],
  preparando: ['listo', 'cancelado'],
  listo: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};

export function puedeCambiarEstado(de: EstadoPedidoWeb, a: EstadoPedidoWeb): boolean {
  return TRANSICIONES_PEDIDO[de]?.includes(a) ?? false;
}

export function esEstadoPedido(x: unknown): x is EstadoPedidoWeb {
  return typeof x === 'string' && (ESTADOS_PEDIDO_WEB as readonly string[]).includes(x);
}

/** El botón principal de cada estado en la pantalla del personal. */
export function accionPrincipal(estado: EstadoPedidoWeb): { a: EstadoPedidoWeb; texto: string } | null {
  switch (estado) {
    case 'recibido': return { a: 'preparando', texto: 'Empezar a preparar' };
    case 'preparando': return { a: 'listo', texto: 'Listo para retirar' };
    case 'listo': return { a: 'entregado', texto: 'Entregado' };
    default: return null;
  }
}

/** Topes del pedido. Los mismos que revisa la base. */
export const LIMITES_PEDIDO_WEB = { lineas: 60, cantidad: 99, nota: 300, nombre: 80 } as const;

export interface PedidoWebNuevo {
  cliente: DatosCliente;
  lineas: Array<{ id: string; cantidad: number }>;
  nota?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Qué está mal en el pedido antes de mandarlo, en palabras. Vacío = se puede
 * mandar. El servidor vuelve a revisar todo y calcula los precios él.
 */
export function validarPedidoWeb(p: PedidoWebNuevo): string[] {
  const errores: string[] = [];
  const nombre = (p.cliente?.nombre ?? '').trim();
  if (nombre.length < 2) errores.push('Escribe tu nombre');
  else if (nombre.length > LIMITES_PEDIDO_WEB.nombre) errores.push('El nombre es muy largo');
  if (!normalizarCelular(p.cliente?.celular)) errores.push('Escribe un celular chileno, ej. 9 1234 5678');
  const correo = (p.cliente?.correo ?? '').trim();
  if (correo && (correo.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))) errores.push('Revisa el correo');
  if (!Array.isArray(p.lineas) || p.lineas.length === 0) errores.push('El carrito está vacío');
  else if (p.lineas.length > LIMITES_PEDIDO_WEB.lineas) errores.push(`Un pedido lleva hasta ${LIMITES_PEDIDO_WEB.lineas} productos distintos`);
  else if (p.lineas.some((l) => !UUID.test(String(l.id)) || !Number.isInteger(l.cantidad) || l.cantidad < 1 || l.cantidad > LIMITES_PEDIDO_WEB.cantidad)) {
    errores.push(`Cada producto va de 1 a ${LIMITES_PEDIDO_WEB.cantidad} unidades`);
  }
  if ((p.nota ?? '').length > LIMITES_PEDIDO_WEB.nota) errores.push(`La nota tiene hasta ${LIMITES_PEDIDO_WEB.nota} letras`);
  return errores;
}

/**
 * El celular como lo guarda el pedido: "+56912345678". Acepta como lo
 * escriba la persona ("9 1234 5678", "+56 9 1234 5678"). Null si no es un
 * celular chileno.
 */
export function normalizarCelular(celular: string | null | undefined): string | null {
  const enlace = enlaceWhatsApp(celular, '');
  const d = enlace?.match(/wa\.me\/(\d+)/)?.[1];
  return d && /^569\d{8}$/.test(d) ? `+${d}` : null;
}

/** "+56912345678" → "+56 9 1234 5678", para mostrarlo. */
export function formatoCelular(celular: string): string {
  const d = celular.replace(/\D/g, '');
  return /^569\d{8}$/.test(d) ? `+56 9 ${d.slice(3, 7)} ${d.slice(7)}` : celular;
}

/**
 * El código de seguimiento: 8 letras y números sin los que se confunden
 * (0/O, 1/I/L). Es lo único que da acceso al seguimiento, así que no se
 * puede adivinar ni recorrer (no es el número correlativo).
 */
export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function esCodigoSeguimiento(c: unknown): c is string {
  return typeof c === 'string' && new RegExp(`^[${ALFABETO_CODIGO}]{8}$`).test(c);
}

/** El mensaje de WhatsApp que el personal le manda al cliente al cambiar el estado. */
export function mensajeEstadoCliente(p: {
  numero: number; estado: EstadoPedidoWeb; nombreCliente: string; local: string; direccion?: string | null; total: number;
  motivo?: string | null; enlace?: string | null;
}): string {
  const hola = `Hola ${p.nombreCliente.split(' ')[0]}, te escribimos de ${p.local}.`;
  const cuerpo = p.estado === 'listo'
    ? `Tu pedido N° ${p.numero} está listo para retirar${p.direccion ? ` en ${p.direccion}` : ''}. Total: ${formatCLP(p.total)} (pagas al retirar).`
    : p.estado === 'cancelado'
      ? `Tuvimos que cancelar tu pedido N° ${p.numero}${p.motivo ? `: ${p.motivo}` : ''}. Disculpa las molestias.`
      : p.estado === 'preparando'
        ? `Estamos preparando tu pedido N° ${p.numero}. Te avisamos cuando esté listo.`
        : `Recibimos tu pedido N° ${p.numero}. Total: ${formatCLP(p.total)}.`;
  return [hola, cuerpo, ...(p.enlace ? [`Puedes ver cómo va aquí: ${p.enlace}`] : [])].join(' ');
}

/** Para la pantalla del personal: "hace 5 min", "hace 2 h", "ayer". */
export function haceCuanto(desde: string | Date, ahora: Date = new Date()): string {
  const min = Math.max(0, Math.round((ahora.getTime() - new Date(desde).getTime()) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
