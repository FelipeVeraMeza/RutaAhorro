-- ============================================================================
-- 0009 · Cerrar de verdad las funciones internas
--
-- 0004 decía esto:
--
--   revoke execute on function public.fn_post_movement from authenticated, anon;
--
-- y el comentario de al lado decía que esas funciones "NO se exponen a
-- authenticated". **No las cerraba.** Cuando PostgreSQL crea una función, le
-- concede EXECUTE a `public` —el pseudo-rol al que pertenecen todos— y ese
-- permiso no se quita revocándoselo a `authenticated` ni a `anon`: hay que
-- revocárselo a `public`. Los tres `revoke` de 0004 no quitaban nada, porque
-- esos permisos directos nunca se habían concedido.
--
-- Qué quedaba abierto, vía PostgREST (`POST /rest/v1/rpc/fn_post_movement`):
--
--   fn_post_movement(p_tenant, p_store, p_product, p_type, p_quantity,
--                    p_unit_cost, p_ref_type, p_ref_id, p_reason, p_user)
--
-- Es `security definer`, recibe **el tenant como parámetro** y no comprueba ni
-- rol ni tenant, porque fue escrita para ser llamada solo desde otras
-- funciones que ya comprobaron ambas cosas. Con EXECUTE abierto, cualquier
-- usuario con sesión —un vendedor, el rol más bajo— podía llamarla desde el
-- navegador y:
--
--   · escribir stock de cualquier producto de **cualquier otro local**, que es
--     exactamente lo que el RLS existe para impedir;
--   · escribir movimientos en el kardex, que es inmutable por diseño
--     (ADR-006), atribuidos a **cualquier usuario**, porque `p_user` también
--     es un parámetro.
--
-- Y `fn_next_folio(p_tenant)` permitía quemarle folios a otro local: los
-- correlativos de venta salen con huecos y no hay forma de explicar por qué.
--
-- No es un agujero teórico. Es la única capa que separa a un cajero del
-- inventario de otro cliente del mismo servidor.
--
-- `fn_rebuild_stock_levels` sí la usa el worker (apps/worker/src/jobs/checks.ts),
-- con `service_role`, así que se le concede explícitamente.
--
-- Esta migración es idempotente y se puede aplicar sobre una base ya instalada.
-- ============================================================================

revoke execute on function public.fn_post_movement        from public, anon, authenticated;
revoke execute on function public.fn_rebuild_stock_levels from public, anon, authenticated;
revoke execute on function public.fn_next_folio           from public, anon, authenticated;
-- 0006 línea 524 tenía el mismo revoke inútil. fn_consume_lots también recibe
-- el tenant como parámetro y descuenta lotes sin comprobar quién llama.
revoke execute on function public.fn_consume_lots         from public, anon, authenticated;

-- El worker reconstruye el stock desde el kardex en el chequeo nocturno.
grant execute on function public.fn_rebuild_stock_levels to service_role;

-- ----------------------------------------------------------------------------
-- Las funciones de negocio sí van a `authenticated`, pero por concesión
-- explícita y no por herencia de `public`: así el permiso se lee en el código
-- en vez de depender de un valor por omisión de PostgreSQL. Las dos del
-- catálogo (0007 y 0008) nunca se habían concedido: funcionaban por esa
-- herencia, igual que funcionaban las que no debían.
-- ----------------------------------------------------------------------------
revoke execute on function public.fn_create_product from public;
revoke execute on function public.fn_update_product from public;
grant  execute on function public.fn_create_product to authenticated;
grant  execute on function public.fn_update_product to authenticated;

revoke execute on function public.fn_register_sale        from public;
revoke execute on function public.fn_void_sale            from public;
revoke execute on function public.fn_confirm_receipt      from public;
revoke execute on function public.fn_void_receipt         from public;
revoke execute on function public.fn_adjust_stock         from public;
revoke execute on function public.fn_open_cash_session    from public;
revoke execute on function public.fn_add_cash_movement    from public;
revoke execute on function public.fn_close_cash_session   from public;
revoke execute on function public.fn_cash_session_summary from public;
revoke execute on function public.fn_apply_stock_count    from public;
revoke execute on function public.fn_write_off_lot        from public;
revoke execute on function public.current_tenant_id       from public;
revoke execute on function public.current_user_role       from public;
revoke execute on function public.current_store_id        from public;
revoke execute on function public.is_active_user          from public;

grant execute on function public.fn_write_off_lot  to authenticated;
grant execute on function public.current_store_id  to authenticated;
grant execute on function public.is_active_user    to authenticated;
