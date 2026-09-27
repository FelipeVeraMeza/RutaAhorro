-- ============================================================================
-- 0018 · Ofertas por cantidad, precio validado en la base (T-14) e impuestos
--        adicionales editables
--
-- Pedido del cliente (2026-09-26): «ofertas, ejemplo 1 por $2.000 y si
-- llevas 3 te llevas los 3 a $1.400 cada uno» y «poder modificar el impuesto
-- adicional y las tasas por producto o productos en general». Respuestas 3, 5
-- y 6 del cuestionario (RQ-04, RQ-06, RQ-08).
--
-- (1) Tramos de precio. `product_price_tiers`: desde N unidades, cada una a
--     $P, con vigencia opcional por día del local (eso es una promoción). Se
--     aplica el tramo con el N más alto que la cantidad alcanza y el precio
--     vale para todas las unidades de la línea. Nunca más caro que el precio
--     de lista. La misma regla está en `packages/core/src/precios.ts`.
--
-- (2) T-14: el precio que manda el POS se compara con el que corresponde.
--     Hasta ahora `fn_register_sale` aceptaba cualquier `unit_price`: el tope
--     de descuento se rodeaba vendiendo a $1 en vez de aplicar un descuento.
--     Ahora la diferencia entre el precio que corresponde y el cobrado CUENTA
--     COMO DESCUENTO, y pasa por el mismo tope del rol. Un vendedor con tope
--     0 % no puede cobrar menos; un supervisor, hasta su 10 %; el
--     administrador, lo que quiera. Cobrar de más no se bloquea: no es una
--     forma de sacarle plata al dueño.
--
--     "El precio que corresponde" considera las ventas sin conexión: una venta
--     hecha hace unas horas se sincroniza con el precio que tenía entonces.
--     Se usa el menor entre el precio de hoy y el que tenía el producto a la
--     hora de la venta (`price_history`, que desde 0012 nadie escribe a mano),
--     pero solo para ventas de hasta 7 días: `p_sold_at` lo manda el
--     dispositivo, y sin ese límite bastaría con fecharla el año pasado.
--
-- (3) Impuestos adicionales editables. `impuestos_adicionales` es el catálogo
--     del local (IABA 10 % y 18 %, ILA 20,5 % y 31,5 %…) con su tasa, que el
--     administrador cambia cuando cambia la ley. Cada producto apunta a uno o
--     a ninguno, y se asignan de a muchos. La venta CONGELA la tasa y el
--     nombre en `sale_items`: cambiar una tasa no cambia ventas ya hechas.
--
--     El desglose (`fn_desglose_impuestos`) agrupa por impuesto, despeja el
--     neto (total = neto × (1 + IVA + tasa)), calcula el adicional sobre el
--     neto y deja el IVA por diferencia, para que neto + IVA + adicionales
--     sea exactamente el total. Sin impuestos adicionales da lo mismo que
--     antes. Es el mismo algoritmo que `packages/core/src/impuestos.ts`, y
--     `tools/pg-test/precios.test.mjs` compara los dos con ventas al azar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists impuestos_adicionales (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) > 0),
  -- Código del impuesto en el DTE (24 licores, 25 vinos, 26 cervezas,
  -- 27 bebidas analcohólicas, 271 bebidas azucaradas).
  codigo_sii  integer,
  tasa        numeric(5,2) not null check (tasa > 0 and tasa < 100),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, nombre)
);

alter table products
  add column if not exists impuesto_adicional_id uuid
      references impuestos_adicionales(id) on delete set null;

create table if not exists product_price_tiers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  desde          numeric(14,3) not null check (desde >= 1),
  precio         integer not null check (precio > 0),
  vigente_desde  date,
  vigente_hasta  date,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (vigente_desde is null or vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create index if not exists idx_price_tiers_product on product_price_tiers(product_id, desde);

-- Lo que la venta congela de cada línea.
alter table sale_items
  add column if not exists precio_lista               integer,
  add column if not exists impuesto_adicional_tasa    numeric(5,2) not null default 0,
  add column if not exists impuesto_adicional_nombre  text,
  add column if not exists impuesto_adicional_codigo  integer;

-- `tax_amount` sigue siendo el IVA. Lo nuevo es el neto y los adicionales.
alter table sales
  add column if not exists neto                   integer,
  add column if not exists impuestos_adicionales  integer not null default 0,
  add column if not exists impuestos_detalle      jsonb   not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- RLS: se leen en el local; se escriben solo con las funciones (regla 14)
-- ---------------------------------------------------------------------------
alter table impuestos_adicionales enable row level security;
alter table product_price_tiers   enable row level security;

drop policy if exists impuestos_read on impuestos_adicionales;
create policy impuestos_read on impuestos_adicionales for select to authenticated
  using (tenant_id = current_tenant_id());

drop policy if exists tramos_read on product_price_tiers;
create policy tramos_read on product_price_tiers for select to authenticated
  using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- fn_precio_por_cantidad — el precio de cada unidad para esa cantidad ese día
-- ---------------------------------------------------------------------------
-- Réplica de `precioPorCantidad` en core. Un tramo con fechas no rige si no
-- se sabe el día.
create or replace function public.fn_precio_por_cantidad(
  p_product uuid, p_base integer, p_qty numeric, p_dia date
) returns integer
language sql stable set search_path = public
as $$
  select least(p_base, coalesce((
    select t.precio from product_price_tiers t
     where t.product_id = p_product
       and t.desde <= p_qty
       and (t.vigente_desde is null or (p_dia is not null and t.vigente_desde <= p_dia))
       and (t.vigente_hasta is null or (p_dia is not null and t.vigente_hasta >= p_dia))
     order by t.desde desc, t.precio asc
     limit 1), p_base))
$$;

-- ---------------------------------------------------------------------------
-- fn_precio_base_en — el precio de lista que tenía el producto en un momento
-- ---------------------------------------------------------------------------
-- El `old_price` del primer cambio posterior a ese momento; si no hubo
-- cambios después, el de hoy.
create or replace function public.fn_precio_base_en(
  p_product uuid, p_base_actual integer, p_momento timestamptz
) returns integer
language sql stable set search_path = public
as $$
  select coalesce((
    select h.old_price from price_history h
     where h.product_id = p_product and h.changed_at > p_momento
     order by h.changed_at asc
     limit 1), p_base_actual)
$$;

-- ---------------------------------------------------------------------------
-- fn_desglose_impuestos — neto, IVA e impuestos adicionales de una venta
-- ---------------------------------------------------------------------------
-- Réplica de `desglosarImpuestos` en core: agrupa por impuesto (tasa y
-- nombre, en orden de tasa y después de nombre por código de carácter),
-- reparte el descuento global en proporción con la parte entera y el resto al
-- grupo más grande, y deja el IVA por diferencia.
create or replace function public.fn_desglose_impuestos(
  p_sale uuid, p_iva numeric, p_descuento integer
) returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_tasas    numeric[];
  v_nombres  text[];
  v_codigos  integer[];
  v_subs     integer[];
  v_partes   integer[] := '{}';
  v_n        integer;
  v_suma     integer := 0;
  v_d        integer;
  v_rep      integer := 0;
  v_mayor    integer := 1;
  v_s        integer;
  v_neto_g   integer;
  v_ad       integer;
  v_iva_g    integer;
  v_neto     integer := 0;
  v_iva      integer := 0;
  v_total_ad integer := 0;
  v_detalle  jsonb := '[]'::jsonb;
  i          integer;
begin
  select array_agg(tasa order by tasa, nombre collate "C" nulls first),
         array_agg(nombre order by tasa, nombre collate "C" nulls first),
         array_agg(codigo order by tasa, nombre collate "C" nulls first),
         array_agg(s order by tasa, nombre collate "C" nulls first)
    into v_tasas, v_nombres, v_codigos, v_subs
    from (select impuesto_adicional_tasa as tasa,
                 case when impuesto_adicional_tasa > 0 then impuesto_adicional_nombre end as nombre,
                 max(impuesto_adicional_codigo) as codigo,
                 sum(subtotal)::integer as s
            from sale_items where sale_id = p_sale
           group by 1, 2) g;

  v_n := coalesce(array_length(v_tasas, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('neto', 0, 'iva', 0, 'adicionales', 0, 'detalle', '[]'::jsonb);
  end if;

  for i in 1..v_n loop v_suma := v_suma + v_subs[i]; end loop;
  v_d := least(greatest(coalesce(p_descuento, 0), 0), v_suma);
  for i in 1..v_n loop
    v_partes[i] := case when v_suma = 0 or v_d = 0 then 0
                        else floor(v_d::numeric * v_subs[i] / v_suma)::integer end;
    v_rep := v_rep + v_partes[i];
    if v_subs[i] > v_subs[v_mayor] then v_mayor := i; end if;
  end loop;
  v_partes[v_mayor] := v_partes[v_mayor] + (v_d - v_rep);

  for i in 1..v_n loop
    v_s := v_subs[i] - v_partes[i];
    if v_tasas[i] = 0 then
      v_iva_g := round(v_s - v_s / (1 + p_iva / 100.0))::integer;
      v_iva  := v_iva + v_iva_g;
      v_neto := v_neto + v_s - v_iva_g;
    else
      v_neto_g := round(v_s / (1 + p_iva / 100.0 + v_tasas[i] / 100.0))::integer;
      v_ad     := round(v_neto_g * v_tasas[i] / 100.0)::integer;
      v_iva    := v_iva + v_s - v_neto_g - v_ad;
      v_neto   := v_neto + v_neto_g;
      v_total_ad := v_total_ad + v_ad;
      v_detalle := v_detalle || jsonb_build_object(
        'tasa', v_tasas[i], 'nombre', v_nombres[i], 'codigo_sii', v_codigos[i],
        'neto', v_neto_g, 'monto', v_ad);
    end if;
  end loop;

  return jsonb_build_object('neto', v_neto, 'iva', v_iva,
                            'adicionales', v_total_ad, 'detalle', v_detalle);
end $$;

-- ---------------------------------------------------------------------------
-- fn_guardar_impuesto — crear o cambiar un impuesto adicional (solo admin)
-- ---------------------------------------------------------------------------
-- Cambiar la tasa no cambia ventas hechas (la venta la congela). Sí cambia el
-- precio neto de lo que se venda desde ahora, así que queda en la bitácora.
create or replace function public.fn_guardar_impuesto(
  p_id uuid, p_nombre text, p_codigo_sii integer, p_tasa numeric, p_activo boolean default true
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_id     uuid;
  v_antes  impuestos_adicionales%rowtype;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if nullif(trim(p_nombre), '') is null then
    raise exception 'NOMBRE_IMPUESTO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_tasa is null or p_tasa <= 0 or p_tasa >= 100 then
    raise exception 'TASA_INVALIDA' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into impuestos_adicionales (tenant_id, nombre, codigo_sii, tasa, is_active)
    values (v_tenant, trim(p_nombre), p_codigo_sii, p_tasa, coalesce(p_activo, true))
    returning id into v_id;
  else
    select * into v_antes from impuestos_adicionales
     where id = p_id and tenant_id = v_tenant for update;
    if not found then raise exception 'IMPUESTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    update impuestos_adicionales
       set nombre = trim(p_nombre), codigo_sii = p_codigo_sii, tasa = p_tasa,
           is_active = coalesce(p_activo, true), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), case when p_id is null then 'crear' else 'editar' end,
          'impuesto_adicional', v_id,
          case when p_id is null then null else to_jsonb(v_antes) end,
          jsonb_build_object('nombre', trim(p_nombre), 'codigo_sii', p_codigo_sii,
                             'tasa', p_tasa, 'activo', coalesce(p_activo, true)));
  return v_id;
exception when unique_violation then
  raise exception 'IMPUESTO_DUPLICADO' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- fn_asignar_impuesto — un impuesto (o ninguno) a muchos productos de una vez
-- ---------------------------------------------------------------------------
create or replace function public.fn_asignar_impuesto(
  p_productos uuid[], p_impuesto uuid
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_n      integer;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  -- Un impuesto de otro local no se puede asignar: la función corre sin RLS.
  if p_impuesto is not null and not exists (
       select 1 from impuestos_adicionales where id = p_impuesto and tenant_id = v_tenant) then
    raise exception 'IMPUESTO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  update products
     set impuesto_adicional_id = p_impuesto, updated_at = now()
   where tenant_id = v_tenant and id = any(coalesce(p_productos, '{}'))
     and impuesto_adicional_id is distinct from p_impuesto;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into audit_log (tenant_id, user_id, action, entity_type, new_values)
    values (v_tenant, auth.uid(), 'asignar', 'impuesto_adicional',
            jsonb_build_object('impuesto', p_impuesto, 'productos', v_n));
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- fn_guardar_precios_producto — reemplaza los tramos de un producto
-- ---------------------------------------------------------------------------
-- `p_tramos`: [{desde, precio, vigente_desde?, vigente_hasta?}]. Un arreglo
-- vacío quita todas las ofertas. Mismos límites que `validarTramos` en core.
create or replace function public.fn_guardar_precios_producto(
  p_product_id uuid, p_tramos jsonb
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_prod   products%rowtype;
  v_t      jsonb;
  v_desde  numeric;
  v_precio integer;
  v_vd     date;
  v_vh     date;
  v_n      integer := 0;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  select * into v_prod from products
   where id = p_product_id and tenant_id = v_tenant for update;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if p_tramos is not null and jsonb_typeof(p_tramos) <> 'array' then
    raise exception 'TRAMO_INVALIDO' using errcode = 'P0001';
  end if;

  delete from product_price_tiers where product_id = p_product_id;

  for v_t in select * from jsonb_array_elements(coalesce(p_tramos, '[]'::jsonb)) loop
    v_desde  := (v_t->>'desde')::numeric;
    v_precio := (v_t->>'precio')::integer;
    v_vd     := nullif(v_t->>'vigente_desde', '')::date;
    v_vh     := nullif(v_t->>'vigente_hasta', '')::date;
    if v_desde is null or v_desde < 1 or v_precio is null or v_precio <= 0 then
      raise exception 'TRAMO_INVALIDO' using errcode = 'P0001';
    end if;
    if v_precio >= v_prod.sale_price then
      raise exception 'OFERTA_NO_ES_MAS_BARATA' using errcode = 'P0001';
    end if;
    if v_desde = 1 and v_vd is null and v_vh is null then
      raise exception 'OFERTA_SIN_FECHAS_DESDE_1' using errcode = 'P0001';
    end if;
    if v_vd is not null and v_vh is not null and v_vh < v_vd then
      raise exception 'FECHAS_INVERTIDAS' using errcode = 'P0001';
    end if;
    if exists (select 1 from product_price_tiers
                where product_id = p_product_id and desde = v_desde
                  and vigente_desde is not distinct from v_vd
                  and vigente_hasta is not distinct from v_vh) then
      raise exception 'TRAMO_REPETIDO' using errcode = 'P0001';
    end if;
    insert into product_price_tiers (tenant_id, product_id, desde, precio,
                                     vigente_desde, vigente_hasta, created_by)
    values (v_tenant, p_product_id, v_desde, v_precio, v_vd, v_vh, auth.uid());
    v_n := v_n + 1;
  end loop;

  -- El catálogo del celular se sincroniza por `updated_at`.
  update products set updated_at = now() where id = p_product_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'ofertas', 'product', p_product_id,
          jsonb_build_object('tramos', coalesce(p_tramos, '[]'::jsonb)));
  return v_n;
end $$;


-- ---------------------------------------------------------------------------
-- fn_guardar_configuracion — la configuración del local sin entrar a Supabase
-- ---------------------------------------------------------------------------
-- T-18. Hasta ahora `tenants.settings` se cambiaba desde el panel de Supabase.
-- Solo el administrador, y solo claves conocidas con valores dentro de rango:
-- `settings` también guarda el IVA y la zona horaria, y un jsonb abierto
-- dejaría escribir cualquier cosa ahí. `p_cambios` trae solo lo que cambia.
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
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'CONFIGURACION_INVALIDA' using errcode = 'P0001';
  end if;

  for v_clave, v_valor in select * from jsonb_each(p_cambios) loop
    case v_clave
      when 'vender_sin_stock', 'tarjeta_emite_documento' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
      when 'efectivo_inicial_sugerido', 'cash_alert_hours', 'cost_variation_alert_pct' then
        if jsonb_typeof(v_valor) <> 'number' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        v_num := (v_valor #>> '{}')::numeric;
        if v_num < 0 or v_num <> trunc(v_num)
           or (v_clave = 'efectivo_inicial_sugerido' and v_num > 5000000)
           or (v_clave = 'cash_alert_hours' and (v_num < 1 or v_num > 72))
           or (v_clave = 'cost_variation_alert_pct' and (v_num < 1 or v_num > 100)) then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
      else
        raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
    end case;
    v_nuevo := v_nuevo || jsonb_build_object(v_clave, v_valor);
  end loop;

  select settings into v_antes from tenants where id = v_tenant for update;
  update tenants set settings = coalesce(settings, '{}'::jsonb) || v_nuevo where id = v_tenant;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), 'editar', 'configuracion', v_tenant, v_antes, v_nuevo);
  return (select settings from tenants where id = v_tenant);
end $$;

-- S-8 · Con esta función ya no hace falta escribir `tenants` a mano, y la
-- política que lo permitía era una puerta: el administrador del local podía
-- poner el IVA en 0, cambiar la zona horaria y, peor, `status` y `plan`, que
-- son los de la suscripción. Un local suspendido por no pagar se reactivaba
-- solo. Lo encontró la prueba de T-18 al intentarlo. Regla 14.
drop policy if exists tenant_update on tenants;

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0017, con precio validado e impuestos
-- ---------------------------------------------------------------------------
-- Misma firma: reemplazo, no sobrecarga (regla 21).
create or replace function public.fn_register_sale(
  p_client_uuid    uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_sold_at        timestamptz default now(),
  p_discount_total integer   default 0,
  p_notes          text      default null,
  p_force          boolean   default false,
  -- {tipo, rut, razon_social, giro, direccion}. Null = el que corresponda al
  -- medio de pago. Una venta que viene de la cola sin conexion tampoco lo trae.
  p_document       jsonb     default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant    uuid := current_tenant_id();
  v_user      uuid := auth.uid();
  v_role      user_role := current_user_role();
  v_store     uuid;
  v_session   uuid;
  v_sale      uuid;
  v_folio     bigint;
  v_item      jsonb;
  v_pay       jsonb;
  v_product   products%rowtype;
  v_item_id   uuid;
  v_qty       numeric(14,3);
  v_price     integer;
  v_disc      integer;
  v_subtotal  integer;
  v_sum       integer := 0;
  v_bruto     integer := 0;
  v_desc      integer := 0;
  v_tope      numeric;
  v_paid      integer := 0;
  v_change    integer := 0;
  v_stock     numeric(14,3);
  v_iva       numeric;
  v_existing  sales%rowtype;
  v_doc       document_type;
  v_tarjeta   boolean;
  v_maquina   boolean;
  v_rut       text;
  v_razon     text;
  v_sin_stock boolean;
  -- 0018
  v_momento   timestamptz := coalesce(p_sold_at, now());
  v_dia       date;
  v_lista     integer;
  v_entonces  integer;
  v_ref       integer;
  v_bruto_ref integer := 0;
  v_implicito integer := 0;
  v_tasa      numeric(5,2);
  v_imp_nom   text;
  v_imp_cod   integer;
  v_des       jsonb;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;

  -- (1) CP-03b. Dos envíos de la misma venta se esperan uno al otro acá. Sin
  -- esto, el segundo no ve al primero (todavía no confirma), sigue de largo y
  -- choca contra el índice único al insertar.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || p_client_uuid::text, 0));

  select * into v_existing from sales
   where tenant_id = v_tenant and client_uuid = p_client_uuid;
  if found then
    return jsonb_build_object(
      'sale_id', v_existing.id, 'folio', v_existing.folio,
      'total', v_existing.total, 'change_amount', 0,
      'sold_at', v_existing.sold_at, 'synced_at', v_existing.synced_at,
      'already_existed', true, 'document_type', v_existing.document_type);
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'VENTA_VACIA' using errcode = 'P0001';
  end if;

  -- 0015 - Que documento corresponde. Se decide antes de tocar nada: una venta
  -- con los datos del receptor mal puestos no debe dejar stock movido.
  v_tarjeta := exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) x
                        where x->>'method' in ('debito','credito'));
  select coalesce((settings->>'tarjeta_emite_documento')::boolean, true)
    into v_maquina from tenants where id = v_tenant;
  v_maquina := coalesce(v_maquina, true) and v_tarjeta;
  select coalesce((settings->>'vender_sin_stock')::boolean, false)
    into v_sin_stock from tenants where id = v_tenant;
  v_sin_stock := coalesce(v_sin_stock, false);

  v_doc := nullif(p_document->>'tipo','')::document_type;
  if v_doc is null then
    v_doc := case when v_maquina then 'voucher' else 'boleta' end::document_type;
  end if;
  if v_doc = 'boleta' and v_maquina then
    raise exception 'DOCUMENTO_LO_EMITE_LA_MAQUINA' using errcode = 'P0001';
  end if;
  if v_doc = 'voucher' and not v_maquina then
    raise exception 'VOUCHER_SIN_TARJETA' using errcode = 'P0001';
  end if;
  if v_doc = 'factura' then
    v_razon := nullif(trim(p_document->>'razon_social'), '');
    if v_razon is null then
      raise exception 'RAZON_SOCIAL_REQUERIDA' using errcode = 'P0001';
    end if;
    v_rut := fn_rut_formateado(p_document->>'rut');
    if v_rut is null then
      raise exception 'RUT_INVALIDO' using errcode = 'P0001';
    end if;
  else
    v_rut := null; v_razon := null;
  end if;

  -- (2) CP-07. `for share`: varias ventas de la misma caja no se esperan entre
  -- sí, pero el cierre (que pide `for update`) espera a que terminen, y una
  -- venta que llega con el cierre en curso espera al cierre y después ya no
  -- encuentra la caja abierta.
  select id, store_id into v_session, v_store
    from cash_sessions where user_id = v_user and status = 'abierta'
   limit 1
     for share;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  v_folio := fn_next_folio(v_tenant);

  -- 0018 · El día del local en que se vendió, para las ofertas con fecha.
  v_dia := (v_momento at time zone fn_tenant_timezone(v_tenant))::date;

  -- (3) Stock bloqueado de una vez y en orden, antes de leerlo.
  perform fn_lock_stock(v_tenant, v_store, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x));

  insert into sales (tenant_id, store_id, folio, cash_session_id, sold_by,
                     sold_at, synced_at, client_uuid, notes, discount_total,
                     document_type, receptor_rut, receptor_razon_social,
                     receptor_giro, receptor_direccion)
  values (v_tenant, v_store, v_folio, v_session, v_user,
          coalesce(p_sold_at, now()), now(), p_client_uuid, p_notes,
          coalesce(p_discount_total,0),
          v_doc, v_rut, v_razon,
          nullif(trim(p_document->>'giro'), ''),
          nullif(trim(p_document->>'direccion'), ''))
  returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products
     where id = (v_item->>'product_id')::uuid and tenant_id = v_tenant;
    if not found then
      raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
    end if;
    if not v_product.is_active then
      raise exception 'PRODUCTO_INACTIVO: %', v_product.name using errcode = 'P0001';
    end if;

    v_qty   := (v_item->>'quantity')::numeric;

    -- 0018 · El precio que corresponde a esta cantidad, hoy y a la hora de la
    -- venta (una venta sin conexión llega con el precio que tenía). Se toma
    -- el menor. La hora de la venta la manda el dispositivo: más de 7 días
    -- atrás no se le cree.
    v_lista := fn_precio_por_cantidad(v_product.id, v_product.sale_price, v_qty, v_dia);
    if v_momento >= now() - interval '7 days' then
      v_entonces := fn_precio_por_cantidad(
        v_product.id, fn_precio_base_en(v_product.id, v_product.sale_price, v_momento), v_qty, v_dia);
    else
      v_entonces := v_lista;
    end if;
    v_ref := least(v_lista, v_entonces);

    v_price := coalesce((v_item->>'unit_price')::integer, v_lista);
    v_disc  := coalesce((v_item->>'discount_amount')::integer, 0);
    if v_disc < 0 or v_price < 0 then
      raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
    end if;
    -- T-14 · Cobrar menos de lo que corresponde es un descuento, y pasa por el
    -- mismo tope que los descuentos declarados.
    v_implicito := v_implicito + greatest(round(v_qty * v_ref)::integer - round(v_qty * v_price)::integer, 0);
    v_bruto_ref := v_bruto_ref + round(v_qty * v_ref)::integer;

    -- 0018 · El impuesto adicional se congela en la línea.
    v_tasa := 0; v_imp_nom := null; v_imp_cod := null;
    if v_product.impuesto_adicional_id is not null then
      select tasa, nombre, codigo_sii into v_tasa, v_imp_nom, v_imp_cod
        from impuestos_adicionales
       where id = v_product.impuesto_adicional_id and is_active;
      v_tasa := coalesce(v_tasa, 0);
      if v_tasa = 0 then v_imp_nom := null; v_imp_cod := null; end if;
    end if;
    v_subtotal := round(v_qty * v_price)::integer - v_disc;
    if v_subtotal < 0 then v_subtotal := 0; end if;
    v_bruto := v_bruto + round(v_qty * v_price)::integer;
    v_desc  := v_desc + v_disc;
    v_sum := v_sum + v_subtotal;

    select quantity into v_stock from stock_levels
     where tenant_id = v_tenant and store_id = v_store and product_id = v_product.id;
    -- 0017 · respuesta 13: el local decide si cualquiera vende sin stock.
    if coalesce(v_stock,0) < v_qty and not p_force and not v_sin_stock
       and coalesce(v_role::text, '') not in ('admin','supervisor') then
      raise exception 'STOCK_INSUFICIENTE: %', v_product.name using errcode = 'P0001';
    end if;

    insert into sale_items (sale_id, tenant_id, product_id, product_name,
                            quantity, unit_price, unit_cost, discount_amount, subtotal,
                            precio_lista, impuesto_adicional_tasa,
                            impuesto_adicional_nombre, impuesto_adicional_codigo)
    values (v_sale, v_tenant, v_product.id, v_product.name,
            v_qty, v_price, v_product.avg_cost, v_disc, v_subtotal,
            v_ref, v_tasa, v_imp_nom, v_imp_cod)
    returning id into v_item_id;

    if v_product.tracks_expiry then
      perform fn_consume_lots(v_tenant, v_store, v_product.id, v_qty, v_item_id);
    end if;

    perform fn_post_movement(v_tenant, v_store, v_product.id, 'venta',
                             -v_qty, v_product.avg_cost, 'sale', v_sale, null, v_user);
  end loop;

  v_desc := v_desc + coalesce(p_discount_total, 0);
  if v_desc + v_implicito > 0 then
    select coalesce(max_discount_pct, 0) into v_tope from profiles where id = v_user;
    -- El porcentaje se mide contra lo que correspondía cobrar, no contra lo
    -- que se cobró: si no, bajar el precio achicaría la base del tope.
    if not fn_discount_within_limit(v_desc + v_implicito, greatest(v_bruto_ref, v_bruto), v_tope) then
      raise exception 'DESCUENTO_EXCEDE_LIMITE' using errcode = 'P0001';
    end if;
    v_sum := v_sum - coalesce(p_discount_total, 0);
    if v_sum < 0 then v_sum := 0; end if;
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_paid := v_paid + (v_pay->>'amount')::integer;
    insert into sale_payments (sale_id, tenant_id, method, amount, received_amount, change_amount)
    values (v_sale, v_tenant, (v_pay->>'method')::payment_method,
            (v_pay->>'amount')::integer,
            nullif(v_pay->>'received_amount','')::integer,
            greatest(coalesce(nullif(v_pay->>'received_amount','')::integer,0)
                     - (v_pay->>'amount')::integer, 0));
  end loop;

  if v_paid <> v_sum then
    raise exception 'PAGO_NO_CUADRA' using errcode = 'P0001';
  end if;

  select coalesce((settings->>'iva_pct')::numeric, 19) into v_iva
    from tenants where id = v_tenant;
  select coalesce(sum(greatest(coalesce(received_amount,0) - amount, 0)), 0)
    into v_change from sale_payments where sale_id = v_sale;

  -- 0018 · IVA e impuestos adicionales. Sin adicionales da lo mismo que la
  -- fórmula de antes, round(total - total / 1,19).
  v_des := fn_desglose_impuestos(v_sale, v_iva, coalesce(p_discount_total, 0));

  update sales
     set subtotal   = v_bruto,
         discount_total = v_desc,
         total      = v_sum,
         tax_amount = (v_des->>'iva')::integer,
         neto       = (v_des->>'neto')::integer,
         impuestos_adicionales = (v_des->>'adicionales')::integer,
         impuestos_detalle     = v_des->'detalle'
   where id = v_sale;

  return jsonb_build_object(
    'sale_id', v_sale, 'folio', v_folio, 'total', v_sum,
    'change_amount', v_change, 'sold_at', coalesce(p_sold_at, now()),
    'synced_at', now(), 'already_existed', false,
    'document_type', v_doc,
    'neto', (v_des->>'neto')::integer, 'iva', (v_des->>'iva')::integer,
    'impuestos_adicionales', (v_des->>'adicionales')::integer);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- Regla 12: se revoca a `public`. Las internas no se exponen a nadie: las
-- usa fn_register_sale, que corre como dueña.
revoke execute on function public.fn_precio_por_cantidad(uuid, integer, numeric, date) from public, anon, authenticated;
revoke execute on function public.fn_precio_base_en(uuid, integer, timestamptz)        from public, anon, authenticated;
revoke execute on function public.fn_desglose_impuestos(uuid, numeric, integer)         from public, anon, authenticated;

revoke execute on function public.fn_guardar_impuesto(uuid, text, integer, numeric, boolean) from public, anon;
revoke execute on function public.fn_asignar_impuesto(uuid[], uuid)                         from public, anon;
revoke execute on function public.fn_guardar_precios_producto(uuid, jsonb)                  from public, anon;
grant  execute on function public.fn_guardar_impuesto(uuid, text, integer, numeric, boolean) to authenticated;
grant  execute on function public.fn_asignar_impuesto(uuid[], uuid)                         to authenticated;
grant  execute on function public.fn_guardar_precios_producto(uuid, jsonb)                  to authenticated;
revoke execute on function public.fn_guardar_configuracion(jsonb) from public, anon;
grant  execute on function public.fn_guardar_configuracion(jsonb) to authenticated;

-- Las ventas que ya existen: el neto que antes no se guardaba.
update sales set neto = total - tax_amount where neto is null;
