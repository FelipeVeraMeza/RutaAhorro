-- ============================================================================
-- 0026 · Facturación: factura manual, facturas recibidas, resumen mensual y
--        la cola del emisor real (robot del portal del SII)
--
-- Pedido de Felipe (2026-09-28): un módulo aparte, /facturacion, para admin y
-- supervisor, donde se emite una factura a mano (la boleta sigue saliendo del
-- POS), con el receptor autocompletado desde Clientes, el historial de lo
-- emitido y lo recibido, y las compras y ventas por mes.
--
-- Decisiones confirmadas por Felipe el 28-09:
--   · Una línea que es un producto del catálogo DESCUENTA STOCK, igual que una
--     venta del POS (kardex, sala, lotes FEFO). Una línea libre (flete,
--     servicio) no.
--   · La emisión real va por el robot del portal gratuito del SII (el de
--     VSV-Contadores, adaptado al worker), no por un proveedor de DTE.
--
-- Cómo se emite:
--   · SIMULACIÓN (hoy): en la misma transacción se crea el documento 33 de
--     0019, con folio simulado, y el XML y el timbre salen de core. Igual que
--     la boleta, dice SIN VALIDEZ TRIBUTARIA.
--   · PORTAL DEL SII (apagado hasta B-04/B-05): la factura queda "por_emitir"
--     con el stock ya movido. El worker la toma, la emite en el portal, lee el
--     folio que ASIGNA EL SII y lo registra (fn_sii_registrar_emision). El
--     folio no sale de acá: con el portal, el CAF lo administra el SII.
--
-- Por qué una tabla propia y no una fila de `sales`: `sale_items` exige un
-- producto, y la factura manual tiene líneas libres. Las líneas de catálogo
-- mueven stock con las mismas funciones que la venta (fn_post_movement,
-- fn_consume_lots) y guardan de qué lotes salieron, para que la nota de
-- crédito vuelva a esos mismos lotes.
--
-- Las credenciales del SII (RUT y clave del usuario, clave del certificado)
-- viven CIFRADAS en `sii_credenciales`, una tabla que ningún usuario puede
-- leer por la API: la escribe el servidor web y la lee el worker, los dos con
-- la llave de servicio. La llave de cifrado no está en la base.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- dte_documentos: los folios simulados y los del SII son series distintas
-- ---------------------------------------------------------------------------
-- Con el portal, el SII asigna sus propios folios desde el 1. Si la unicidad
-- no distingue el ambiente, la factura real N° 1 chocaría con la simulada N° 1.
alter table dte_documentos drop constraint if exists dte_documentos_tenant_id_tipo_folio_key;
drop index if exists dte_documentos_folio_por_ambiente;
create unique index dte_documentos_folio_por_ambiente
  on dte_documentos(tenant_id, ambiente, tipo, folio);

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists facturas (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  store_id               uuid not null references stores(id) on delete cascade,
  numero                 bigint not null,
  -- Idempotencia: el doble toque en "Emitir" no emite dos facturas.
  client_uuid            uuid not null,
  modo                   text not null check (modo in ('simulacion', 'portal_sii')),
  estado                 text not null
                         check (estado in ('emitida', 'por_emitir', 'emitiendo', 'error', 'descartada')),
  cliente_id             uuid references clientes(id) on delete set null,
  receptor               jsonb not null,
  forma_pago             text not null default 'contado' check (forma_pago in ('contado', 'credito')),
  fecha_emision          date not null,
  observaciones          text,
  neto                   integer not null,
  exento                 integer not null default 0,
  iva                    integer not null,
  iva_pct                numeric(5,2) not null,
  impuestos_adicionales  integer not null default 0,
  impuestos_detalle      jsonb not null default '[]'::jsonb,
  total                  integer not null check (total > 0),
  dte_id                 uuid references dte_documentos(id) on delete restrict,
  folio                  bigint,
  intentos               integer not null default 0,
  ultimo_error           text,
  tomada_en              timestamptz,
  pdf_path               text,
  created_by             uuid references profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  emitida_en             timestamptz,
  unique (tenant_id, numero),
  unique (tenant_id, client_uuid),
  check (neto + exento + iva + impuestos_adicionales = total),
  check (estado <> 'emitida' or (dte_id is not null and folio is not null))
);
create index if not exists idx_facturas_fecha on facturas(tenant_id, created_at desc);
create index if not exists idx_facturas_cola on facturas(estado, created_at) where estado in ('por_emitir', 'emitiendo');

create table if not exists factura_lineas (
  id                 uuid primary key default gen_random_uuid(),
  factura_id         uuid not null references facturas(id) on delete cascade,
  tenant_id          uuid not null references tenants(id) on delete cascade,
  linea              smallint not null,
  -- Null = línea libre (flete, servicio): no mueve stock.
  product_id         uuid references products(id) on delete restrict,
  nombre             text not null check (length(trim(nombre)) > 0),
  descripcion        text,
  unidad             text,
  cantidad           numeric(14,3) not null check (cantidad > 0),
  -- Con IVA (y adicional) incluido, como todo precio del sistema (regla 7).
  precio             integer not null check (precio >= 0),
  descuento          integer not null default 0 check (descuento >= 0),
  monto              integer not null check (monto >= 0),
  precio_lista       integer,
  unit_cost          integer not null default 0,
  tasa               numeric(5,2) not null default 0,
  nombre_adicional   text,
  codigo_adicional   integer,
  -- De qué lotes salió (lo que devuelve fn_consume_lots), y cuánto volvió.
  lotes              jsonb not null default '[]'::jsonb,
  devuelto           numeric(14,3) not null default 0,
  unique (factura_id, linea),
  check (devuelto <= cantidad)
);
create index if not exists idx_factura_lineas_factura on factura_lineas(factura_id);
create index if not exists idx_factura_lineas_producto on factura_lineas(product_id) where product_id is not null;

create table if not exists factura_notas_credito (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  factura_id             uuid not null references facturas(id) on delete restrict,
  numero                 bigint not null,
  motivo                 text not null check (length(trim(motivo)) > 0),
  lineas                 jsonb not null,
  monto                  integer not null check (monto > 0),
  neto                   integer not null,
  iva                    integer not null,
  impuestos_adicionales  integer not null default 0,
  es_total               boolean not null,
  dte_id                 uuid references dte_documentos(id) on delete restrict,
  created_by             uuid references profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (tenant_id, numero)
);
create index if not exists idx_factura_nc_factura on factura_notas_credito(factura_id);

create table if not exists facturas_recibidas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  supplier_id      uuid references suppliers(id) on delete set null,
  rut_emisor       text not null,
  razon_social     text not null check (length(trim(razon_social)) > 0),
  -- 33 factura · 34 exenta · 46 factura de compra · 56 nota de débito · 61 nota de crédito
  tipo             smallint not null check (tipo in (33, 34, 46, 56, 61)),
  folio            bigint not null check (folio > 0),
  fecha_emision    date not null,
  neto             integer not null check (neto >= 0),
  exento           integer not null default 0 check (exento >= 0),
  iva              integer not null check (iva >= 0),
  otros_impuestos  integer not null default 0 check (otros_impuestos >= 0),
  total            integer not null check (total > 0),
  receipt_id       uuid references purchase_receipts(id) on delete set null,
  notas            text,
  estado           text not null default 'vigente' check (estado in ('vigente', 'anulada')),
  anulada_motivo   text,
  anulada_por      uuid references profiles(id) on delete set null,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, rut_emisor, tipo, folio),
  check (neto + exento + iva + otros_impuestos = total)
);
create index if not exists idx_facturas_recibidas_fecha on facturas_recibidas(tenant_id, fecha_emision desc);

-- Las credenciales del robot. Cifradas afuera (AES-256-GCM, llave en el
-- servidor): acá solo hay texto cifrado. Sin política: nadie la lee por la API.
create table if not exists sii_credenciales (
  tenant_id          uuid primary key references tenants(id) on delete cascade,
  rut_usuario        text not null,
  clave_sii          text not null,
  clave_certificado  text not null,
  rut_empresa        text not null,
  actualizado_por    uuid references profiles(id) on delete set null,
  actualizado_en     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inmutabilidad: lo emitido no se edita (docs/18 §4.3)
-- ---------------------------------------------------------------------------
-- Las funciones de este archivo cambian el estado de la cola y lo devuelto de
-- cada línea; nada más. Borrar, jamás.
create or replace function public.fn_factura_inmutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'REGISTRO_INMUTABLE: % no admite DELETE', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'facturas' and
     (to_jsonb(new) - array['estado','dte_id','folio','intentos','ultimo_error','tomada_en','pdf_path','emitida_en'])
     is distinct from
     (to_jsonb(old) - array['estado','dte_id','folio','intentos','ultimo_error','tomada_en','pdf_path','emitida_en']) then
    raise exception 'REGISTRO_INMUTABLE: una factura no se edita; se corrige con nota de crédito' using errcode = '42501';
  end if;
  if tg_table_name = 'factura_lineas' and
     (to_jsonb(new) - array['devuelto']) is distinct from (to_jsonb(old) - array['devuelto']) then
    raise exception 'REGISTRO_INMUTABLE: las líneas de una factura no se editan' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_facturas_inmutable on facturas;
create trigger trg_facturas_inmutable before update or delete on facturas
  for each row execute function public.fn_factura_inmutable();
drop trigger if exists trg_factura_lineas_inmutable on factura_lineas;
create trigger trg_factura_lineas_inmutable before update or delete on factura_lineas
  for each row execute function public.fn_factura_inmutable();

-- ---------------------------------------------------------------------------
-- RLS: se leen en el local (admin y supervisor); se escriben con funciones
-- ---------------------------------------------------------------------------
alter table facturas              enable row level security;
alter table factura_lineas        enable row level security;
alter table factura_notas_credito enable row level security;
alter table facturas_recibidas    enable row level security;
alter table sii_credenciales      enable row level security;

drop policy if exists facturas_read on facturas;
create policy facturas_read on facturas for select to authenticated
  using (tenant_id = current_tenant_id() and coalesce(current_user_role()::text, '') in ('admin', 'supervisor'));
drop policy if exists factura_lineas_read on factura_lineas;
create policy factura_lineas_read on factura_lineas for select to authenticated
  using (tenant_id = current_tenant_id() and coalesce(current_user_role()::text, '') in ('admin', 'supervisor'));
drop policy if exists factura_nc_read on factura_notas_credito;
create policy factura_nc_read on factura_notas_credito for select to authenticated
  using (tenant_id = current_tenant_id() and coalesce(current_user_role()::text, '') in ('admin', 'supervisor'));
drop policy if exists facturas_recibidas_read on facturas_recibidas;
create policy facturas_recibidas_read on facturas_recibidas for select to authenticated
  using (tenant_id = current_tenant_id() and coalesce(current_user_role()::text, '') in ('admin', 'supervisor'));
-- sii_credenciales: sin ninguna política, y además sin privilegios.
revoke all on sii_credenciales from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internas
-- ---------------------------------------------------------------------------
-- ¿La emisión real está encendida y tiene con qué? Las dos cosas.
create or replace function public.fn_emision_sii_activa(p_tenant uuid)
returns boolean
language sql stable set search_path = public
as $$
  select coalesce((select (settings->>'emision_sii_portal')::boolean from tenants where id = p_tenant), false)
     and exists (select 1 from sii_credenciales where tenant_id = p_tenant)
$$;

-- El receptor, validado y normalizado. Es el que va al documento.
create or replace function public.fn_receptor_factura(p_receptor jsonb)
returns jsonb
language plpgsql immutable set search_path = public
as $$
declare
  v_rut   text := fn_rut_formateado(p_receptor->>'rut');
  v_razon text := nullif(trim(p_receptor->>'razon_social'), '');
begin
  if v_rut is null then raise exception 'RUT_INVALIDO' using errcode = 'P0001'; end if;
  if v_razon is null then raise exception 'RAZON_SOCIAL_REQUERIDA' using errcode = 'P0001'; end if;
  -- El SII exige giro y dirección del receptor en una factura.
  if nullif(trim(p_receptor->>'giro'), '') is null then
    raise exception 'GIRO_RECEPTOR_REQUERIDO' using errcode = 'P0001';
  end if;
  if nullif(trim(p_receptor->>'direccion'), '') is null or nullif(trim(p_receptor->>'comuna'), '') is null then
    raise exception 'DIRECCION_RECEPTOR_REQUERIDA' using errcode = 'P0001';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'rut', v_rut, 'razon_social', left(v_razon, 100),
    'giro', left(trim(p_receptor->>'giro'), 80),
    'direccion', left(trim(p_receptor->>'direccion'), 70),
    'comuna', left(trim(p_receptor->>'comuna'), 20),
    'ciudad', nullif(left(trim(coalesce(p_receptor->>'ciudad', '')), 20), ''),
    'correo', nullif(left(trim(coalesce(p_receptor->>'correo', '')), 80), ''),
    'contacto', nullif(left(trim(coalesce(p_receptor->>'contacto', '')), 80), '')));
end $$;

-- ---------------------------------------------------------------------------
-- fn_emitir_factura_manual — emite (o encola) una factura hecha a mano
-- ---------------------------------------------------------------------------
-- p_datos: {client_uuid, cliente_id?, receptor{rut, razon_social, giro,
--   direccion, comuna, ciudad?, correo?}, forma_pago, observaciones?,
--   lineas: [{product_id?, nombre, descripcion?, cantidad, precio, descuento?}]}
-- `precio` con IVA incluido. En una línea de catálogo, el nombre y la unidad
-- se toman del producto; el precio lo decide quien factura (es editable), y
-- el precio de lista queda guardado al lado para auditarlo.
create or replace function public.fn_emitir_factura_manual(p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant    uuid := current_tenant_id();
  v_user      uuid := auth.uid();
  v_role      text := coalesce(current_user_role()::text, '');
  v_uuid      uuid := nullif(p_datos->>'client_uuid', '')::uuid;
  v_existe    facturas%rowtype;
  v_store     uuid;
  v_receptor  jsonb;
  v_cliente   uuid := nullif(p_datos->>'cliente_id', '')::uuid;
  v_forma     text := coalesce(nullif(p_datos->>'forma_pago', ''), 'contado');
  v_modo      text;
  v_id        uuid := gen_random_uuid();
  v_numero    bigint;
  v_l         jsonb;
  v_i         integer := 0;
  v_prod      products%rowtype;
  v_hay_prod  boolean;
  v_filas     jsonb := '[]'::jsonb;
  v_qty       numeric(14,3);
  v_precio    integer;
  v_desc      integer;
  v_monto     integer;
  v_nombre    text;
  v_tasa      numeric(5,2);
  v_imp_nom   text;
  v_imp_cod   integer;
  v_lotes     jsonb;
  v_total     integer := 0;
  v_para_des  jsonb := '[]'::jsonb;
  v_detalle   jsonb := '[]'::jsonb;
  v_iva       numeric;
  v_des       jsonb;
  v_dte       jsonb;
begin
  if not is_active_user() or v_role not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if v_uuid is null then raise exception 'FALTA_IDENTIFICADOR' using errcode = 'P0001'; end if;

  -- El doble toque espera al primero y recibe la misma factura.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':factura:' || v_uuid::text, 0));
  select * into v_existe from facturas where tenant_id = v_tenant and client_uuid = v_uuid;
  if found then
    return fn_factura_resumen(v_existe.id) || jsonb_build_object('ya_existia', true);
  end if;

  if v_forma not in ('contado', 'credito') then raise exception 'FORMA_PAGO_INVALIDA' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_datos->'lineas') is distinct from 'array' or jsonb_array_length(p_datos->'lineas') = 0 then
    raise exception 'FACTURA_SIN_LINEAS' using errcode = 'P0001';
  end if;
  -- El portal del SII admite 60 líneas por factura.
  if jsonb_array_length(p_datos->'lineas') > 60 then
    raise exception 'FACTURA_DEMASIADAS_LINEAS' using errcode = 'P0001';
  end if;
  v_receptor := fn_receptor_factura(p_datos->'receptor');

  if v_cliente is not null and not exists (
       select 1 from clientes where id = v_cliente and tenant_id = v_tenant and is_active) then
    raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  -- RQ-20, como la factura del POS: el receptor queda guardado como cliente,
  -- y a uno que ya existe se le completa lo que le falta, sin pisar nada.
  if v_cliente is null then
    select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_receptor->>'rut';
  end if;
  if v_cliente is null then
    insert into clientes (tenant_id, rut, nombre, giro, direccion, comuna, email, created_by)
    values (v_tenant, v_receptor->>'rut', v_receptor->>'razon_social', v_receptor->>'giro',
            v_receptor->>'direccion', v_receptor->>'comuna', v_receptor->>'correo', v_user)
    on conflict (tenant_id, rut) where rut is not null do nothing
    returning id into v_cliente;
    if v_cliente is null then
      select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_receptor->>'rut';
    end if;
  else
    update clientes
       set giro = coalesce(giro, v_receptor->>'giro'),
           direccion = coalesce(direccion, v_receptor->>'direccion'),
           comuna = coalesce(comuna, v_receptor->>'comuna'),
           email = coalesce(email, v_receptor->>'correo')
     where id = v_cliente;
  end if;

  select store_id into v_store from profiles where id = v_user;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant order by created_at limit 1;
  end if;

  -- Stock bloqueado de una vez y en orden (regla 15), antes de leerlo.
  perform fn_lock_stock(v_tenant, v_store, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_datos->'lineas') x
     where nullif(x->>'product_id', '') is not null));

  v_modo := case when fn_emision_sii_activa(v_tenant) then 'portal_sii' else 'simulacion' end;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':facturas', 0));
  select coalesce(max(numero), 0) + 1 into v_numero from facturas where tenant_id = v_tenant;
  select coalesce((settings->>'iva_pct')::numeric, 19) into v_iva from tenants where id = v_tenant;

  -- Primero las líneas y el stock; la factura se inserta después, con sus
  -- montos finales: no se puede completar más tarde, es inmutable.
  for v_l in select * from jsonb_array_elements(p_datos->'lineas') loop
    v_i := v_i + 1;
    v_qty := (v_l->>'cantidad')::numeric;
    v_precio := (v_l->>'precio')::integer;
    v_desc := coalesce((v_l->>'descuento')::integer, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
    if v_precio is null or v_precio < 0 or v_desc < 0 then raise exception 'MONTO_NEGATIVO' using errcode = 'P0001'; end if;
    v_monto := round(v_qty * v_precio)::integer - v_desc;
    if v_monto < 0 then raise exception 'DESCUENTO_MAYOR_QUE_LINEA' using errcode = 'P0001'; end if;
    v_tasa := 0; v_imp_nom := null; v_imp_cod := null; v_lotes := '[]'::jsonb;
    v_hay_prod := nullif(v_l->>'product_id', '') is not null;

    if v_hay_prod then
      select * into v_prod from products where id = (v_l->>'product_id')::uuid and tenant_id = v_tenant;
      if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
      if not v_prod.is_active then raise exception 'PRODUCTO_INACTIVO: %', v_prod.name using errcode = 'P0001'; end if;
      -- Lo mismo que el POS: lo que se cuenta, entero (kg, gramo, litro y ml
      -- admiten decimales). Acá la base sí lo exige: es un documento tributario.
      if v_prod.unit not in ('kg', 'gramo', 'litro', 'ml') and v_qty <> trunc(v_qty) then
        raise exception 'CANTIDAD_ENTERA: %', v_prod.name using errcode = 'P0001';
      end if;
      v_nombre := v_prod.name;
      if v_prod.impuesto_adicional_id is not null then
        select tasa, nombre, codigo_sii into v_tasa, v_imp_nom, v_imp_cod
          from impuestos_adicionales where id = v_prod.impuesto_adicional_id and is_active;
        v_tasa := coalesce(v_tasa, 0);
        if v_tasa = 0 then v_imp_nom := null; v_imp_cod := null; end if;
      end if;
      -- Sale de la sala, como una venta (admin y supervisor pueden dejarla en
      -- negativo, igual que en el POS: queda la alerta).
      if v_prod.tracks_expiry then
        v_lotes := coalesce(fn_consume_lots(v_tenant, v_store, v_prod.id, v_qty, null), '[]'::jsonb);
      end if;
      perform fn_post_movement(v_tenant, v_store, v_prod.id, 'venta', -v_qty, v_prod.avg_cost,
                               'factura', v_id, 'Factura N° ' || v_numero, v_user);
    else
      v_nombre := nullif(left(trim(coalesce(v_l->>'nombre', '')), 80), '');
      if v_nombre is null then raise exception 'LINEA_SIN_NOMBRE' using errcode = 'P0001'; end if;
    end if;

    v_filas := v_filas || jsonb_build_object(
      'linea', v_i,
      'product_id', case when v_hay_prod then v_prod.id end,
      'nombre', v_nombre,
      'descripcion', nullif(left(trim(coalesce(v_l->>'descripcion', '')), 1000), ''),
      'unidad', case when v_hay_prod then v_prod.unit
                     else nullif(left(trim(coalesce(v_l->>'unidad', '')), 4), '') end,
      'cantidad', v_qty, 'precio', v_precio, 'descuento', v_desc, 'monto', v_monto,
      'precio_lista', case when v_hay_prod then v_prod.sale_price end,
      'unit_cost', case when v_hay_prod then v_prod.avg_cost else 0 end,
      'tasa', v_tasa, 'nombre_adicional', v_imp_nom, 'codigo_adicional', v_imp_cod, 'lotes', v_lotes);
    v_total := v_total + v_monto;
    v_para_des := v_para_des || jsonb_build_object('subtotal', v_monto, 'tasa', v_tasa,
                                                   'nombre', v_imp_nom, 'codigo', v_imp_cod);
    v_detalle := v_detalle || jsonb_build_object('nombre', v_nombre, 'cantidad', v_qty, 'precio', v_precio,
                                                 'descuento', v_desc, 'monto', v_monto,
                                                 'codigo', v_imp_cod, 'tasa', v_tasa);
  end loop;

  if v_total <= 0 then raise exception 'FACTURA_EN_CERO' using errcode = 'P0001'; end if;
  v_des := fn_desglose_lineas(v_para_des, v_iva, 0);

  insert into facturas (id, tenant_id, store_id, numero, client_uuid, modo, estado, cliente_id, receptor,
                        forma_pago, fecha_emision, observaciones, neto, iva, iva_pct,
                        impuestos_adicionales, impuestos_detalle, total, created_by)
  values (v_id, v_tenant, v_store, v_numero, v_uuid, v_modo, 'por_emitir', v_cliente, v_receptor, v_forma,
          (now() at time zone fn_tenant_timezone(v_tenant))::date,
          nullif(left(trim(coalesce(p_datos->>'observaciones', '')), 500), ''),
          (v_des->>'neto')::integer, (v_des->>'iva')::integer, v_iva,
          (v_des->>'adicionales')::integer, coalesce(v_des->'detalle', '[]'::jsonb), v_total, v_user);

  insert into factura_lineas (factura_id, tenant_id, linea, product_id, nombre, descripcion, unidad,
                              cantidad, precio, descuento, monto, precio_lista, unit_cost,
                              tasa, nombre_adicional, codigo_adicional, lotes)
  select v_id, v_tenant, (x->>'linea')::smallint, nullif(x->>'product_id', '')::uuid, x->>'nombre',
         x->>'descripcion', x->>'unidad', (x->>'cantidad')::numeric, (x->>'precio')::integer,
         (x->>'descuento')::integer, (x->>'monto')::integer, (x->>'precio_lista')::integer,
         (x->>'unit_cost')::integer, (x->>'tasa')::numeric, x->>'nombre_adicional',
         (x->>'codigo_adicional')::integer, x->'lotes'
    from jsonb_array_elements(v_filas) x;

  -- Simulación: el documento 33 de 0019, en esta misma transacción.
  if v_modo = 'simulacion' then
    v_dte := fn_emitir_dte(v_tenant, 33::smallint, null, null, v_receptor, v_detalle, v_des,
                           v_total, v_iva, null, v_user);
    update facturas set estado = 'emitida', dte_id = (v_dte->>'id')::uuid,
                        folio = (v_dte->>'folio')::bigint, emitida_en = now()
     where id = v_id;
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'factura_manual', 'facturas', v_id,
          jsonb_build_object('numero', v_numero, 'total', v_total, 'modo', v_modo,
                             'receptor', v_receptor->>'rut', 'folio', v_dte->'folio'));

  return fn_factura_resumen(v_id) || jsonb_build_object('ya_existia', false);
end $$;

-- La factura con sus líneas, su documento y sus notas de crédito.
create or replace function public.fn_factura_resumen(p_id uuid)
returns jsonb
language sql stable set search_path = public
as $$
  select to_jsonb(f) - array['tomada_en']
         || jsonb_build_object(
              'lineas', coalesce((select jsonb_agg(to_jsonb(l) - array['tenant_id', 'unit_cost', 'lotes'] order by l.linea)
                                    from factura_lineas l where l.factura_id = f.id), '[]'::jsonb),
              'dte', (select fn_dte_resumen(f.dte_id)),
              'notas_credito', coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', n.id, 'numero', n.numero, 'motivo', n.motivo, 'monto', n.monto,
                                   'es_total', n.es_total, 'created_at', n.created_at,
                                   'dte', fn_dte_resumen(n.dte_id)) order by n.numero)
                                  from factura_notas_credito n where n.factura_id = f.id), '[]'::jsonb))
    from facturas f where f.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- fn_nota_credito_factura — anula o corrige una factura emitida
-- ---------------------------------------------------------------------------
-- p_items: [{linea_id, cantidad}]. Null = todo lo que queda. Lo de catálogo
-- vuelve a la sala y a los lotes de donde salió; la nota referencia la factura.
create or replace function public.fn_nota_credito_factura(p_factura uuid, p_items jsonb, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_user     uuid := auth.uid();
  v_role     text := coalesce(current_user_role()::text, '');
  v_f        facturas%rowtype;
  v_l        record;
  v_cant     numeric;
  v_monto    integer;
  v_total    integer := 0;
  v_previo   integer;
  v_sumsub   numeric;
  v_ultima   integer := 0;
  v_items    jsonb := '[]'::jsonb;
  v_para_des jsonb := '[]'::jsonb;
  v_detalle  jsonb := '[]'::jsonb;
  v_es_total boolean;
  v_des      jsonb;
  v_orig     dte_documentos%rowtype;
  v_nc       jsonb;
  v_numero   bigint;
  v_nota     uuid;
  v_rem      numeric;
  v_lote     jsonb;
  v_ya       numeric;
  v_toma     numeric;
begin
  if not is_active_user() or v_role not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;

  select * into v_f from facturas where id = p_factura and tenant_id = v_tenant for update;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  -- Una factura que el SII todavía no emitió no se corrige con nota: se descarta.
  if v_f.estado <> 'emitida' then raise exception 'FACTURA_NO_EMITIDA' using errcode = 'P0001'; end if;

  perform fn_lock_stock(v_tenant, v_f.store_id, array(
    select product_id from factura_lineas where factura_id = p_factura and product_id is not null));
  select coalesce(sum(monto), 0) into v_sumsub from factura_lineas where factura_id = p_factura;
  select coalesce(sum(monto), 0) into v_previo from factura_notas_credito where factura_id = p_factura;

  for v_l in
    select l.*, p.tracks_expiry from factura_lineas l left join products p on p.id = l.product_id
     where l.factura_id = p_factura order by l.linea for update of l
  loop
    if p_items is null then
      v_cant := v_l.cantidad - v_l.devuelto;
    else
      select sum((x->>'cantidad')::numeric) into v_cant
        from jsonb_array_elements(p_items) x where (x->>'linea_id')::uuid = v_l.id;
    end if;
    continue when coalesce(v_cant, 0) = 0;
    if v_cant < 0 or v_cant > v_l.cantidad - v_l.devuelto then
      raise exception 'CANTIDAD_A_DEVOLVER_INVALIDA: %', v_l.nombre using errcode = 'P0001';
    end if;
    v_monto := case when v_sumsub > 0
                    then round(v_cant * v_l.monto * v_f.total / (v_l.cantidad * v_sumsub))::integer else 0 end;
    update factura_lineas set devuelto = devuelto + v_cant where id = v_l.id;
    v_total := v_total + v_monto;
    v_ultima := jsonb_array_length(v_items);
    v_items := v_items || jsonb_build_object('linea_id', v_l.id, 'cantidad', v_cant, 'monto', v_monto,
                                             'tasa', v_l.tasa, 'nombre', v_l.nombre_adicional,
                                             'codigo', v_l.codigo_adicional, 'nombre_linea', v_l.nombre);

    if v_l.product_id is not null then
      -- A los lotes de donde salió, el que vence más tarde primero.
      if v_l.tracks_expiry then
        v_rem := v_cant;
        for v_lote in
          select x from jsonb_array_elements(v_l.lotes) x order by (x->>'expiry_date') desc
        loop
          exit when v_rem <= 0;
          -- Lo que ya volvió a ese lote en notas anteriores de esta línea.
          select coalesce(sum((y->>'cantidad')::numeric), 0) into v_ya
            from factura_notas_credito n, jsonb_array_elements(n.lineas) z,
                 jsonb_array_elements(coalesce(z->'lotes', '[]'::jsonb)) y
           where n.factura_id = p_factura and (z->>'linea_id')::uuid = v_l.id
             and y->>'lot_id' = v_lote->>'lot_id';
          v_toma := least(v_rem, (v_lote->>'quantity')::numeric - v_ya);
          continue when v_toma <= 0;
          update product_lots set quantity = quantity + v_toma where id = (v_lote->>'lot_id')::uuid;
          v_items := jsonb_set(v_items, array[v_ultima::text, 'lotes'],
                       coalesce(v_items->v_ultima->'lotes', '[]'::jsonb)
                       || jsonb_build_object('lot_id', v_lote->>'lot_id', 'cantidad', v_toma));
          v_rem := v_rem - v_toma;
        end loop;
      end if;
      perform fn_post_movement(v_tenant, v_f.store_id, v_l.product_id, 'devolucion_venta', v_cant,
                               v_l.unit_cost, 'factura_nc', p_factura, p_motivo, v_user);
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'NADA_QUE_DEVOLVER' using errcode = 'P0001'; end if;

  -- Si se devolvió todo lo que quedaba, la suma de notas es exactamente el
  -- total de la factura: el redondeo va a la última línea.
  v_es_total := not exists (select 1 from factura_lineas where factura_id = p_factura and devuelto < cantidad);
  if v_es_total then
    v_items := jsonb_set(v_items, array[v_ultima::text, 'monto'],
                         to_jsonb((v_items->v_ultima->>'monto')::integer + (v_f.total - v_previo - v_total)));
    v_total := v_f.total - v_previo;
  end if;
  if v_total <= 0 then raise exception 'NADA_QUE_DEVOLVER' using errcode = 'P0001'; end if;

  select jsonb_agg(jsonb_build_object('subtotal', (x->>'monto')::integer, 'tasa', (x->>'tasa')::numeric,
                                      'nombre', x->>'nombre', 'codigo', (x->>'codigo')::integer)),
         jsonb_agg(jsonb_build_object('nombre', x->>'nombre_linea', 'cantidad', (x->>'cantidad')::numeric,
                                      'precio', round((x->>'monto')::numeric / (x->>'cantidad')::numeric)::integer,
                                      'descuento', 0, 'monto', (x->>'monto')::integer,
                                      'codigo', (x->>'codigo')::integer, 'tasa', (x->>'tasa')::numeric))
    into v_para_des, v_detalle
    from jsonb_array_elements(v_items) x;
  v_des := fn_desglose_lineas(v_para_des, v_f.iva_pct, 0);

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':factura_nc', 0));
  select coalesce(max(numero), 0) + 1 into v_numero from factura_notas_credito where tenant_id = v_tenant;

  select * into v_orig from dte_documentos where id = v_f.dte_id;
  -- Una factura emitida en el SII se corrige con una nota emitida en el SII:
  -- eso es el robot, todavía no. Mientras tanto no se registra una nota
  -- simulada contra un documento real.
  if v_orig.ambiente <> 'simulacion' then
    raise exception 'NOTA_CREDITO_REAL_NO_DISPONIBLE' using errcode = 'P0001';
  end if;
  v_nc := fn_emitir_dte(v_tenant, 61::smallint, null, null, v_f.receptor, v_detalle, v_des, v_total, v_f.iva_pct,
                        jsonb_build_object('tipo', 33, 'folio', v_orig.folio, 'fecha', v_orig.fecha_emision,
                                           'codigo', case when v_es_total and v_previo = 0 then 1 else 3 end,
                                           'razon', left(trim(p_motivo), 90)),
                        v_user);

  insert into factura_notas_credito (tenant_id, factura_id, numero, motivo, lineas, monto, neto, iva,
                                     impuestos_adicionales, es_total, dte_id, created_by)
  values (v_tenant, p_factura, v_numero, trim(p_motivo), v_items, v_total, (v_des->>'neto')::integer,
          (v_des->>'iva')::integer, (v_des->>'adicionales')::integer, v_es_total, (v_nc->>'id')::uuid, v_user)
  returning id into v_nota;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'nota_credito', 'facturas', p_factura,
          jsonb_build_object('numero', v_numero, 'monto', v_total, 'es_total', v_es_total, 'folio', v_nc->'folio'));

  return jsonb_build_object('nota_id', v_nota, 'numero', v_numero, 'monto', v_total,
                            'es_total', v_es_total, 'nota_credito', v_nc);
end $$;

-- ---------------------------------------------------------------------------
-- Cola del portal: reintentar o descartar lo que el SII no emitió
-- ---------------------------------------------------------------------------
create or replace function public.fn_reintentar_factura(p_factura uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  update facturas set estado = 'por_emitir', ultimo_error = null
   where id = p_factura and tenant_id = v_tenant and estado = 'error';
  if not found then raise exception 'FACTURA_NO_REINTENTABLE' using errcode = 'P0001'; end if;
  return fn_factura_resumen(p_factura);
end $$;

-- Descartar = la factura nunca llegó al SII: el stock vuelve y no queda
-- documento. Una emitida no se descarta: se anula con nota de crédito.
create or replace function public.fn_descartar_factura(p_factura uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_f      facturas%rowtype;
  v_l      record;
  v_lote   jsonb;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;
  select * into v_f from facturas where id = p_factura and tenant_id = v_tenant for update;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  -- 'emitiendo' tampoco: el robot puede estar firmándola en este momento.
  if v_f.estado not in ('por_emitir', 'error') then
    raise exception 'FACTURA_NO_DESCARTABLE' using errcode = 'P0001';
  end if;
  perform fn_lock_stock(v_tenant, v_f.store_id, array(
    select product_id from factura_lineas where factura_id = p_factura and product_id is not null));
  for v_l in select * from factura_lineas where factura_id = p_factura and product_id is not null loop
    for v_lote in select * from jsonb_array_elements(v_l.lotes) loop
      update product_lots set quantity = quantity + (v_lote->>'quantity')::numeric
       where id = (v_lote->>'lot_id')::uuid;
    end loop;
    perform fn_post_movement(v_tenant, v_f.store_id, v_l.product_id, 'devolucion_venta', v_l.cantidad,
                             v_l.unit_cost, 'factura_descartada', p_factura, p_motivo, v_user);
  end loop;
  update facturas set estado = 'descartada', ultimo_error = trim(p_motivo) where id = p_factura;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'factura_descartada', 'facturas', p_factura,
          jsonb_build_object('numero', v_f.numero, 'motivo', trim(p_motivo)));
  return fn_factura_resumen(p_factura);
end $$;

-- ---------------------------------------------------------------------------
-- Facturas recibidas (libro de compras)
-- ---------------------------------------------------------------------------
-- p_datos: {supplier_id?, rut_emisor, razon_social, tipo, folio, fecha_emision,
--   neto, exento?, iva, otros_impuestos?, receipt_id?, notas?}
-- Un proveedor que no existe se crea (como el robot de VSV): la próxima vez se
-- autocompleta por RUT.
create or replace function public.fn_registrar_factura_recibida(p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_user     uuid := auth.uid();
  v_rut      text := fn_rut_formateado(p_datos->>'rut_emisor');
  v_razon    text := nullif(trim(p_datos->>'razon_social'), '');
  v_tipo     smallint := (p_datos->>'tipo')::smallint;
  v_neto     integer := coalesce((p_datos->>'neto')::integer, 0);
  v_exento   integer := coalesce((p_datos->>'exento')::integer, 0);
  v_iva      integer := coalesce((p_datos->>'iva')::integer, 0);
  v_otros    integer := coalesce((p_datos->>'otros_impuestos')::integer, 0);
  v_supplier uuid := nullif(p_datos->>'supplier_id', '')::uuid;
  v_fila     facturas_recibidas%rowtype;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if v_rut is null then raise exception 'RUT_INVALIDO' using errcode = 'P0001'; end if;
  if v_razon is null then raise exception 'RAZON_SOCIAL_REQUERIDA' using errcode = 'P0001'; end if;
  if v_tipo is null or v_tipo not in (33, 34, 46, 56, 61) then raise exception 'TIPO_DOCUMENTO_INVALIDO' using errcode = 'P0001'; end if;
  if coalesce((p_datos->>'folio')::bigint, 0) <= 0 then raise exception 'FOLIO_INVALIDO' using errcode = 'P0001'; end if;
  if v_neto < 0 or v_exento < 0 or v_iva < 0 or v_otros < 0 then raise exception 'MONTO_NEGATIVO' using errcode = 'P0001'; end if;
  if v_neto + v_exento + v_iva + v_otros <= 0 then raise exception 'FACTURA_EN_CERO' using errcode = 'P0001'; end if;
  if v_tipo = 34 and v_iva > 0 then raise exception 'EXENTA_CON_IVA' using errcode = 'P0001'; end if;
  if nullif(p_datos->>'fecha_emision', '') is null
     or (p_datos->>'fecha_emision')::date > (now() at time zone fn_tenant_timezone(v_tenant))::date then
    raise exception 'FECHA_INVALIDA' using errcode = 'P0001';
  end if;

  if v_supplier is not null and not exists (select 1 from suppliers where id = v_supplier and tenant_id = v_tenant) then
    raise exception 'PROVEEDOR_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if v_supplier is null then
    select id into v_supplier from suppliers
     where tenant_id = v_tenant and fn_rut_formateado(rut) = v_rut order by is_active desc, created_at limit 1;
  end if;
  if v_supplier is null then
    insert into suppliers (tenant_id, name, rut) values (v_tenant, v_razon, v_rut) returning id into v_supplier;
  end if;

  insert into facturas_recibidas (tenant_id, supplier_id, rut_emisor, razon_social, tipo, folio, fecha_emision,
                                  neto, exento, iva, otros_impuestos, total, receipt_id, notas, created_by)
  values (v_tenant, v_supplier, v_rut, left(v_razon, 100), v_tipo, (p_datos->>'folio')::bigint,
          (p_datos->>'fecha_emision')::date, v_neto, v_exento, v_iva, v_otros, v_neto + v_exento + v_iva + v_otros,
          (select id from purchase_receipts where id = nullif(p_datos->>'receipt_id', '')::uuid and tenant_id = v_tenant),
          nullif(left(trim(coalesce(p_datos->>'notas', '')), 500), ''), v_user)
  returning * into v_fila;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'factura_recibida', 'facturas_recibidas', v_fila.id, to_jsonb(v_fila));
  return to_jsonb(v_fila);
exception when unique_violation then
  raise exception 'FACTURA_RECIBIDA_DUPLICADA' using errcode = 'P0001';
end $$;

create or replace function public.fn_anular_factura_recibida(p_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_fila   facturas_recibidas%rowtype;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;
  update facturas_recibidas set estado = 'anulada', anulada_motivo = trim(p_motivo), anulada_por = auth.uid()
   where id = p_id and tenant_id = v_tenant and estado = 'vigente'
  returning * into v_fila;
  if not found then raise exception 'FACTURA_RECIBIDA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'anular', 'facturas_recibidas', p_id, jsonb_build_object('motivo', trim(p_motivo)));
  return to_jsonb(v_fila);
end $$;

-- ---------------------------------------------------------------------------
-- La emisión real: estado y encendido (solo lo que no es secreto)
-- ---------------------------------------------------------------------------
create or replace function public.fn_estado_emision_sii()
returns jsonb
language plpgsql security definer stable set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_c      sii_credenciales%rowtype;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  select * into v_c from sii_credenciales where tenant_id = v_tenant;
  return jsonb_build_object(
    'activa', fn_emision_sii_activa(v_tenant),
    'encendida', coalesce((select (settings->>'emision_sii_portal')::boolean from tenants where id = v_tenant), false),
    'credenciales', v_c.tenant_id is not null,
    'rut_usuario', v_c.rut_usuario, 'rut_empresa', v_c.rut_empresa,
    'actualizado_en', v_c.actualizado_en,
    'en_cola', (select count(*) from facturas where tenant_id = v_tenant and estado in ('por_emitir', 'emitiendo')),
    'con_error', (select count(*) from facturas where tenant_id = v_tenant and estado = 'error'));
end $$;

create or replace function public.fn_activar_emision_sii(p_activa boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') <> 'admin' then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_activa and not exists (select 1 from sii_credenciales where tenant_id = v_tenant) then
    raise exception 'FALTAN_CREDENCIALES_SII' using errcode = 'P0001';
  end if;
  if p_activa and not exists (select 1 from dte_emisores where tenant_id = v_tenant) then
    raise exception 'EMISOR_SIN_CONFIGURAR' using errcode = 'P0001';
  end if;
  update tenants set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('emision_sii_portal', p_activa)
   where id = v_tenant;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'emision_sii', 'tenants', v_tenant, jsonb_build_object('activa', p_activa));
  return fn_estado_emision_sii();
end $$;

-- ---------------------------------------------------------------------------
-- El worker (service_role): tomar la siguiente, registrar el folio o el error
-- ---------------------------------------------------------------------------
-- Una factura que quedó "emitiendo" más de 15 minutos NO se reintenta sola: el
-- robot pudo firmarla antes de caerse, y reintentar emitiría dos facturas
-- ante el SII. Pasa a error con el aviso de revisar el portal primero.
create or replace function public.fn_sii_tomar_factura()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_f facturas%rowtype;
begin
  update facturas
     set estado = 'error',
         ultimo_error = 'El robot no terminó. Antes de reintentar, revisa en el portal del SII si la factura se emitió.'
   where estado = 'emitiendo' and tomada_en < now() - interval '15 minutes';

  select * into v_f from facturas f
   where f.estado = 'por_emitir' and f.modo = 'portal_sii' and fn_emision_sii_activa(f.tenant_id)
   order by f.created_at
   limit 1
   for update skip locked;
  if not found then return null; end if;

  update facturas set estado = 'emitiendo', tomada_en = now(), intentos = intentos + 1 where id = v_f.id;
  return fn_factura_resumen(v_f.id)
         || jsonb_build_object('emisor', fn_emisor_dte(v_f.tenant_id),
                               'lineas_sii', (select jsonb_agg(jsonb_build_object(
                                   'nombre', l.nombre, 'descripcion', l.descripcion, 'unidad', l.unidad,
                                   'cantidad', l.cantidad, 'monto', l.monto, 'tasa', l.tasa,
                                   'codigo_adicional', l.codigo_adicional) order by l.linea)
                                 from factura_lineas l where l.factura_id = v_f.id),
                               'credenciales', (select to_jsonb(c) from sii_credenciales c where c.tenant_id = v_f.tenant_id));
end $$;

create or replace function public.fn_sii_registrar_emision(p_factura uuid, p_folio bigint, p_pdf_path text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_f       facturas%rowtype;
  v_detalle jsonb;
  v_doc     uuid;
begin
  select * into v_f from facturas where id = p_factura for update;
  if not found or v_f.estado <> 'emitiendo' then raise exception 'FACTURA_NO_EN_EMISION' using errcode = 'P0001'; end if;
  if coalesce(p_folio, 0) <= 0 then raise exception 'FOLIO_INVALIDO' using errcode = 'P0001'; end if;
  select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'precio', precio,
                                      'descuento', descuento, 'monto', monto,
                                      'codigo', codigo_adicional, 'tasa', tasa) order by linea)
    into v_detalle from factura_lineas where factura_id = p_factura;
  insert into dte_documentos (tenant_id, tipo, folio, ambiente, estado, referencia, fecha_emision, emitido_por,
                              emisor, receptor, detalle, neto, exento, iva, iva_pct,
                              impuestos_adicionales, impuestos_detalle, total, respuesta)
  values (v_f.tenant_id, 33, p_folio, 'produccion', 'aceptado', null,
          (now() at time zone fn_tenant_timezone(v_f.tenant_id))::date, v_f.created_by,
          fn_emisor_dte(v_f.tenant_id) || jsonb_build_object('ambiente', 'produccion', 'via', 'portal_sii'),
          v_f.receptor, v_detalle, v_f.neto, v_f.exento, v_f.iva, v_f.iva_pct,
          v_f.impuestos_adicionales, v_f.impuestos_detalle, v_f.total,
          jsonb_build_object('via', 'portal_sii', 'pdf', p_pdf_path))
  returning id into v_doc;
  update facturas set estado = 'emitida', dte_id = v_doc, folio = p_folio, pdf_path = p_pdf_path,
                      emitida_en = now(), ultimo_error = null
   where id = p_factura;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_f.tenant_id, null, 'factura_emitida_sii', 'facturas', p_factura, jsonb_build_object('folio', p_folio));
  return fn_factura_resumen(p_factura);
end $$;

create or replace function public.fn_sii_registrar_error(p_factura uuid, p_error text)
returns void
language sql security definer set search_path = public
as $$
  update facturas set estado = 'error', ultimo_error = left(coalesce(nullif(trim(p_error), ''), 'Error sin detalle'), 1000)
   where id = p_factura and estado = 'emitiendo'
$$;

-- ---------------------------------------------------------------------------
-- Resumen mensual: ventas y compras (neto, IVA, total)
-- ---------------------------------------------------------------------------
-- Ventas = documentos emitidos (boletas 39 y facturas 33, del POS y manuales)
-- menos notas de crédito (61), más lo vendido con voucher de la máquina (no
-- tiene documento nuestro) menos sus devoluciones. Compras = facturas
-- recibidas vigentes; una nota de crédito recibida resta. El mes es el del
-- local (regla 17).
create or replace view v_ventas_mensuales
with (security_invoker = true) as
with docs as (
  select d.tenant_id, date_trunc('month', d.fecha_emision)::date as mes, d.tipo, d.ambiente,
         case when d.tipo = 61 then -1 else 1 end as signo,
         d.neto + d.exento as neto, d.iva, d.impuestos_adicionales as adicionales, d.total
    from dte_documentos d
), voucher as (
  select s.tenant_id, date_trunc('month', (s.sold_at at time zone fn_tenant_timezone(s.tenant_id)))::date as mes,
         0::smallint as tipo, 'voucher'::text as ambiente, 1 as signo,
         s.neto, s.tax_amount as iva, s.impuestos_adicionales as adicionales, s.total
    from sales s
   where s.status = 'completada' and s.document_type = 'voucher'
  union all
  select sr.tenant_id, date_trunc('month', (sr.created_at at time zone fn_tenant_timezone(sr.tenant_id)))::date,
         0::smallint, 'voucher', -1, sr.neto, sr.iva, sr.impuestos_adicionales, sr.monto
    from sale_returns sr join sales s on s.id = sr.sale_id
   where s.status = 'completada' and s.document_type = 'voucher'
)
select tenant_id, mes,
       count(*) filter (where tipo = 39)                          as boletas,
       count(*) filter (where tipo = 33)                          as facturas,
       count(*) filter (where tipo = 61)                          as notas_credito,
       count(*) filter (where tipo = 0 and signo = 1)             as ventas_voucher,
       bool_or(ambiente = 'simulacion')                            as incluye_simulados,
       sum(signo * neto)::bigint                                   as neto,
       sum(signo * iva)::bigint                                    as iva,
       sum(signo * adicionales)::bigint                            as impuestos_adicionales,
       sum(signo * total)::bigint                                  as total
  from (select * from docs union all select * from voucher) x
 group by 1, 2;

create or replace view v_compras_mensuales
with (security_invoker = true) as
select tenant_id, date_trunc('month', fecha_emision)::date as mes,
       count(*)                                                                   as documentos,
       sum(case when tipo = 61 then -(neto + exento) else neto + exento end)::bigint  as neto,
       sum(case when tipo = 61 then -iva else iva end)::bigint                         as iva,
       sum(case when tipo = 61 then -otros_impuestos else otros_impuestos end)::bigint as otros_impuestos,
       sum(case when tipo = 61 then -total else total end)::bigint                     as total
  from facturas_recibidas
 where estado = 'vigente'
 group by 1, 2;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_emitir_factura_manual(jsonb)                 from public, anon;
grant  execute on function public.fn_emitir_factura_manual(jsonb)                 to authenticated;
revoke execute on function public.fn_nota_credito_factura(uuid, jsonb, text)      from public, anon;
grant  execute on function public.fn_nota_credito_factura(uuid, jsonb, text)      to authenticated;
revoke execute on function public.fn_reintentar_factura(uuid)                     from public, anon;
grant  execute on function public.fn_reintentar_factura(uuid)                     to authenticated;
revoke execute on function public.fn_descartar_factura(uuid, text)                from public, anon;
grant  execute on function public.fn_descartar_factura(uuid, text)                to authenticated;
revoke execute on function public.fn_registrar_factura_recibida(jsonb)            from public, anon;
grant  execute on function public.fn_registrar_factura_recibida(jsonb)            to authenticated;
revoke execute on function public.fn_anular_factura_recibida(uuid, text)          from public, anon;
grant  execute on function public.fn_anular_factura_recibida(uuid, text)          to authenticated;
revoke execute on function public.fn_estado_emision_sii()                         from public, anon;
grant  execute on function public.fn_estado_emision_sii()                         to authenticated;
revoke execute on function public.fn_activar_emision_sii(boolean)                 from public, anon;
grant  execute on function public.fn_activar_emision_sii(boolean)                 to authenticated;

-- Internas: solo desde otras funciones.
revoke execute on function public.fn_emision_sii_activa(uuid)                     from public, anon, authenticated;
revoke execute on function public.fn_receptor_factura(jsonb)                      from public, anon, authenticated;
revoke execute on function public.fn_factura_resumen(uuid)                        from public, anon, authenticated;
revoke execute on function public.fn_factura_inmutable()                          from public, anon, authenticated;

-- Del worker: entregan las credenciales cifradas y cierran la emisión. Nadie
-- con sesión de usuario puede llamarlas (regla 12: se revoca a public).
revoke execute on function public.fn_sii_tomar_factura()                          from public, anon, authenticated;
revoke execute on function public.fn_sii_registrar_emision(uuid, bigint, text)    from public, anon, authenticated;
revoke execute on function public.fn_sii_registrar_error(uuid, text)              from public, anon, authenticated;
grant  execute on function public.fn_sii_tomar_factura()                          to service_role;
grant  execute on function public.fn_sii_registrar_emision(uuid, bigint, text)    to service_role;
grant  execute on function public.fn_sii_registrar_error(uuid, text)              to service_role;
