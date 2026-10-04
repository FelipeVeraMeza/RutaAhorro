-- ============================================================================
-- 0037 · Cuentas nuevas solo con datos del servidor, y ajustes con su signo
--        (revisión por módulo, docs/28)
--
-- 1. CRÍTICO · handle_new_user creaba el perfil —local y ROL— leyendo
--    `raw_user_meta_data`. Ese campo lo escribe cualquiera: el registro
--    público de Supabase (`auth.signUp`, con la llave pública que va en la
--    página) acepta `options.data` libre. Un vendedor que conoce el id de su
--    local (lo lee en su propio perfil) podía crearse otra cuenta con
--    `{tenant_id: <su local>, role: 'admin'}` y entrar como administrador.
--    Ahora el local, la tienda y el rol salen SOLO de `raw_app_meta_data`, que
--    escribe únicamente la llave de servicio (las rutas del servidor y
--    tools/crear-*.mjs, que desde esta versión los mandan ahí). Un registro
--    público queda sin perfil: "Tu cuenta no está vinculada a ningún local".
--    Las cuentas que ya existen no cambian.
--
-- 2. fn_adjust_stock · El tipo del movimiento lo elegía la pantalla mirando
--    el stock de cuando se abrió el diálogo. Si entremedio se vendía, la base
--    calculaba otro signo y quedaba un "ajuste_positivo" que restaba. Y una
--    "merma" con una cantidad mayor que la del sistema sumaba stock. Ahora el
--    tipo de un ajuste sale del signo real, y una merma que suma se rechaza
--    (MERMA_SUMA). Misma firma que 0032: reemplazo, no sobrecarga (regla 21).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid;
  v_store  uuid;
  v_role   user_role;
  v_nombre text;
begin
  -- app_metadata: solo el servidor (llave de servicio) lo puede escribir.
  v_tenant := nullif(new.raw_app_meta_data->>'tenant_id','')::uuid;
  v_store  := nullif(new.raw_app_meta_data->>'store_id','')::uuid;
  v_role   := coalesce(nullif(new.raw_app_meta_data->>'role',''),'vendedor')::user_role;
  -- El nombre es lo único que se toma también de user_metadata: es de la
  -- persona y no da ningún permiso.
  v_nombre := coalesce(nullif(new.raw_app_meta_data->>'full_name',''),
                       new.raw_user_meta_data->>'full_name', '');

  -- Sin local asignado por el servidor no se crea perfil: el usuario queda
  -- sin acceso hasta que un administrador lo cree desde Usuarios.
  if v_tenant is null then
    return new;
  end if;
  -- La tienda tiene que ser de ese local.
  if v_store is not null and not exists (select 1 from stores where id = v_store and tenant_id = v_tenant) then
    v_store := null;
  end if;

  insert into profiles (id, tenant_id, store_id, full_name, email, role, max_discount_pct)
  values (
    new.id, v_tenant, v_store, v_nombre, new.email, v_role,
    case v_role when 'admin' then 100 when 'supervisor' then 10 else 0 end
  )
  on conflict (id) do nothing;

  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_adjust_stock — igual que 0032, con el tipo según el signo real
-- ---------------------------------------------------------------------------
create or replace function public.fn_adjust_stock(
  p_product_id uuid, p_new_quantity numeric,
  p_movement_type movement_type, p_reason text,
  p_ubicacion ubicacion_stock default 'sala'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_store  uuid := current_store_id();
  v_current numeric(14,3);
  v_delta  numeric(14,3);
  v_cost   integer;
  v_tipo   movement_type := p_movement_type;
begin
  p_ubicacion := 'sala';
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_movement_type not in ('ajuste_positivo','ajuste_negativo','merma','inventario_inicial') then
    raise exception 'TIPO_MOVIMIENTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  perform fn_lock_stock(v_tenant, v_store, array[p_product_id]);
  select coalesce(quantity,0) into v_current from stock_ubicaciones
   where store_id = v_store and product_id = p_product_id and ubicacion = p_ubicacion;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then
    return jsonb_build_object('product_id', p_product_id, 'quantity', v_current,
                              'changed', false);
  end if;

  -- El signo lo decide la base, con el stock bloqueado: la pantalla miraba el
  -- de cuando abrió el diálogo.
  if v_tipo in ('ajuste_positivo','ajuste_negativo') then
    v_tipo := case when v_delta > 0 then 'ajuste_positivo' else 'ajuste_negativo' end;
  elsif v_tipo = 'merma' and v_delta > 0 then
    raise exception 'MERMA_SUMA' using errcode = 'P0001';
  end if;

  select avg_cost into v_cost from products where id = p_product_id and tenant_id = v_tenant;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

  perform fn_post_movement(v_tenant, v_store, p_product_id, v_tipo,
                           v_delta, v_cost, 'adjustment', null, p_reason, v_user);

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, v_user, 'stock_adjustment', 'products', p_product_id,
          jsonb_build_object('quantity', v_current),
          jsonb_build_object('quantity', p_new_quantity, 'reason', p_reason,
                             'type', v_tipo));

  return jsonb_build_object('product_id', p_product_id, 'quantity', p_new_quantity,
                            'delta', v_delta, 'changed', true, 'type', v_tipo);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Proveedores · quién los crea y quién los cambia
-- ---------------------------------------------------------------------------
-- `suppliers_write` era "for all" con el rol solo en USING. En un INSERT
-- Postgres usa solo WITH CHECK, que miraba el local y no el rol: cualquier
-- usuario —un vendedor desde la consola— podía crear proveedores. Y el UPDATE
-- (solo admin) no daba error a los demás: no tocaba ninguna fila, y la
-- pantalla de Compras le decía "guardado" al supervisor o a bodega.
-- Matriz del doc 02: gestionar proveedores es del administrador. Crear uno al
-- recibir mercadería (T-55, Felipe 2026-10-01) lo pueden también supervisor y
-- bodega.
drop policy if exists suppliers_write  on suppliers;
drop policy if exists suppliers_insert on suppliers;
drop policy if exists suppliers_update on suppliers;
drop policy if exists suppliers_delete on suppliers;
create policy suppliers_insert on suppliers for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and coalesce(current_user_role()::text, '') in ('admin','supervisor','bodega'));
create policy suppliers_update on suppliers for update to authenticated
  using (tenant_id = current_tenant_id() and coalesce(current_user_role()::text, '') = 'admin')
  with check (tenant_id = current_tenant_id());
create policy suppliers_delete on suppliers for delete to authenticated
  using (tenant_id = current_tenant_id() and coalesce(current_user_role()::text, '') = 'admin');

-- ---------------------------------------------------------------------------
-- 4. Caja · lo que la pantalla valida, la base también (regla 6)
-- ---------------------------------------------------------------------------
-- fn_close_cash_session aceptaba un monto contado nulo o negativo: con nulo,
-- `contado <> esperado` da nulo, no pedía motivo y la caja quedaba cerrada
-- "sin contar". Y ni el cierre ni los ingresos/egresos revisaban que quien
-- llama siguiera activo: un usuario desactivado con la sesión abierta seguía
-- sacando plata de su caja. Mismas firmas que 0012.
create or replace function public.fn_close_cash_session(
  p_session_id uuid, p_counted_amount integer, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_user     uuid := auth.uid();
  v_role     user_role := current_user_role();
  v_s        cash_sessions%rowtype;
  v_summary  jsonb;
  v_expected integer;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;
  -- CP-07. `for update` espera a que terminen las ventas en curso de esta caja.
  select * into v_s from cash_sessions
   where id = p_session_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_s.status = 'cerrada' then
    raise exception 'CAJA_YA_CERRADA' using errcode = 'P0001';
  end if;
  if v_s.user_id <> v_user and coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  v_summary  := fn_cash_session_summary(p_session_id);
  v_expected := (v_summary->>'expected_amount')::integer;

  if p_counted_amount <> v_expected and coalesce(trim(p_notes),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  update cash_sessions
     set status = 'cerrada', closed_at = now(), closed_by = v_user,
         expected_amount = v_expected, counted_amount = p_counted_amount,
         closing_notes = p_notes
   where id = p_session_id;

  if v_s.user_id <> v_user then
    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, v_user, 'cash_force_close', 'cash_sessions', p_session_id,
            jsonb_build_object('original_user', v_s.user_id, 'notes', p_notes));
  end if;

  return fn_cash_session_summary(p_session_id);
end $$;

create or replace function public.fn_add_cash_movement(
  p_type cash_movement_type, p_amount integer, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_session uuid;
  v_id     uuid;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if coalesce(p_amount,0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;

  select id into v_session from cash_sessions
   where user_id = v_user and status = 'abierta' limit 1 for share;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
  values (v_tenant, v_session, p_type, p_amount, p_reason, v_user)
  returning id into v_id;

  return jsonb_build_object('movement_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Un usuario desactivado deja de ver y de tocar el local
-- ---------------------------------------------------------------------------
-- Desactivar a alguien (Usuarios → Desactivar) solo lo frenaba en la
-- pantalla: su sesión sigue viva (el token se renueva solo) y TODAS las
-- políticas preguntan `tenant_id = current_tenant_id()`, que no miraba
-- `is_active`. Un ex empleado con el celular de antes podía seguir leyendo
-- ventas, clientes y proveedores por la API, y escribir donde su rol lo deja.
-- Ahora las tres funciones de identidad devuelven null si la cuenta está
-- desactivada: ninguna política pasa y las funciones responden NO_AUTENTICADO.
-- Su propio perfil lo sigue viendo (profiles_self_read), para que la app le
-- diga "Tu cuenta está desactivada" y no "no está vinculada a ningún local".
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select tenant_id from profiles where id = auth.uid() and is_active $$;

create or replace function public.current_user_role()
returns user_role
language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid() and is_active $$;

create or replace function public.current_store_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select store_id from profiles where id = auth.uid() and is_active $$;

drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles for select to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Abonos de fiado con tarjeta o transferencia, en el cuadre de la caja
-- ---------------------------------------------------------------------------
-- Un abono con débito o crédito pasa por la máquina de tarjetas del local,
-- pero quedaba sin caja: el cierre mostraba "Cobrado por medio de pago" solo
-- con las ventas y lo de la máquina no cuadraba. Ahora todo abono queda en la
-- caja abierta de quien lo recibe (si tiene una; en efectivo sigue siendo
-- obligatoria) y el resumen trae `abonos_por_medio`. El esperado en efectivo
-- no cambia. Mismas firmas que 0029.
create or replace function public.fn_abonar_cuenta(
  p_cliente uuid, p_monto integer, p_metodo text, p_nota text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_user    uuid := auth.uid();
  v_session uuid;
  v_saldo   integer;
  v_id      uuid;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'vendedor')
     or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(p_monto, 0) <= 0 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'debito', 'credito') then
    raise exception 'METODO_INVALIDO' using errcode = 'P0001';
  end if;
  perform 1 from clientes where id = p_cliente and tenant_id = v_tenant for update;
  if not found then raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001'; end if;

  v_saldo := fn_saldo_cliente(p_cliente);
  if p_monto > v_saldo then
    raise exception 'ABONO_EXCEDE_SALDO' using errcode = 'P0001';
  end if;

  -- `for share`, como la venta: no se cuela en una caja que se está cerrando.
  select id into v_session from cash_sessions
   where user_id = v_user and status = 'abierta' limit 1 for share;
  if p_metodo = 'efectivo' and v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto, metodo,
                                          cash_session_id, nota, created_by)
  values (v_tenant, p_cliente, 'abono', p_monto, p_metodo, v_session,
          nullif(trim(p_nota), ''), v_user)
  returning id into v_id;

  return jsonb_build_object('movimiento_id', v_id, 'saldo', v_saldo - p_monto);
end $$;

create or replace function public.fn_cash_session_summary(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s          cash_sessions%rowtype;
  v_cash_sales integer;
  v_in         integer;
  v_out        integer;
  v_count      integer;
  v_total      integer;
  v_methods    jsonb;
  v_redondeo   integer;
  v_abonos     integer;
  v_abonos_med jsonb;
  v_fiado      integer;
begin
  select * into v_s from cash_sessions
   where id = p_session_id and tenant_id = current_tenant_id();
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;

  select coalesce(sum(sp.amount),0) into v_cash_sales
    from sale_payments sp join sales s on s.id = sp.sale_id
   where s.cash_session_id = p_session_id and s.status = 'completada'
     and sp.method = 'efectivo';

  select coalesce(sum(amount),0) into v_in from cash_movements
   where cash_session_id = p_session_id and type = 'ingreso';
  select coalesce(sum(amount),0) into v_out from cash_movements
   where cash_session_id = p_session_id and type = 'egreso';

  select count(*), coalesce(sum(total),0), coalesce(sum(ajuste_redondeo),0)
    into v_count, v_total, v_redondeo
    from sales where cash_session_id = p_session_id and status = 'completada';

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_methods from (
    select sp.method::text as method, sum(sp.amount) as amt
      from sale_payments sp join sales s on s.id = sp.sale_id
     where s.cash_session_id = p_session_id and s.status = 'completada'
     group by sp.method) t;
  v_fiado := coalesce((v_methods->>'fiado')::integer, 0);

  select coalesce(sum(monto),0) into v_abonos from cuenta_cliente_movimientos
   where cash_session_id = p_session_id and tipo = 'abono' and metodo = 'efectivo';
  select coalesce(jsonb_object_agg(metodo, m), '{}'::jsonb) into v_abonos_med from (
    select metodo, sum(monto) as m from cuenta_cliente_movimientos
     where cash_session_id = p_session_id and tipo = 'abono'
     group by metodo) t;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', v_s.status,
    'opened_at', v_s.opened_at,
    'opening_amount', v_s.opening_amount,
    'cash_sales', v_cash_sales,
    'cash_in', v_in,
    'cash_out', v_out,
    'abonos_efectivo', v_abonos,
    'abonos_por_medio', v_abonos_med,
    'ajuste_redondeo', v_redondeo,
    'fiado', v_fiado,
    'expected_amount', v_s.opening_amount + v_cash_sales + v_in - v_out + v_abonos,
    'counted_amount', v_s.counted_amount,
    'difference', v_s.difference,
    'sales_count', v_count,
    'sales_total', v_total,
    'average_ticket', case when v_count > 0 then round(v_total::numeric / v_count)::integer else 0 end,
    'by_payment_method', v_methods);
end $$;
