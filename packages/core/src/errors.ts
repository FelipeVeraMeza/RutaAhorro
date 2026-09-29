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
  // 0026 · Facturación
  SIN_PERMISO_FACTURAR: 'Solo el administrador o un supervisor pueden facturar',
  FALTA_IDENTIFICADOR: 'No se pudo identificar la factura. Vuelve a intentarlo',
  FORMA_PAGO_INVALIDA: 'La forma de pago tiene que ser contado o crédito',
  FACTURA_SIN_LINEAS: 'La factura necesita al menos una línea',
  FACTURA_DEMASIADAS_LINEAS: 'El SII admite hasta 60 líneas por factura',
  FACTURA_EN_CERO: 'La factura no puede quedar en $0',
  GIRO_RECEPTOR_REQUERIDO: 'Falta el giro del cliente: el SII lo exige en una factura',
  DIRECCION_RECEPTOR_REQUERIDA: 'Falta la dirección o la comuna del cliente: el SII las exige en una factura',
  CANTIDAD_ENTERA: 'Ese producto se vende entero: la cantidad no puede tener decimales',
  LINEA_SIN_NOMBRE: 'Una línea libre necesita decir qué se factura',
  DESCUENTO_MAYOR_QUE_LINEA: 'El descuento de una línea no puede ser mayor que la línea',
  FACTURA_NO_ENCONTRADA: 'No se encontró esa factura',
  FACTURA_NO_EMITIDA: 'Esa factura todavía no está emitida en el SII: no lleva nota de crédito, se descarta',
  NOTA_CREDITO_REAL_NO_DISPONIBLE: 'Esta factura se emitió en el SII: su nota de crédito se emite en el portal del SII por ahora',
  FACTURA_NO_REINTENTABLE: 'Solo se reintenta una factura que quedó con error',
  FACTURA_NO_DESCARTABLE: 'Solo se descarta una factura que no llegó al SII (en cola o con error)',
  FACTURA_RECIBIDA_DUPLICADA: 'Esa factura de ese proveedor ya está registrada',
  FACTURA_RECIBIDA_NO_ENCONTRADA: 'No se encontró esa factura recibida, o ya estaba anulada',
  TIPO_DOCUMENTO_INVALIDO: 'Elige el tipo de documento',
  FOLIO_INVALIDO: 'El folio tiene que ser un número mayor que cero',
  EXENTA_CON_IVA: 'Una factura exenta no lleva IVA',
  FECHA_INVALIDA: 'La fecha no puede ser futura',
  PROVEEDOR_NO_ENCONTRADO: 'No se encontró ese proveedor',
  FALTAN_CREDENCIALES_SII: 'Primero guarda la clave del SII y la del certificado',
  FALTA_ENSAYO_SII: 'Antes de encender, hay que hacer el ensayo en el portal del SII con estas credenciales (sin firmar)',
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
  STOCK_INSUFICIENTE_EN_UBICACION: 'No hay tanto en ese lugar para traspasar',
  TRASPASO_MISMA_UBICACION: 'El origen y el destino del traspaso son el mismo lugar',
  CAJA_NO_ABIERTA_DEVOLUCION: 'Para devolver en efectivo abre tu caja: la plata sale de ahí',
  NO_DISPONIBLE_EN_DEMO: 'Esto no está disponible en el modo demo',
  PRODUCTO_NO_ENCONTRADO: 'No encontramos ese producto',
  PRODUCTO_INACTIVO: 'Ese producto está desactivado',
  CODIGO_DUPLICADO: 'Ese código ya pertenece a otro producto',
  PAGO_NO_CUADRA: 'El monto pagado no coincide con el total',
  DESCUENTO_EXCEDE_LIMITE: 'El descuento (o un precio más bajo que el normal) supera tu límite autorizado',
  // 0018 · ofertas e impuestos adicionales
  OFERTA_NO_ES_MAS_BARATA: 'El precio de la oferta tiene que ser menor que el precio normal',
  TRAMO_INVALIDO: 'Revisa la oferta: la cantidad tiene que ser 1 o más y el precio mayor que cero',
  OFERTA_SIN_FECHAS_DESDE_1: 'Una oferta desde 1 unidad necesita fechas. Si es permanente, cambia el precio normal',
  FECHAS_INVERTIDAS: 'La fecha de término de la oferta es anterior a la de inicio',
  TRAMO_REPETIDO: 'Hay dos ofertas con la misma cantidad y las mismas fechas',
  PORCENTAJE_INVALIDO: 'El porcentaje de la oferta tiene que estar entre 0 y 100, con hasta dos decimales',
  SIN_PRODUCTOS: 'Elige al menos un producto',
  // 0024 · stock inicial de un perecible
  PRODUCTO_CAMBIO_MIENTRAS_EDITABAS: 'Otra persona cambió este producto mientras lo editabas. Recarga para ver sus cambios',
  VENCIMIENTO_PASADO: 'Esa fecha de vencimiento ya pasó: no se puede ingresar mercadería vencida',
  // 0022 · clientes
  CLIENTE_NO_ENCONTRADO: 'Ese cliente no existe o está desactivado',
  NOMBRE_CLIENTE_REQUERIDO: 'El cliente necesita un nombre o razón social',
  CLIENTE_RUT_DUPLICADO: 'Ya hay un cliente con ese RUT',
  PRECIO_CLIENTE_INVALIDO: 'El precio especial tiene que ser un monto mayor que cero',
  // 0023 · combos
  NOMBRE_COMBO_REQUERIDO: 'El combo necesita un nombre',
  COMBO_INVALIDO: 'Revisa el combo: el precio y las cantidades tienen que ser mayores que cero',
  COMBO_UN_SOLO_PRODUCTO: 'Un combo lleva al menos dos productos distintos. Para uno solo, usa una oferta por cantidad',
  COMBO_PRODUCTO_REPETIDO: 'Hay un producto repetido en el combo: súmale la cantidad',
  COMBO_NO_ES_MAS_BARATO: 'El combo tiene que costar menos que sus productos por separado',
  COMBO_NO_ENCONTRADO: 'No encontramos ese combo',
  DEMASIADOS_PRODUCTOS: 'Son demasiados productos de una vez: hazlo por categoría, de a 5.000 como máximo',
  TASA_INVALIDA: 'La tasa tiene que ser un porcentaje entre 0 y 100',
  IMPUESTO_DUPLICADO: 'Ya existe un impuesto con ese nombre',
  NOMBRE_IMPUESTO_REQUERIDO: 'El impuesto necesita un nombre',
  IMPUESTO_NO_ENCONTRADO: 'No encontramos ese impuesto',
  CONFIGURACION_INVALIDA: 'Uno de los valores de la configuración no es válido',
  // 0019 · documentos tributarios y devoluciones
  VENTA_CON_DOCUMENTO_USAR_DEVOLUCION: 'Esta venta tiene boleta o factura: no se anula, se devuelve con nota de crédito',
  VENTA_CON_DEVOLUCIONES: 'Esta venta ya tiene devoluciones: devuelve lo que queda en vez de anularla',
  SIN_PERMISO_DEVOLVER: 'Solo un administrador o supervisor puede hacer devoluciones',
  REEMBOLSO_INVALIDO: 'Elige cómo se le devuelve la plata al cliente',
  CANTIDAD_A_DEVOLVER_INVALIDA: 'No se puede devolver más de lo que se vendió',
  NADA_QUE_DEVOLVER: 'No queda nada por devolver en esta venta',
  RUT_EMISOR_INVALIDO: 'El RUT del emisor no es válido',
  DATOS_EMISOR_INCOMPLETOS: 'Faltan datos del emisor: razón social, giro, dirección y comuna',
  AMBIENTE_NO_DISPONIBLE: 'Emitir ante el SII necesita el certificado digital y los folios (CAF). Por ahora, solo simulación',
  EMISOR_SIN_CONFIGURAR: 'Faltan los datos del emisor para emitir documentos',
  SIN_FOLIOS: 'Se acabaron los folios autorizados por el SII para este documento',
  MOTIVO_REQUERIDO: 'Debes indicar un motivo',
  NO_TE_PUEDES_QUITAR_EL_ROL: 'No puedes cambiarte el rol ni desactivarte a ti mismo',
  ULTIMO_ADMIN: 'Es el único administrador activo del local. Nombra a otro antes de quitarle el rol',
  CORREO_YA_REGISTRADO: 'Ese correo ya tiene un usuario en el local',
  VENTA_VACIA: 'Agrega al menos un producto antes de cobrar',
  DOCUMENTO_LO_EMITE_LA_MAQUINA: 'Con tarjeta el documento lo emite la máquina. Si necesitas boleta, cobra en efectivo o por transferencia',
  VOUCHER_SIN_TARJETA: 'El voucher lo emite la máquina de tarjetas: esta venta no se cobró con tarjeta',
  RAZON_SOCIAL_REQUERIDA: 'Para hacer una factura falta el nombre o razón social del cliente',
  RUT_INVALIDO: 'El RUT del cliente no es válido. Revísalo antes de emitir la factura',
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
      if (detail && code === 'STOCK_INSUFICIENTE_EN_UBICACION') return `No hay tanto de ${detail} en ese lugar para traspasar`;
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
      if (detail && code === 'CANTIDAD_ENTERA') return `"${detail}" se vende entero: la cantidad no puede tener decimales`;
      if (code === 'PRODUCTO_CAMBIO_MIENTRAS_EDITABAS') {
        return `${detail || 'Otra persona'} cambió este producto mientras lo editabas. Recarga para ver sus cambios antes de guardar los tuyos`;
      }
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
