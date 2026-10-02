/**
 * Lo que `authenticated` puede ejecutar, escrito a mano: la definición de "la
 * base quedó cerrada". Si alguien crea una función `security definer` y olvida
 * cerrarla, la lista deja de coincidir y se nota.
 *
 * La usan `tools/pg-test/seguridad.test.mjs` (contra la réplica) y
 * `tools/aplicar-esquema.mjs` (contra Supabase). Antes eran dos copias, y la
 * del instalador se quedó en 0026: al aplicar 0029 y 0030 habría dicho que la
 * base NO quedó bien por funciones que sí tienen que estar.
 */
export const RPC_PERMITIDAS = [
  'current_store_id', 'current_tenant_id', 'current_user_role', 'is_active_user',
  'fn_add_cash_movement', 'fn_adjust_stock', 'fn_apply_stock_count',
  'fn_cash_session_summary', 'fn_close_cash_session', 'fn_confirm_receipt',
  'fn_create_product', 'fn_open_cash_session', 'fn_register_sale',
  'fn_transfer_stock', 'fn_update_product', 'fn_void_receipt', 'fn_void_sale', 'fn_write_off_lot',
  // 0018 · ofertas e impuestos adicionales
  'fn_asignar_impuesto', 'fn_guardar_configuracion', 'fn_guardar_impuesto', 'fn_guardar_precios_producto',
  // 0019 · documentos tributarios y devoluciones
  'fn_devolver_venta', 'fn_guardar_emisor',
  // 0021 · ofertas a muchos productos
  'fn_aplicar_oferta_masiva', 'fn_quitar_ofertas',
  // 0022 · clientes
  'fn_guardar_cliente', 'fn_guardar_precios_cliente',
  // 0023 · combos
  'fn_guardar_combo',
  // 0026 · facturación
  'fn_activar_emision_sii', 'fn_anular_factura_recibida', 'fn_descartar_factura', 'fn_emitir_factura_manual',
  'fn_estado_emision_sii', 'fn_nota_credito_factura', 'fn_registrar_factura_recibida', 'fn_reintentar_factura',
  // 0029 · fiado
  'fn_abonar_cuenta', 'fn_tope_credito',
  // 0030 · cuentas por pagar
  'fn_anular_factura_proveedor', 'fn_pagar_factura_proveedor', 'fn_registrar_factura_proveedor',
  // 0035 · devolución a proveedor
  'fn_devolver_a_proveedor',
  // 0036 · descuento autorizado con PIN
  'fn_autorizadores', 'fn_autorizar_descuento', 'fn_guardar_pin',
].sort();
