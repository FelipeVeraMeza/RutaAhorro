-- ============================================================================
-- 0022 · Clientes y precio por cliente (RQ-20, RQ-21, RQ-07)
--
-- Respuestas 6 y 19 del cuestionario: hay precio especial «por cliente y por
-- promoción», y los datos del receptor de una factura se escriben cada vez.
-- Decisión de Felipe (2026-09-27): cada cliente tiene un % de rebaja general
-- (el mayorista, 8 %) y, si hace falta, un precio especial en productos
-- puntuales. Se cobra EL MÁS BARATO entre la oferta del producto, el % del
-- cliente y su precio especial. No se suman: un mayorista con 8 % no gana
-- además el 10 % de la oferta por cantidad.
--
-- (1) `clientes`: RUT (único en el local, opcional: un cliente de mostrador
--     no tiene por qué darlo), nombre o razón social, giro, dirección,
--     contacto, % de rebaja. `cliente_precios`: el precio especial de un
--     producto para un cliente.
--
-- (2) La venta recibe el cliente dentro de `p_document` (`cliente_id`), así
--     que `fn_register_sale` conserva su firma (regla 21) y la cola sin
--     conexión lo lleva sin cambiar de forma. El precio del cliente entra en
--     "lo que corresponde": un vendedor con tope 0 % puede cobrarlo, porque
--     no es un descuento suyo sino un acuerdo que configuró el dueño.
--     La venta guarda el cliente (`sales.cliente_id`): quién compró a precio
--     mayorista queda a la vista.
--
-- (3) RQ-20. Una factura a un RUT que no existe crea el cliente con los datos
--     del receptor; a uno que existe se le completan los datos que le falten
--     (nunca se pisan: el que factura puede ser un vendedor, y el % de rebaja
--     no lo toca nadie más que admin o supervisor).
--
-- Los precios por cliente NO se apagan con el interruptor de ofertas (0021).
-- ============================================================================

create table if not exists clientes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  rut           text,
  nombre        text not null check (length(trim(nombre)) > 0),
  giro          text,
  direccion     text,
  comuna        text,
  telefono      text,
  email         text,
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct >= 0 and descuento_pct < 100),
  notas         text,
  is_active     boolean not null default true,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists clientes_rut_unico on clientes(tenant_id, rut) where rut is not null;
create index if not exists idx_clientes_tenant on clientes(tenant_id, nombre);

create table if not exists cliente_precios (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  cliente_id  uuid not null references clientes(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  precio      integer not null check (precio > 0),
  created_at  timestamptz not null default now(),
  unique (cliente_id, product_id)
);

alter table sales add column if not exists cliente_id uuid references clientes(id) on delete set null;
create index if not exists idx_sales_cliente on sales(cliente_id) where cliente_id is not null;

-- RLS: se leen en el local (el vendedor elige al cliente en el POS); se
-- escriben solo con las funciones (regla 14).
alter table clientes        enable row level security;
alter table cliente_precios enable row level security;
drop policy if exists clientes_read on clientes;
create policy clientes_read on clientes for select to authenticated
  using (tenant_id = current_tenant_id());
drop policy if exists cliente_precios_read on cliente_precios;
create policy cliente_precios_read on cliente_precios for select to authenticated
  using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- fn_precio_cliente — el precio de cada unidad para ese cliente, o null
-- ---------------------------------------------------------------------------
-- Réplica de `precioParaCliente` en core: el menor entre su precio especial
-- del producto y el precio normal menos su %. Null si no tiene ninguno.
create or replace function public.fn_precio_cliente(
  p_cliente uuid, p_product uuid, p_base integer
) returns integer
language sql stable set search_path = public
as $$
  select nullif(least(
           coalesce((select cp.precio from cliente_precios cp
                      where cp.cliente_id = p_cliente and cp.product_id = p_product), 2147483647),
           case when c.descuento_pct > 0 then fn_precio_tramo(p_base, null, c.descuento_pct)
                else 2147483647 end),
         2147483647)
    from clientes c where c.id = p_cliente
$$;

-- ---------------------------------------------------------------------------
-- fn_guardar_cliente — crea (p_id null) o cambia un cliente
-- ---------------------------------------------------------------------------
-- `p_datos`: {rut, nombre, giro, direccion, comuna, telefono, email,
-- descuento_pct, notas, activo}.
create or replace function public.fn_guardar_cliente(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_rut    text;
  v_nombre text := nullif(trim(p_datos->>'nombre'), '');
  v_pct    numeric;
  v_antes  jsonb;
  v_id     uuid;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if v_nombre is null then raise exception 'NOMBRE_CLIENTE_REQUERIDO' using errcode = 'P0001'; end if;
  if nullif(trim(p_datos->>'rut'), '') is not null then
    v_rut := fn_rut_formateado(p_datos->>'rut');
    if v_rut is null then raise exception 'RUT_INVALIDO' using errcode = 'P0001'; end if;
  end if;
  begin
    v_pct := coalesce(nullif(p_datos->>'descuento_pct', '')::numeric, 0);
  exception when others then
    raise exception 'PORCENTAJE_INVALIDO' using errcode = 'P0001';
  end;
  if v_pct < 0 or v_pct >= 100 or v_pct <> round(v_pct, 2) then
    raise exception 'PORCENTAJE_INVALIDO' using errcode = 'P0001';
  end if;
  if v_rut is not null and exists (select 1 from clientes where tenant_id = v_tenant and rut = v_rut
                                      and id is distinct from p_id) then
    raise exception 'CLIENTE_RUT_DUPLICADO' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into clientes (tenant_id, rut, nombre, giro, direccion, comuna, telefono, email,
                          descuento_pct, notas, is_active, created_by)
    values (v_tenant, v_rut, v_nombre,
            nullif(trim(p_datos->>'giro'), ''), nullif(trim(p_datos->>'direccion'), ''),
            nullif(trim(p_datos->>'comuna'), ''), nullif(trim(p_datos->>'telefono'), ''),
            nullif(trim(p_datos->>'email'), ''), v_pct, nullif(trim(p_datos->>'notas'), ''),
            coalesce((p_datos->>'activo')::boolean, true), auth.uid())
    returning id into v_id;
  else
    select to_jsonb(c) into v_antes from clientes c where id = p_id and tenant_id = v_tenant for update;
    if v_antes is null then raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    update clientes set
      rut = v_rut, nombre = v_nombre,
      giro = nullif(trim(p_datos->>'giro'), ''), direccion = nullif(trim(p_datos->>'direccion'), ''),
      comuna = nullif(trim(p_datos->>'comuna'), ''), telefono = nullif(trim(p_datos->>'telefono'), ''),
      email = nullif(trim(p_datos->>'email'), ''), descuento_pct = v_pct,
      notas = nullif(trim(p_datos->>'notas'), ''),
      is_active = coalesce((p_datos->>'activo')::boolean, true), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), case when p_id is null then 'crear' else 'editar' end, 'cliente', v_id,
          v_antes, p_datos);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- fn_guardar_precios_cliente — reemplaza los precios especiales de un cliente
-- ---------------------------------------------------------------------------
-- `p_precios`: [{product_id, precio}]. Vacío quita todos.
create or replace function public.fn_guardar_precios_cliente(p_cliente_id uuid, p_precios jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_p      jsonb;
  v_prod   uuid;
  v_precio numeric;
  v_n      integer := 0;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  perform 1 from clientes where id = p_cliente_id and tenant_id = v_tenant for update;
  if not found then raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if p_precios is not null and jsonb_typeof(p_precios) <> 'array' then
    raise exception 'PRECIO_CLIENTE_INVALIDO' using errcode = 'P0001';
  end if;

  delete from cliente_precios where cliente_id = p_cliente_id;
  for v_p in select * from jsonb_array_elements(coalesce(p_precios, '[]'::jsonb)) loop
    begin
      v_prod   := (v_p->>'product_id')::uuid;
      v_precio := (v_p->>'precio')::numeric;
    exception when others then
      raise exception 'PRECIO_CLIENTE_INVALIDO' using errcode = 'P0001';
    end;
    if v_precio is null or v_precio <= 0 or v_precio <> trunc(v_precio) then
      raise exception 'PRECIO_CLIENTE_INVALIDO' using errcode = 'P0001';
    end if;
    -- Un producto de otro local se trata como inexistente.
    if not exists (select 1 from products where id = v_prod and tenant_id = v_tenant) then
      raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
    end if;
    insert into cliente_precios (tenant_id, cliente_id, product_id, precio)
    values (v_tenant, p_cliente_id, v_prod, v_precio::integer)
    on conflict (cliente_id, product_id) do update set precio = excluded.precio;
    v_n := v_n + 1;
  end loop;
  update clientes set updated_at = now() where id = p_cliente_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'precios', 'cliente', p_cliente_id,
          jsonb_build_object('precios', coalesce(p_precios, '[]'::jsonb)));
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0021, con el cliente de la venta
-- ---------------------------------------------------------------------------
-- Misma firma (regla 21): el cliente llega en `p_document.cliente_id`.
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
revoke execute on function public.fn_precio_cliente(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.fn_guardar_cliente(uuid, jsonb)         from public, anon;
revoke execute on function public.fn_guardar_precios_cliente(uuid, jsonb) from public, anon;
grant  execute on function public.fn_guardar_cliente(uuid, jsonb)         to authenticated;
grant  execute on function public.fn_guardar_precios_cliente(uuid, jsonb) to authenticated;
