/**
 * Códigos de error del dominio y su traducción a lenguaje del negocio.
 *
 * RNF-20: el cajero ve "No hay stock suficiente de Coca-Cola 1.5L", nunca
 * "constraint violation" ni un código en inglés. La base de datos lanza estos
 * códigos y esta tabla los convierte en algo que una persona apurada entiende.
 */

export const ERROR_MESSAGES: Record<string, string> = {
  NO_AUTENTICADO: 'Tu sesión expiró. Vuelve a ingresar',
  SIN_PERMISO: 'No tienes permiso para esta acción',
  SIN_PERMISO_ANULAR: 'No tienes permiso para anular esta venta',
  SIN_PERMISO_AJUSTAR: 'No tienes permiso para ajustar el stock',
  SIN_PERMISO_CREAR_PRODUCTO: 'No tienes permiso para crear productos',
  NOMBRE_REQUERIDO: 'El producto necesita un nombre',
  MONTO_NEGATIVO: 'El precio y el costo no pueden ser negativos',
  CANTIDAD_NEGATIVA: 'La cantidad no puede ser negativa',
  DIAS_ALERTA_REQUERIDOS: 'Un producto perecible necesita cuántos días antes avisar',
  CODIGO_EN_USO: 'Ese código de barra ya está en otro producto',
  SIN_TIENDA: 'No hay ninguna tienda activa para registrar el stock',
  CAJA_NO_ABIERTA: 'Debes abrir caja antes de vender',
  CAJA_YA_ABIERTA: 'Ya tienes una caja abierta',
  CAJA_YA_CERRADA: 'Esta caja ya fue cerrada',
  STOCK_INSUFICIENTE: 'No hay stock suficiente de este producto',
  PRODUCTO_NO_ENCONTRADO: 'No encontramos ese producto',
  PRODUCTO_INACTIVO: 'Ese producto está desactivado',
  CODIGO_DUPLICADO: 'Ese código ya pertenece a otro producto',
  PAGO_NO_CUADRA: 'El monto pagado no coincide con el total',
  DESCUENTO_EXCEDE_LIMITE: 'El descuento supera tu límite autorizado',
  MOTIVO_REQUERIDO: 'Debes indicar un motivo',
  VENTA_VACIA: 'Agrega al menos un producto antes de cobrar',
  VENTA_NO_ENCONTRADA: 'No encontramos esa venta',
  VENTA_YA_ANULADA: 'Esta venta ya estaba anulada',
  RECEPCION_YA_ANULADA: 'Esta recepción ya estaba anulada',
  VENCIMIENTO_REQUERIDO: 'Este producto es perecible: indica la fecha de vencimiento',
  LOTE_YA_VENCIDO: 'No puedes recibir un producto que ya está vencido',
  TOMA_YA_APLICADA: 'Esta toma de inventario ya fue aplicada',
  TIPO_MOVIMIENTO_INVALIDO: 'Tipo de movimiento no válido',
  CANTIDAD_INVALIDA: 'La cantidad ingresada no es válida',
  REGISTRO_INMUTABLE: 'Este registro no se puede modificar ni eliminar',
  NO_ENCONTRADO: 'No encontramos lo que buscas',
  LIMITE_PETICIONES: 'Demasiados intentos. Espera un momento',
  ERROR_INTERNO: 'Ocurrió un problema. Ya fuimos notificados',
};

/**
 * Traduce el error que devuelve Supabase a un mensaje para el usuario.
 * Los errores de la base llegan como "CODIGO: detalle" — por ejemplo
 * "STOCK_INSUFICIENTE: Coca-Cola 1.5L" — y aprovechamos el detalle para que el
 * mensaje nombre el producto concreto.
 */
export function toUserMessage(error: unknown): string {
  if (!error) return ERROR_MESSAGES.ERROR_INTERNO;

  const raw =
    typeof error === 'string'
      ? error
      : ((error as { message?: string }).message ?? '');

  const match = raw.match(/([A-Z_]{4,})(?::\s*(.*))?/);
  if (match) {
    const [, code, detail] = match;
    const base = ERROR_MESSAGES[code];
    if (base) {
      if (detail && code === 'STOCK_INSUFICIENTE') return `No hay stock suficiente de ${detail}`;
      if (detail && code === 'CODIGO_EN_USO') {
        // El detalle viene como "<codigo>:<nombre del producto que lo tiene>".
        // Decir cuál producto lo ocupa evita que el usuario busque a ciegas.
        const [codigo, ...resto] = detail.split(':');
        const duenio = resto.join(':').trim();
        return duenio
          ? `El código ${codigo} ya está en "${duenio}"`
          : `El código ${codigo} ya está en otro producto`;
      }
      if (detail && code === 'PRODUCTO_INACTIVO') return `"${detail}" está desactivado`;
      if (detail && code === 'VENCIMIENTO_REQUERIDO') return `"${detail}" es perecible: indica la fecha de vencimiento`;
      if (detail && code === 'LOTE_YA_VENCIDO') return `"${detail}" ya está vencido, no puede recibirse`;
      return base;
    }
  }

  // Errores conocidos de Postgres que no son nuestros
  if (raw.includes('duplicate key') && raw.includes('barcode')) {
    return ERROR_MESSAGES.CODIGO_DUPLICADO;
  }
  if (raw.includes('JWT') || raw.includes('expired')) {
    return ERROR_MESSAGES.NO_AUTENTICADO;
  }

  return ERROR_MESSAGES.ERROR_INTERNO;
}

export function errorCode(error: unknown): string | null {
  const raw = typeof error === 'string' ? error : ((error as { message?: string })?.message ?? '');
  const match = raw.match(/([A-Z_]{4,})/);
  return match && ERROR_MESSAGES[match[1]] ? match[1] : null;
}
