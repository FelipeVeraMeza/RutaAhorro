-- ============================================================================
-- 0023 · Combos entre productos distintos: «2 bebidas + 1 pan por $3.000»
--
-- Decisión de Felipe (2026-09-27): el combo se aplica solo. El POS lo aplica
-- las veces que quepa y reparte el ahorro entre las líneas del combo como
-- descuento de cada línea; la base calcula por su cuenta cuánto se puede
-- ahorrar (`fn_ahorro_combos`, réplica de `calcularCombos` en core) y ese
-- monto no cuenta contra el tope de descuento del rol. Lo que pase de ahí sí.
--
-- La regla (igual en core):
--   · El ahorro de una aplicación es lo que se pagaría por sus productos al
--     precio que corresponde a cada línea (con su oferta o su precio de
--     cliente) menos el precio del combo. Nunca se suma a otra rebaja.
--   · De mayor a menor ahorro por aplicación (empate: id en orden de bytes,
--     el mismo que compara JavaScript), cada uno las veces que alcance con lo
--     que queda. Un producto usado por un combo no se usa en otro.
--   · Es una promoción: se apaga con el interruptor de ofertas (0021).
--
-- El descuento va en la línea (`sale_items.discount_amount`) para que el
-- desglose de impuestos por línea y las devoluciones parciales, que trabajan
-- con el subtotal de cada línea, lo respeten sin saber de combos.
-- ============================================================================

create table if not exists combos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) > 0),
  precio         integer not null check (precio > 0),
  vigente_desde  date,
  vigente_hasta  date,
  is_active      boolean not null default true,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (vigente_desde is null or vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create table if not exists combo_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  combo_id    uuid not null references combos(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  cantidad    numeric(14,3) not null check (cantidad > 0),
  unique (combo_id, product_id)
);
create index if not exists idx_combos_tenant on combos(tenant_id) where is_active;

-- Lo que la venta ahorró en combos, y cuáles.
alter table sales
  add column if not exists descuento_combos integer not null default 0,
  add column if not exists combos_aplicados jsonb   not null default '[]'::jsonb;

alter table combos      enable row level security;
alter table combo_items enable row level security;
drop policy if exists combos_read on combos;
create policy combos_read on combos for select to authenticated
  using (tenant_id = current_tenant_id());
drop policy if exists combo_items_read on combo_items;
create policy combo_items_read on combo_items for select to authenticated
  using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- fn_ahorro_combos — cuánto se puede ahorrar en combos con estas líneas
-- ---------------------------------------------------------------------------
-- `p_lineas`: [{product_id, cantidad, precio}], con el precio que corresponde
-- a cada línea. Devuelve {total, aplicados: [{combo_id, nombre, veces, ahorro}]}.
create or replace function public.fn_ahorro_combos(p_tenant uuid, p_lineas jsonb, p_dia date)
returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_disp      jsonb := '{}'::jsonb;
  v_prec      jsonb := '{}'::jsonb;
  v_l         jsonb;
  v_pid       text;
  v_c         record;
  v_it        record;
  v_veces     numeric;
  v_total     integer := 0;
  v_aplicados jsonb := '[]'::jsonb;
begin
  for v_l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    v_pid  := v_l->>'product_id';
    v_disp := v_disp || jsonb_build_object(v_pid,
                coalesce((v_disp->>v_pid)::numeric, 0) + (v_l->>'cantidad')::numeric);
    -- Dos líneas del mismo producto: vale la más barata, como en core.
    v_prec := v_prec || jsonb_build_object(v_pid,
                least(coalesce((v_prec->>v_pid)::numeric, (v_l->>'precio')::numeric), (v_l->>'precio')::numeric));
  end loop;

  for v_c in
    select c.id, c.nombre,
           round(sum((v_prec->>i.product_id::text)::numeric * i.cantidad))::integer - c.precio as ahorro
      from combos c join combo_items i on i.combo_id = c.id
     where c.tenant_id = p_tenant and c.is_active
       and (c.vigente_desde is null or (p_dia is not null and c.vigente_desde <= p_dia))
       and (c.vigente_hasta is null or (p_dia is not null and c.vigente_hasta >= p_dia))
     group by c.id
    having bool_and(v_prec ? i.product_id::text)
     order by 3 desc, c.id::text collate "C" asc
  loop
    if v_c.ahorro <= 0 then continue; end if;
    v_veces := null;
    for v_it in select product_id::text as pid, cantidad from combo_items where combo_id = v_c.id loop
      v_veces := least(coalesce(v_veces, 1e15), floor(coalesce((v_disp->>v_it.pid)::numeric, 0) / v_it.cantidad));
    end loop;
    if v_veces is null or v_veces < 1 then continue; end if;
    for v_it in select product_id::text as pid, cantidad from combo_items where combo_id = v_c.id loop
      v_disp := v_disp || jsonb_build_object(v_it.pid, (v_disp->>v_it.pid)::numeric - v_veces * v_it.cantidad);
    end loop;
    v_total := v_total + v_c.ahorro * v_veces::integer;
    v_aplicados := v_aplicados || jsonb_build_object(
      'combo_id', v_c.id, 'nombre', v_c.nombre, 'veces', v_veces::integer, 'ahorro', v_c.ahorro * v_veces::integer);
  end loop;

  return jsonb_build_object('total', v_total, 'aplicados', v_aplicados);
end $$;

-- ---------------------------------------------------------------------------
-- fn_guardar_combo — crea (p_id null) o cambia un combo
-- ---------------------------------------------------------------------------
-- `p_datos`: {nombre, precio, vigente_desde?, vigente_hasta?, activo?,
-- items: [{product_id, cantidad}]}. Mismos límites que `validarCombo` en core.
create or replace function public.fn_guardar_combo(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_nombre  text := nullif(trim(p_datos->>'nombre'), '');
  v_precio  numeric;
  v_vd      date;
  v_vh      date;
  v_it      jsonb;
  v_prod    products%rowtype;
  v_cant    numeric;
  v_normal  numeric := 0;
  v_ids     uuid[] := '{}';
  v_id      uuid;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if v_nombre is null then raise exception 'NOMBRE_COMBO_REQUERIDO' using errcode = 'P0001'; end if;
  begin
    v_precio := (p_datos->>'precio')::numeric;
    v_vd := nullif(p_datos->>'vigente_desde', '')::date;
    v_vh := nullif(p_datos->>'vigente_hasta', '')::date;
  exception when others then
    raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
  end;
  if v_precio is null or v_precio <= 0 or v_precio <> trunc(v_precio) then
    raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
  end if;
  if v_vd is not null and v_vh is not null and v_vh < v_vd then
    raise exception 'FECHAS_INVERTIDAS' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_datos->'items') is distinct from 'array' then
    raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
  end if;

  for v_it in select * from jsonb_array_elements(p_datos->'items') loop
    begin
      v_cant := (v_it->>'cantidad')::numeric;
      select * into v_prod from products
       where id = (v_it->>'product_id')::uuid and tenant_id = v_tenant and is_active;
    exception when others then
      raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
    end;
    if v_prod.id is null then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    if v_cant is null or v_cant <= 0 then raise exception 'COMBO_INVALIDO' using errcode = 'P0001'; end if;
    if v_prod.id = any(v_ids) then raise exception 'COMBO_PRODUCTO_REPETIDO' using errcode = 'P0001'; end if;
    v_ids := v_ids || v_prod.id;
    v_normal := v_normal + v_prod.sale_price * v_cant;
    v_prod := null;
  end loop;
  if cardinality(v_ids) < 2 then raise exception 'COMBO_UN_SOLO_PRODUCTO' using errcode = 'P0001'; end if;
  if v_precio >= round(v_normal) then raise exception 'COMBO_NO_ES_MAS_BARATO' using errcode = 'P0001'; end if;

  if p_id is null then
    insert into combos (tenant_id, nombre, precio, vigente_desde, vigente_hasta, is_active, created_by)
    values (v_tenant, v_nombre, v_precio::integer, v_vd, v_vh, coalesce((p_datos->>'activo')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update combos set nombre = v_nombre, precio = v_precio::integer, vigente_desde = v_vd, vigente_hasta = v_vh,
                      is_active = coalesce((p_datos->>'activo')::boolean, true), updated_at = now()
     where id = p_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'COMBO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    delete from combo_items where combo_id = v_id;
  end if;
  insert into combo_items (tenant_id, combo_id, product_id, cantidad)
  select v_tenant, v_id, (x->>'product_id')::uuid, (x->>'cantidad')::numeric
    from jsonb_array_elements(p_datos->'items') x;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), case when p_id is null then 'crear' else 'editar' end, 'combo', v_id, p_datos);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0022, con combos
-- ---------------------------------------------------------------------------
-- Misma firma (regla 21). El ahorro de los combos que calcula la base no
-- cuenta contra el tope de descuento; lo que el POS descuente de más, sí.
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
  v_dte       jsonb;
  -- 0021
  v_ofertas_hoy      boolean;
  v_ofertas_entonces boolean;
  -- 0022
  v_cliente          uuid;
  v_cli              integer;
  -- 0023
  v_lineas           jsonb := '[]'::jsonb;
  v_combos           jsonb := '{"total": 0, "aplicados": []}'::jsonb;
  v_desc_combos      integer := 0;
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
    -- 0019 · El reenvío recibe el mismo documento, no uno nuevo.
    return jsonb_build_object(
      'sale_id', v_existing.id, 'folio', v_existing.folio,
      'total', v_existing.total, 'change_amount', 0,
      'sold_at', v_existing.sold_at, 'synced_at', v_existing.synced_at,
      'already_existed', true, 'document_type', v_existing.document_type,
      'dte', (select fn_dte_resumen(d.id) from dte_documentos d
               where d.sale_id = v_existing.id and d.tipo in (33, 39) limit 1));
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

  -- 0022 · El cliente. Uno que no es del local, o que está desactivado, no
  -- vende a su precio: se rechaza en vez de cobrar a precio normal sin avisar.
  v_cliente := nullif(p_document->>'cliente_id', '')::uuid;
  if v_cliente is not null and not exists (
       select 1 from clientes where id = v_cliente and tenant_id = v_tenant and is_active) then
    raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  -- RQ-20 · La factura deja al receptor guardado para la próxima vez. Se
  -- completan los datos que falten; los que ya están no se pisan.
  if v_doc = 'factura' then
    if v_cliente is null then
      select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_rut;
    end if;
    if v_cliente is null then
      insert into clientes (tenant_id, rut, nombre, giro, direccion, created_by)
      values (v_tenant, v_rut, v_razon, nullif(trim(p_document->>'giro'), ''),
              nullif(trim(p_document->>'direccion'), ''), v_user)
      on conflict (tenant_id, rut) where rut is not null do nothing
      returning id into v_cliente;
      -- Otra caja lo creó en el mismo instante.
      if v_cliente is null then
        select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_rut;
      end if;
    else
      update clientes
         set giro      = coalesce(giro, nullif(trim(p_document->>'giro'), '')),
             direccion = coalesce(direccion, nullif(trim(p_document->>'direccion'), ''))
       where id = v_cliente;
    end if;
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
  -- 0021 · ¿Rigen las ofertas hoy, y regían cuando se vendió?
  v_ofertas_hoy      := fn_ofertas_rigen(v_tenant, now());
  v_ofertas_entonces := fn_ofertas_rigen(v_tenant, v_momento);

  -- (3) Stock bloqueado de una vez y en orden, antes de leerlo.
  perform fn_lock_stock(v_tenant, v_store, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x));

  insert into sales (tenant_id, store_id, folio, cash_session_id, sold_by,
                     sold_at, synced_at, client_uuid, notes, discount_total,
                     document_type, receptor_rut, receptor_razon_social,
                     receptor_giro, receptor_direccion, cliente_id)
  values (v_tenant, v_store, v_folio, v_session, v_user,
          coalesce(p_sold_at, now()), now(), p_client_uuid, p_notes,
          coalesce(p_discount_total,0),
          v_doc, v_rut, v_razon,
          nullif(trim(p_document->>'giro'), ''),
          nullif(trim(p_document->>'direccion'), ''), v_cliente)
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
    v_lista := case when v_ofertas_hoy
                    then fn_precio_por_cantidad(v_product.id, v_product.sale_price, v_qty, v_dia)
                    else v_product.sale_price end;
    if v_momento >= now() - interval '7 days' then
      v_entonces := fn_precio_base_en(v_product.id, v_product.sale_price, v_momento);
      if v_ofertas_entonces then
        v_entonces := fn_precio_por_cantidad(v_product.id, v_entonces, v_qty, v_dia);
      end if;
    else
      v_entonces := v_lista;
    end if;
    -- 0022 · El precio del cliente, si tiene uno y es menor. No se suma a la
    -- oferta: gana el más barato.
    if v_cliente is not null then
      v_cli := fn_precio_cliente(v_cliente, v_product.id, v_product.sale_price);
      if v_cli is not null then
        v_lista := least(v_lista, v_cli);
      end if;
    end if;
    v_ref := least(v_lista, v_entonces);
    -- 0023 · Para medir los combos contra lo que corresponde a cada línea.
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'cantidad', v_qty, 'precio', v_ref));

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
  -- 0023 · Los combos son una promoción: rigen si regían las ofertas.
  if v_ofertas_hoy or v_ofertas_entonces then
    v_combos := fn_ahorro_combos(v_tenant, v_lineas, v_dia);
    v_desc_combos := (v_combos->>'total')::integer;
  end if;
  if v_desc + v_implicito > 0 then
    select coalesce(max_discount_pct, 0) into v_tope from profiles where id = v_user;
    -- El porcentaje se mide contra lo que correspondía cobrar, no contra lo
    -- que se cobró: si no, bajar el precio achicaría la base del tope.
    if not fn_discount_within_limit(greatest(v_desc + v_implicito - v_desc_combos, 0), greatest(v_bruto_ref, v_bruto), v_tope) then
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
         impuestos_detalle     = v_des->'detalle',
         -- Lo que se ahorró en combos, nunca más que lo que se descontó.
         descuento_combos      = least(v_desc_combos, v_desc),
         combos_aplicados      = case when v_desc > 0 then v_combos->'aplicados' else '[]'::jsonb end
   where id = v_sale;

  -- 0019 · La boleta o la factura, en la misma transacción que la venta. Si
  -- no se puede emitir (folios agotados en producción), la venta no queda.
  -- El voucher lo emite la máquina: no se registra documento.
  v_dte := fn_emitir_dte_venta(v_sale);

  return jsonb_build_object(
    'sale_id', v_sale, 'folio', v_folio, 'total', v_sum,
    'change_amount', v_change, 'sold_at', coalesce(p_sold_at, now()),
    'synced_at', now(), 'already_existed', false,
    'document_type', v_doc,
    'neto', (v_des->>'neto')::integer, 'iva', (v_des->>'iva')::integer,
    'impuestos_adicionales', (v_des->>'adicionales')::integer,
    'dte', v_dte);
end $$;


-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_ahorro_combos(uuid, jsonb, date) from public, anon, authenticated;
revoke execute on function public.fn_guardar_combo(uuid, jsonb)       from public, anon;
grant  execute on function public.fn_guardar_combo(uuid, jsonb)       to authenticated;
