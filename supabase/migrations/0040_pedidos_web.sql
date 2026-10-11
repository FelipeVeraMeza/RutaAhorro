-- =============================================================================
-- 0040 · Pedidos de la tienda online (docs/33; docs/30 etapa 2)
-- =============================================================================
-- Hasta acá el carrito de la tienda solo se podía mandar por WhatsApp, y sin
-- celular anotado en la sucursal no había cómo pedir nada. Desde 0040:
--
--   1. `products.publicado_tienda`: qué productos se muestran en la tienda
--      (RF-T57). Por omisión todos, como hasta ahora.
--   2. `pedidos_web`, sus líneas y su historial de estados (RF-T45 a RF-T50).
--      Número correlativo por local y un código de seguimiento que no se
--      puede adivinar. Solo se escriben con funciones (regla 14).
--   3. `fn_crear_pedido_web`: la usa el servidor de la tienda con la llave de
--      servicio (nadie sin sesión ejecuta nada, seguridad.test.mjs). Los
--      precios y ofertas los calcula la base con los de ese momento
--      (RNF-T49), el mismo `client_uuid` no crea dos pedidos (RNF-T48) y un
--      celular no puede tener más de 3 pedidos abiertos.
--   4. `fn_cambiar_estado_pedido_web`: el personal (admin, supervisor,
--      vendedor) los mueve: recibido → en preparación → listo → entregado, o
--      cancelado con motivo.
--   5. Seguimiento por código, estados de "Mis pedidos" y anonimizar los
--      datos de contacto de pedidos cerrados viejos (RNF-T26): solo servicio.
--   6. `fn_guardar_configuracion` acepta la configuración de la tienda:
--      recibir pedidos (apagado por omisión), WhatsApp, horario, aviso y
--      pedido mínimo. Misma firma que 0029.
--
-- Idempotente y sin cambiar firmas existentes: se puede aplicar antes que el
-- código. El código, a su vez, sigue funcionando sin 0040 (la tienda no
-- muestra "Hacer pedido" y no filtra por `publicado_tienda`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Qué productos se publican
-- ---------------------------------------------------------------------------
alter table products add column if not exists publicado_tienda boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2 · Tablas
-- ---------------------------------------------------------------------------
do $$ begin
  create type pedido_web_estado as enum ('recibido', 'preparando', 'listo', 'entregado', 'cancelado');
exception when duplicate_object then null;
end $$;

create table if not exists pedidos_web (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  store_id            uuid references stores(id),
  numero              integer not null,
  codigo              text not null unique check (codigo ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  client_uuid         uuid not null,
  cliente_nombre      text not null check (length(cliente_nombre) between 2 and 80),
  cliente_celular     text not null check (cliente_celular ~ '^\+569[0-9]{8}$' or cliente_celular = 'anonimizado'),
  cliente_correo      text check (cliente_correo is null or length(cliente_correo) <= 120),
  modalidad           text not null default 'retiro' check (modalidad in ('retiro')),
  nota                text check (nota is null or length(nota) <= 300),
  estado              pedido_web_estado not null default 'recibido',
  total               integer not null default 0 check (total >= 0),
  ahorro              integer not null default 0 check (ahorro >= 0),
  motivo_cancelacion  text check (motivo_cancelacion is null or length(motivo_cancelacion) <= 300),
  estado_cambiado_por uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  anonimizado_at      timestamptz,
  unique (tenant_id, numero),
  unique (tenant_id, client_uuid)
);
create index if not exists idx_pedidos_web_estado on pedidos_web(tenant_id, estado, created_at desc);
create index if not exists idx_pedidos_web_celular on pedidos_web(tenant_id, cliente_celular, created_at desc);

create table if not exists pedido_web_items (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references pedidos_web(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  product_id      uuid references products(id) on delete set null,
  nombre          text not null,
  cantidad        integer not null check (cantidad between 1 and 99),
  precio_lista    integer not null check (precio_lista >= 0),
  precio_unitario integer not null check (precio_unitario >= 0),
  subtotal        integer not null check (subtotal >= 0)
);
create index if not exists idx_pedido_web_items on pedido_web_items(pedido_id);

create table if not exists pedido_web_historial (
  id         bigint generated always as identity primary key,
  pedido_id  uuid not null references pedidos_web(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  estado     pedido_web_estado not null,
  motivo     text,
  user_id    uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_pedido_web_historial on pedido_web_historial(pedido_id, created_at);

-- Se leen en "Pedidos web" (traen el celular del cliente: bodega no los ve);
-- se escriben solo con funciones.
alter table pedidos_web          enable row level security;
alter table pedido_web_items     enable row level security;
alter table pedido_web_historial enable row level security;
drop policy if exists pedidos_web_read on pedidos_web;
create policy pedidos_web_read on pedidos_web for select to authenticated
  using (tenant_id = current_tenant_id() and is_active_user()
         and coalesce(current_user_role()::text, '') in ('admin', 'supervisor', 'vendedor'));
drop policy if exists pedido_web_items_read on pedido_web_items;
create policy pedido_web_items_read on pedido_web_items for select to authenticated
  using (tenant_id = current_tenant_id() and is_active_user()
         and coalesce(current_user_role()::text, '') in ('admin', 'supervisor', 'vendedor'));
drop policy if exists pedido_web_historial_read on pedido_web_historial;
create policy pedido_web_historial_read on pedido_web_historial for select to authenticated
  using (tenant_id = current_tenant_id() and is_active_user()
         and coalesce(current_user_role()::text, '') in ('admin', 'supervisor', 'vendedor'));
revoke insert, update, delete on pedidos_web, pedido_web_items, pedido_web_historial from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Crear un pedido (solo el servidor de la tienda, con la llave de servicio)
-- ---------------------------------------------------------------------------
create or replace function public.fn_crear_pedido_web(p_tenant uuid, p_pedido jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ajustes   jsonb;
  v_store     uuid;
  v_dia       date;
  v_ofertas   boolean;
  v_sin_stock boolean;
  v_client    uuid;
  v_previo    pedidos_web%rowtype;
  v_nombre    text;
  v_celular   text;
  v_correo    text;
  v_nota      text;
  v_id        uuid := gen_random_uuid();
  v_numero    integer;
  v_codigo    text;
  v_bytes     bytea;
  v_alfabeto  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_i         integer;
  v_item      jsonb;
  v_pid       uuid;
  v_qty       integer;
  v_prod      products%rowtype;
  v_hay       numeric;
  v_unit      integer;
  v_total     integer := 0;
  v_ahorro    integer := 0;
  v_minimo    integer;
begin
  select settings into v_ajustes from tenants where id = p_tenant and status = 'activo';
  if not found then raise exception 'TIENDA_CERRADA' using errcode = 'P0001'; end if;
  if coalesce((v_ajustes->>'tienda_pedidos')::boolean, false) is not true then
    raise exception 'PEDIDOS_WEB_APAGADOS' using errcode = 'P0001';
  end if;
  if p_pedido is null or jsonb_typeof(p_pedido) <> 'object' then
    raise exception 'PEDIDO_INVALIDO' using errcode = 'P0001';
  end if;

  begin
    v_client := (p_pedido->>'client_uuid')::uuid;
  exception when others then
    raise exception 'PEDIDO_INVALIDO' using errcode = 'P0001';
  end;
  if v_client is null then raise exception 'PEDIDO_INVALIDO' using errcode = 'P0001'; end if;

  -- Todo lo del local, en fila: el número no se repite y el mismo pedido
  -- mandado dos veces (doble toque, reintento) no crea dos.
  perform pg_advisory_xact_lock(hashtext('pedidos_web:' || p_tenant::text));
  select * into v_previo from pedidos_web where tenant_id = p_tenant and client_uuid = v_client;
  if found then
    return jsonb_build_object('id', v_previo.id, 'numero', v_previo.numero, 'codigo', v_previo.codigo,
                              'total', v_previo.total, 'ahorro', v_previo.ahorro, 'repetido', true);
  end if;

  v_nombre  := trim(coalesce(p_pedido#>>'{cliente,nombre}', ''));
  v_celular := trim(coalesce(p_pedido#>>'{cliente,celular}', ''));
  v_correo  := nullif(trim(coalesce(p_pedido#>>'{cliente,correo}', '')), '');
  v_nota    := nullif(trim(coalesce(p_pedido->>'nota', '')), '');
  if length(v_nombre) not between 2 and 80 then raise exception 'NOMBRE_INVALIDO' using errcode = 'P0001'; end if;
  if v_celular !~ '^\+569[0-9]{8}$' then raise exception 'CELULAR_INVALIDO' using errcode = 'P0001'; end if;
  if v_correo is not null and (length(v_correo) > 120 or v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    raise exception 'CORREO_INVALIDO' using errcode = 'P0001';
  end if;
  if length(coalesce(v_nota, '')) > 300 then raise exception 'NOTA_LARGA' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_pedido->'lineas') is distinct from 'array' or jsonb_array_length(p_pedido->'lineas') = 0 then
    raise exception 'PEDIDO_SIN_PRODUCTOS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_pedido->'lineas') > 60 then raise exception 'PEDIDO_MUY_GRANDE' using errcode = 'P0001'; end if;

  -- Abuso: un celular con tres pedidos sin cerrar, o una tienda inundada.
  if (select count(*) from pedidos_web where tenant_id = p_tenant and cliente_celular = v_celular
        and estado in ('recibido', 'preparando', 'listo')) >= 3 then
    raise exception 'DEMASIADOS_PEDIDOS_ABIERTOS' using errcode = 'P0001';
  end if;
  if (select count(*) from pedidos_web where tenant_id = p_tenant and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'TIENDA_SATURADA' using errcode = 'P0001';
  end if;

  select id into v_store from stores where tenant_id = p_tenant and is_active order by created_at limit 1;
  v_dia       := (now() at time zone fn_tenant_timezone(p_tenant))::date;
  v_ofertas   := fn_ofertas_rigen(p_tenant, now());
  v_sin_stock := coalesce((v_ajustes->>'vender_sin_stock')::boolean, false);
  select coalesce(max(numero), 0) + 1 into v_numero from pedidos_web where tenant_id = p_tenant;

  -- El código: 8 de 31 letras y números (sin 0/O ni 1/I/L), al azar.
  loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_codigo := '';
    foreach v_i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + get_byte(v_bytes, v_i) % 31, 1);
    end loop;
    exit when not exists (select 1 from pedidos_web where codigo = v_codigo);
  end loop;

  insert into pedidos_web (id, tenant_id, store_id, numero, codigo, client_uuid, cliente_nombre, cliente_celular,
                           cliente_correo, nota)
  values (v_id, p_tenant, v_store, v_numero, v_codigo, v_client, v_nombre, v_celular, v_correo, v_nota);

  for v_item in select value from jsonb_array_elements(p_pedido->'lineas') loop
    begin
      v_pid := (v_item->>'product_id')::uuid;
      v_qty := (v_item->>'cantidad')::integer;
    exception when others then
      raise exception 'PEDIDO_INVALIDO' using errcode = 'P0001';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
    if exists (select 1 from pedido_web_items where pedido_id = v_id and product_id = v_pid) then
      raise exception 'PRODUCTO_REPETIDO' using errcode = 'P0001';
    end if;

    select * into v_prod from products where id = v_pid and tenant_id = p_tenant;
    if not found or not v_prod.is_active or not v_prod.publicado_tienda then
      raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(v_prod.name, v_pid::text) using errcode = 'P0001';
    end if;
    if coalesce(v_prod.sale_price, 0) <= 0 then
      raise exception 'PRODUCTO_SIN_PRECIO: %', v_prod.name using errcode = 'P0001';
    end if;
    if not v_sin_stock then
      select coalesce(sum(quantity), 0) into v_hay from stock_levels where tenant_id = p_tenant and product_id = v_pid;
      if v_hay <= 0 then raise exception 'PRODUCTO_AGOTADO: %', v_prod.name using errcode = 'P0001'; end if;
    end if;

    -- El precio lo pone la base, con las ofertas de hoy, como la caja.
    v_unit := case when v_ofertas then fn_precio_por_cantidad(v_pid, v_prod.sale_price, v_qty, v_dia)
                   else v_prod.sale_price end;
    insert into pedido_web_items (pedido_id, tenant_id, product_id, nombre, cantidad, precio_lista, precio_unitario, subtotal)
    values (v_id, p_tenant, v_pid, v_prod.name, v_qty, v_prod.sale_price, v_unit, v_unit * v_qty);
    v_total  := v_total + v_unit * v_qty;
    v_ahorro := v_ahorro + (v_prod.sale_price - v_unit) * v_qty;
  end loop;

  v_minimo := coalesce((v_ajustes->>'tienda_pedido_minimo')::integer, 0);
  if v_total < v_minimo then
    raise exception 'PEDIDO_BAJO_MINIMO: %', v_minimo using errcode = 'P0001';
  end if;

  update pedidos_web set total = v_total, ahorro = greatest(v_ahorro, 0) where id = v_id;
  insert into pedido_web_historial (pedido_id, tenant_id, estado) values (v_id, p_tenant, 'recibido');

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'codigo', v_codigo,
                            'total', v_total, 'ahorro', greatest(v_ahorro, 0), 'repetido', false);
end $$;

-- ---------------------------------------------------------------------------
-- 4 · El personal cambia el estado
-- ---------------------------------------------------------------------------
create or replace function public.fn_cambiar_estado_pedido_web(p_id uuid, p_estado text, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_ped    pedidos_web%rowtype;
  v_nuevo  pedido_web_estado;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'vendedor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  begin
    v_nuevo := p_estado::pedido_web_estado;
  exception when others then
    raise exception 'ESTADO_INVALIDO' using errcode = 'P0001';
  end;

  select * into v_ped from pedidos_web where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'PEDIDO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

  -- Las mismas transiciones que core (pedidoWeb.ts, TRANSICIONES_PEDIDO).
  if not (
       (v_ped.estado = 'recibido'   and v_nuevo in ('preparando', 'listo', 'cancelado'))
    or (v_ped.estado = 'preparando' and v_nuevo in ('listo', 'cancelado'))
    or (v_ped.estado = 'listo'      and v_nuevo in ('entregado', 'cancelado'))
  ) then
    raise exception 'CAMBIO_DE_ESTADO_INVALIDO' using errcode = 'P0001';
  end if;
  if v_nuevo = 'cancelado' and v_motivo is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if length(coalesce(v_motivo, '')) > 300 then raise exception 'MOTIVO_LARGO' using errcode = 'P0001'; end if;

  update pedidos_web
     set estado = v_nuevo, updated_at = now(), estado_cambiado_por = auth.uid(),
         motivo_cancelacion = case when v_nuevo = 'cancelado' then v_motivo else motivo_cancelacion end
   where id = p_id;
  insert into pedido_web_historial (pedido_id, tenant_id, estado, motivo, user_id)
  values (p_id, v_tenant, v_nuevo, v_motivo, auth.uid());
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), 'pedido_web_estado', 'pedidos_web', p_id,
          jsonb_build_object('estado', v_ped.estado, 'numero', v_ped.numero),
          jsonb_build_object('estado', v_nuevo, 'numero', v_ped.numero, 'motivo', v_motivo));

  return jsonb_build_object('id', p_id, 'estado', v_nuevo);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Seguimiento, estados para "Mis pedidos" y anonimizar (solo servicio)
-- ---------------------------------------------------------------------------
-- Lo que ve el cliente con su código: sin su celular ni su correo (quien
-- tenga el enlace no se entera de ellos), solo su primer nombre.
create or replace function public.fn_seguimiento_pedido_web(p_tenant uuid, p_codigo text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'numero', p.numero, 'codigo', p.codigo, 'estado', p.estado, 'total', p.total, 'ahorro', p.ahorro,
    'nota', p.nota, 'modalidad', p.modalidad, 'motivo', p.motivo_cancelacion,
    'nombre', split_part(p.cliente_nombre, ' ', 1),
    'creado', p.created_at, 'actualizado', p.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'product_id', i.product_id, 'nombre', i.nombre, 'cantidad', i.cantidad,
                'precio_lista', i.precio_lista, 'precio_unitario', i.precio_unitario, 'subtotal', i.subtotal)
              order by i.nombre) from pedido_web_items i where i.pedido_id = p.id), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('estado', h.estado, 'fecha', h.created_at)
              order by h.created_at) from pedido_web_historial h where h.pedido_id = p.id), '[]'::jsonb))
    from pedidos_web p
   where p.tenant_id = p_tenant and p.codigo = upper(trim(coalesce(p_codigo, '')))
$$;

create or replace function public.fn_estado_pedidos_web(p_tenant uuid, p_codigos text[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'numero', p.numero, 'estado', p.estado, 'total', p.total)), '[]'::jsonb)
    from pedidos_web p
   where p.tenant_id = p_tenant
     and p.codigo = any ((select array_agg(c) from (select unnest(p_codigos) c limit 20) x)::text[])
$$;

-- RNF-T26 · Los datos de contacto de los pedidos cerrados se borran pasado el
-- plazo. Queda el pedido (número, productos, total) para los reportes.
create or replace function public.fn_anonimizar_pedidos_web(p_meses integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  if p_meses is null or p_meses < 1 or p_meses > 60 then
    raise exception 'PLAZO_INVALIDO' using errcode = 'P0001';
  end if;
  update pedidos_web
     set cliente_nombre = 'Cliente', cliente_celular = 'anonimizado', cliente_correo = null, nota = null,
         anonimizado_at = now()
   where estado in ('entregado', 'cancelado')
     and anonimizado_at is null
     and updated_at < now() - make_interval(months => p_meses);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Publicar u ocultar productos en la tienda (RF-T57)
-- ---------------------------------------------------------------------------
create or replace function public.fn_publicar_en_tienda(p_ids uuid[], p_publicado boolean)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_n      integer;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'bodega') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_publicado is null or p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 5000 then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;
  update products set publicado_tienda = p_publicado, updated_at = now()
   where tenant_id = v_tenant and id = any (p_ids) and publicado_tienda is distinct from p_publicado;
  get diagnostics v_n = row_count;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'publicar_tienda', 'products', null,
          jsonb_build_object('publicado', p_publicado, 'productos', v_n));
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 7 · Configuración: lo de 0029 más la tienda
-- ---------------------------------------------------------------------------
create or replace function public.fn_guardar_configuracion(p_cambios jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_antes  jsonb;
  v_nuevo  jsonb := '{}'::jsonb;
  v_clave  text;
  v_valor  jsonb;
  v_num    numeric;
  v_dia    text;
  v_txt    jsonb;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'CONFIGURACION_INVALIDA' using errcode = 'P0001';
  end if;

  for v_clave, v_valor in select * from jsonb_each(p_cambios) loop
    case v_clave
      when 'vender_sin_stock', 'tarjeta_emite_documento', 'ofertas_activas', 'tienda_pedidos' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
      when 'efectivo_inicial_sugerido', 'cash_alert_hours', 'cost_variation_alert_pct', 'tienda_pedido_minimo' then
        if jsonb_typeof(v_valor) <> 'number' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        v_num := (v_valor #>> '{}')::numeric;
        if v_num < 0 or v_num <> trunc(v_num)
           or (v_clave = 'efectivo_inicial_sugerido' and v_num > 5000000)
           or (v_clave = 'cash_alert_hours' and (v_num < 1 or v_num > 72))
           or (v_clave = 'cost_variation_alert_pct' and (v_num < 1 or v_num > 100))
           or (v_clave = 'tienda_pedido_minimo' and v_num > 1000000) then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
      -- 0029 · RF-M9-13 · El pie del comprobante: texto corto o vacío.
      when 'comprobante_pie' then
        if jsonb_typeof(v_valor) <> 'string' or length(v_valor #>> '{}') > 160 then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        v_valor := to_jsonb(trim(v_valor #>> '{}'));
      -- 0040 · El aviso de la tienda (cerrado por feriado, horario especial).
      when 'tienda_mensaje' then
        if jsonb_typeof(v_valor) <> 'string' or length(v_valor #>> '{}') > 200 then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        v_valor := to_jsonb(trim(v_valor #>> '{}'));
      -- 0040 · El WhatsApp de la tienda, si no es el teléfono de la sucursal.
      when 'tienda_whatsapp' then
        if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^[0-9 +()-]{0,20}$' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        v_valor := to_jsonb(trim(v_valor #>> '{}'));
      -- 0040 · Horario: un texto corto por día (core/horario.ts lo interpreta).
      when 'tienda_horario' then
        if jsonb_typeof(v_valor) <> 'object' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        for v_dia, v_txt in select * from jsonb_each(v_valor) loop
          if v_dia not in ('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom')
             or jsonb_typeof(v_txt) <> 'string' or length(v_txt #>> '{}') > 40
             or (v_txt #>> '{}') !~ '^[0-9:,;\s a-zA-Z–-]*$' then
            raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
          end if;
        end loop;
      else
        raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
    end case;
    v_nuevo := v_nuevo || jsonb_build_object(v_clave, v_valor);
  end loop;

  select settings into v_antes from tenants where id = v_tenant for update;
  update tenants set settings = coalesce(settings, '{}'::jsonb) || v_nuevo where id = v_tenant;

  -- Apagar anota desde cuándo; volver a encender lo borra. Apagar dos veces
  -- no mueve la hora: las ventas sin conexión de entremedio ya eran sin oferta.
  if v_nuevo ? 'ofertas_activas' then
    if (v_nuevo->>'ofertas_activas')::boolean then
      update tenants set settings = settings - 'ofertas_pausadas_desde' where id = v_tenant;
    elsif coalesce((v_antes->>'ofertas_activas')::boolean, true) then
      update tenants set settings = settings || jsonb_build_object('ofertas_pausadas_desde', now())
       where id = v_tenant;
    end if;
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), 'editar', 'configuracion', v_tenant, v_antes, v_nuevo);
  return (select settings from tenants where id = v_tenant);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos (regla 12)
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_crear_pedido_web(uuid, jsonb)              from public, anon, authenticated;
grant  execute on function public.fn_crear_pedido_web(uuid, jsonb)              to service_role;
revoke execute on function public.fn_seguimiento_pedido_web(uuid, text)         from public, anon, authenticated;
grant  execute on function public.fn_seguimiento_pedido_web(uuid, text)         to service_role;
revoke execute on function public.fn_estado_pedidos_web(uuid, text[])           from public, anon, authenticated;
grant  execute on function public.fn_estado_pedidos_web(uuid, text[])           to service_role;
revoke execute on function public.fn_anonimizar_pedidos_web(integer)            from public, anon, authenticated;
grant  execute on function public.fn_anonimizar_pedidos_web(integer)            to service_role;
revoke execute on function public.fn_cambiar_estado_pedido_web(uuid, text, text) from public, anon;
grant  execute on function public.fn_cambiar_estado_pedido_web(uuid, text, text) to authenticated;
revoke execute on function public.fn_publicar_en_tienda(uuid[], boolean)         from public, anon;
grant  execute on function public.fn_publicar_en_tienda(uuid[], boolean)         to authenticated;
revoke execute on function public.fn_guardar_configuracion(jsonb)                from public, anon;
grant  execute on function public.fn_guardar_configuracion(jsonb)                to authenticated;
