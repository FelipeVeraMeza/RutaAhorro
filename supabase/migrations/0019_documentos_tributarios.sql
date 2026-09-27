-- ============================================================================
-- 0019 · Boletas, facturas y notas de crédito electrónicas (simulador) y
--        devoluciones parciales
--
-- Pedido del cliente: «el tema del sistema de facturas y boletas» (2026-09-26),
-- «notas de crédito para ventas en caso de un supuesto» (punto 7 de la lista),
-- y las respuestas 16 y 17 del cuestionario: devolución parcial y completa, y
-- cambios con nota de crédito. Es F5 de docs/18 y ADR-009: T-20 a T-28 y T-56.
--
-- LO QUE ESTO ES: el modelo completo y un emisor SIMULADO. Cada boleta o
-- factura queda registrada, con folio correlativo por tipo, montos, detalle y
-- receptor, EN LA MISMA TRANSACCIÓN QUE LA VENTA (docs/18 §4.3: una venta sin
-- documento o un documento sin venta es un descuadre que nadie sabe arreglar).
-- El XML y el timbre los arma `packages/core/src/dte.ts` desde este registro.
--
-- LO QUE NO ES: un documento válido ante el SII. Falta el certificado digital
-- del contribuyente (B-04), el enrolamiento (B-05) y los CAF reales. Mientras
-- el ambiente sea 'simulacion', los folios son de un rango ficticio, el
-- timbre dice SIMULADO y el papel dice SIN VALIDEZ TRIBUTARIA. Pasar a
-- 'certificacion' o 'produccion' está bloqueado hasta cargar CAF (F6, T-30).
--
-- Reglas de docs/18 §4.3 que esto cumple desde el primer día:
--   · Un documento emitido no se edita ni se borra (disparador, como el kardex).
--     Se corrige con una nota de crédito.
--   · El folio se consume y no se recicla.
--   · Neto, IVA, adicionales y total se guardan en el documento.
--   · Montos en enteros.
--   · Venta y documento en la misma transacción.
--
-- Devoluciones (RQ-18, RQ-19): `fn_devolver_venta` devuelve algunas líneas o
-- todas, con cuántas unidades, vuelve el stock a la sala (y a los lotes de
-- donde salió), saca la plata de la caja si se devuelve en efectivo, y emite
-- la nota de crédito que referencia la boleta o factura. Una venta con
-- documento ya no se "anula": se devuelve con nota de crédito (fn_void_sale
-- lo rechaza). Los reportes de ventas restan las devoluciones el día en que
-- se hacen.
-- ============================================================================

alter type movement_type add value if not exists 'devolucion_venta';

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists dte_emisores (
  tenant_id          uuid primary key references tenants(id) on delete cascade,
  rut                text not null,
  razon_social       text not null,
  giro               text not null,
  acteco             integer,
  direccion          text not null,
  comuna             text not null,
  ciudad             text,
  ambiente           text not null default 'simulacion'
                     check (ambiente in ('simulacion', 'certificacion', 'produccion')),
  resolucion_numero  integer,
  resolucion_fecha   date,
  updated_at         timestamptz not null default now()
);

-- Rangos de folios por tipo (el CAF). En simulación se crean solos.
create table if not exists dte_folios (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  tipo                smallint not null check (tipo in (33, 39, 61)),
  desde               bigint not null check (desde > 0),
  hasta               bigint not null,
  siguiente           bigint not null,
  simulado            boolean not null,
  caf_xml             text,
  created_at          timestamptz not null default now(),
  check (hasta >= desde and siguiente between desde and hasta + 1)
);
create index if not exists idx_dte_folios_tipo on dte_folios(tenant_id, tipo, simulado, desde);

create table if not exists sale_returns (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  store_id               uuid not null references stores(id) on delete cascade,
  sale_id                uuid not null references sales(id) on delete cascade,
  numero                 bigint not null,
  motivo                 text not null check (length(trim(motivo)) > 0),
  reembolso              text not null check (reembolso in ('efectivo', 'transferencia', 'debito', 'credito')),
  monto                  integer not null check (monto >= 0),
  neto                   integer not null,
  iva                    integer not null,
  impuestos_adicionales  integer not null default 0,
  es_total               boolean not null,
  cash_session_id        uuid references cash_sessions(id) on delete set null,
  created_by             uuid references profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (tenant_id, numero)
);
create index if not exists idx_sale_returns_sale on sale_returns(sale_id);
create index if not exists idx_sale_returns_fecha on sale_returns(tenant_id, created_at desc);

create table if not exists sale_return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references sale_returns(id) on delete cascade,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  sale_item_id  uuid not null references sale_items(id) on delete cascade,
  product_id    uuid not null references products(id) on delete restrict,
  cantidad      numeric(14,3) not null check (cantidad > 0),
  monto         integer not null check (monto >= 0)
);
create index if not exists idx_sale_return_items_item on sale_return_items(sale_item_id);

-- Cuánto de cada lote consumido ya volvió, para no devolver dos veces al lote.
alter table sale_item_lots add column if not exists devuelto numeric(14,3) not null default 0;

create table if not exists dte_documentos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  tipo                   smallint not null check (tipo in (33, 39, 61)),
  folio                  bigint not null,
  ambiente               text not null check (ambiente in ('simulacion', 'certificacion', 'produccion')),
  estado                 text not null default 'emitido'
                         check (estado in ('emitido', 'enviado', 'aceptado', 'reparo', 'rechazado')),
  sale_id                uuid references sales(id) on delete restrict,
  devolucion_id          uuid references sale_returns(id) on delete restrict,
  referencia             jsonb,
  fecha_emision          date not null,
  emitido_en             timestamptz not null default now(),
  emitido_por            uuid references profiles(id) on delete set null,
  emisor                 jsonb not null,
  receptor               jsonb,
  detalle                jsonb not null,
  neto                   integer not null,
  exento                 integer not null default 0,
  iva                    integer not null,
  iva_pct                numeric(5,2) not null,
  impuestos_adicionales  integer not null default 0,
  impuestos_detalle      jsonb not null default '[]'::jsonb,
  total                  integer not null,
  -- Lo que llena el emisor real (F6): identificador de envío, XML firmado y
  -- respuesta del SII. Son lo único que puede cambiar después de emitir.
  track_id               text,
  xml                    text,
  respuesta              jsonb,
  unique (tenant_id, tipo, folio),
  check (neto + exento + iva + impuestos_adicionales = total),
  check (tipo <> 33 or receptor is not null),
  check (tipo <> 61 or referencia is not null)
);
create index if not exists idx_dte_sale on dte_documentos(sale_id);
create index if not exists idx_dte_fecha on dte_documentos(tenant_id, emitido_en desc);

-- Inmutable salvo el ciclo de envío (docs/18 §4.3). Borrar, jamás.
create or replace function public.fn_dte_inmutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'REGISTRO_INMUTABLE: dte_documentos no admite DELETE' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['estado','track_id','xml','respuesta','emitido_por'])
     is distinct from (to_jsonb(old) - array['estado','track_id','xml','respuesta','emitido_por'])
     or (new.emitido_por is distinct from old.emitido_por and new.emitido_por is not null) then
    raise exception 'REGISTRO_INMUTABLE: un documento tributario emitido no se modifica; se corrige con nota de crédito'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_dte_inmutable on dte_documentos;
create trigger trg_dte_inmutable
  before update or delete on dte_documentos
  for each row execute function public.fn_dte_inmutable();

-- Una devolución tampoco se edita: es plata que salió y stock que volvió.
-- La única escritura permitida es la de fn_devolver_venta completando la fila
-- que acaba de crear, en la misma transacción (marca local `ra.devolucion`).
create or replace function public.fn_devolucion_inmutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and current_setting('ra.devolucion', true) = old.id::text then
    return new;
  end if;
  raise exception 'REGISTRO_INMUTABLE: sale_returns no admite %', tg_op using errcode = '42501';
end $$;
drop trigger if exists trg_returns_immutable on sale_returns;
create trigger trg_returns_immutable
  before update or delete on sale_returns
  for each row execute function public.fn_devolucion_inmutable();

-- ---------------------------------------------------------------------------
-- RLS: se leen en el local; se escriben solo con las funciones (regla 14)
-- ---------------------------------------------------------------------------
alter table dte_emisores      enable row level security;
alter table dte_folios        enable row level security;
alter table dte_documentos    enable row level security;
alter table sale_returns      enable row level security;
alter table sale_return_items enable row level security;

drop policy if exists dte_emisores_read on dte_emisores;
create policy dte_emisores_read on dte_emisores for select to authenticated
  using (tenant_id = current_tenant_id());
-- Folios: solo el administrador los ve (cuántos quedan). El XML del CAF trae
-- la llave privada del timbre: no se entrega a nadie más.
drop policy if exists dte_folios_read on dte_folios;
create policy dte_folios_read on dte_folios for select to authenticated
  using (tenant_id = current_tenant_id() and coalesce(current_user_role()::text, '') = 'admin');
-- Documentos y devoluciones: igual que las ventas. Un vendedor ve los de sus
-- propias ventas (CP-09); admin y supervisor, todos los del local.
drop policy if exists dte_documentos_read on dte_documentos;
create policy dte_documentos_read on dte_documentos for select to authenticated
  using (tenant_id = current_tenant_id()
         and (coalesce(current_user_role()::text, '') in ('admin', 'supervisor')
              or exists (select 1 from sales s where s.id = dte_documentos.sale_id and s.sold_by = auth.uid())));
drop policy if exists sale_returns_read on sale_returns;
create policy sale_returns_read on sale_returns for select to authenticated
  using (tenant_id = current_tenant_id()
         and (coalesce(current_user_role()::text, '') in ('admin', 'supervisor')
              or exists (select 1 from sales s where s.id = sale_returns.sale_id and s.sold_by = auth.uid())));
drop policy if exists sale_return_items_read on sale_return_items;
create policy sale_return_items_read on sale_return_items for select to authenticated
  using (tenant_id = current_tenant_id()
         and exists (select 1 from sale_returns r where r.id = sale_return_items.return_id));

-- ---------------------------------------------------------------------------
-- fn_desglose_lineas — el desglose de impuestos de cualquier lista de líneas
-- ---------------------------------------------------------------------------
-- El mismo algoritmo de 0018 (`desglosarImpuestos` en core), sobre un jsonb
-- [{subtotal, tasa, nombre, codigo}]. Lo usa la nota de crédito, que desglosa
-- solo lo devuelto; fn_desglose_impuestos pasa a delegar acá.
create or replace function public.fn_desglose_lineas(
  p_lineas jsonb, p_iva numeric, p_descuento integer
) returns jsonb
language plpgsql immutable set search_path = public
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
    from (select coalesce((x->>'tasa')::numeric, 0) as tasa,
                 case when coalesce((x->>'tasa')::numeric, 0) > 0 then x->>'nombre' end as nombre,
                 max((x->>'codigo')::integer) as codigo,
                 sum((x->>'subtotal')::integer)::integer as s
            from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
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

create or replace function public.fn_desglose_impuestos(
  p_sale uuid, p_iva numeric, p_descuento integer
) returns jsonb
language sql stable set search_path = public
as $$
  select fn_desglose_lineas(
    coalesce((select jsonb_agg(jsonb_build_object(
                'subtotal', subtotal, 'tasa', impuesto_adicional_tasa,
                'nombre', impuesto_adicional_nombre, 'codigo', impuesto_adicional_codigo))
                from sale_items where sale_id = p_sale), '[]'::jsonb),
    p_iva, p_descuento)
$$;

-- ---------------------------------------------------------------------------
-- fn_guardar_emisor — los datos del contribuyente que emite (solo admin)
-- ---------------------------------------------------------------------------
create or replace function public.fn_guardar_emisor(p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_rut      text;
  v_ambiente text := coalesce(nullif(p_datos->>'ambiente', ''), 'simulacion');
  v_fila     dte_emisores%rowtype;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  v_rut := fn_rut_formateado(p_datos->>'rut');
  if v_rut is null then raise exception 'RUT_EMISOR_INVALIDO' using errcode = 'P0001'; end if;
  if nullif(trim(p_datos->>'razon_social'), '') is null or nullif(trim(p_datos->>'giro'), '') is null
     or nullif(trim(p_datos->>'direccion'), '') is null or nullif(trim(p_datos->>'comuna'), '') is null then
    raise exception 'DATOS_EMISOR_INCOMPLETOS' using errcode = 'P0001';
  end if;
  -- Emitir de verdad necesita CAF cargados y el certificado (F6).
  if v_ambiente <> 'simulacion' then
    raise exception 'AMBIENTE_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  insert into dte_emisores (tenant_id, rut, razon_social, giro, acteco, direccion, comuna, ciudad,
                            ambiente, resolucion_numero, resolucion_fecha, updated_at)
  values (v_tenant, v_rut, trim(p_datos->>'razon_social'), trim(p_datos->>'giro'),
          nullif(p_datos->>'acteco', '')::integer, trim(p_datos->>'direccion'), trim(p_datos->>'comuna'),
          nullif(trim(p_datos->>'ciudad'), ''), v_ambiente,
          nullif(p_datos->>'resolucion_numero', '')::integer, nullif(p_datos->>'resolucion_fecha', '')::date, now())
  on conflict (tenant_id) do update
     set rut = excluded.rut, razon_social = excluded.razon_social, giro = excluded.giro,
         acteco = excluded.acteco, direccion = excluded.direccion, comuna = excluded.comuna,
         ciudad = excluded.ciudad, ambiente = excluded.ambiente,
         resolucion_numero = excluded.resolucion_numero, resolucion_fecha = excluded.resolucion_fecha,
         updated_at = now()
  returning * into v_fila;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'editar', 'dte_emisor', v_tenant, to_jsonb(v_fila));
  return to_jsonb(v_fila);
end $$;

-- ---------------------------------------------------------------------------
-- Internas de la emisión
-- ---------------------------------------------------------------------------
-- El emisor tal como queda congelado en el documento. Sin datos cargados, en
-- simulación se usa el nombre y RUT del local y se marca `configurado: false`
-- para que el papel lo diga.
create or replace function public.fn_emisor_dte(p_tenant uuid)
returns jsonb
language sql stable set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('rut', rut, 'razon_social', razon_social, 'giro', giro, 'acteco', acteco,
                               'direccion', direccion, 'comuna', comuna, 'ciudad', ciudad,
                               'ambiente', ambiente, 'configurado', true)
       from dte_emisores where tenant_id = p_tenant),
    (select jsonb_build_object('rut', coalesce(fn_rut_formateado(rut), '11.111.111-1'),
                               'razon_social', name, 'giro', 'Sin configurar', 'acteco', null,
                               'direccion', 'Sin configurar', 'comuna', 'Sin configurar', 'ciudad', null,
                               'ambiente', 'simulacion', 'configurado', false)
       from tenants where id = p_tenant))
$$;

-- El próximo folio del tipo. Bloquea el rango: dos cajas no reciben el mismo
-- folio. En simulación, si no hay rango, se crea uno.
create or replace function public.fn_siguiente_folio_dte(p_tenant uuid, p_tipo smallint, p_ambiente text)
returns bigint
language plpgsql set search_path = public
as $$
declare
  v_rango dte_folios%rowtype;
  v_desde bigint;
begin
  -- Serializa la creación del rango simulado entre dos ventas simultáneas.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':folios:' || p_tipo, 0));
  select * into v_rango from dte_folios
   where tenant_id = p_tenant and tipo = p_tipo and simulado = (p_ambiente = 'simulacion')
     and siguiente <= hasta
   order by desde
   limit 1
   for update;
  if not found then
    if p_ambiente <> 'simulacion' then
      raise exception 'SIN_FOLIOS: %', p_tipo using errcode = 'P0001';
    end if;
    select coalesce(max(hasta), 0) + 1 into v_desde from dte_folios
     where tenant_id = p_tenant and tipo = p_tipo and simulado;
    insert into dte_folios (tenant_id, tipo, desde, hasta, siguiente, simulado)
    values (p_tenant, p_tipo, v_desde, v_desde + 999999, v_desde, true)
    returning * into v_rango;
  end if;
  update dte_folios set siguiente = siguiente + 1 where id = v_rango.id;
  return v_rango.siguiente;
end $$;

-- Registra un documento. `p_detalle`: [{nombre, cantidad, precio, descuento,
-- monto, codigo, tasa}] con montos con impuestos incluidos.
create or replace function public.fn_emitir_dte(
  p_tenant uuid, p_tipo smallint, p_sale uuid, p_devolucion uuid,
  p_receptor jsonb, p_detalle jsonb, p_desglose jsonb, p_total integer,
  p_iva_pct numeric, p_referencia jsonb, p_user uuid
) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_emisor   jsonb := fn_emisor_dte(p_tenant);
  v_ambiente text := coalesce(v_emisor->>'ambiente', 'simulacion');
  v_folio    bigint;
  v_doc      dte_documentos%rowtype;
begin
  if v_ambiente <> 'simulacion' and not coalesce((v_emisor->>'configurado')::boolean, false) then
    raise exception 'EMISOR_SIN_CONFIGURAR' using errcode = 'P0001';
  end if;
  v_folio := fn_siguiente_folio_dte(p_tenant, p_tipo, v_ambiente);
  insert into dte_documentos (tenant_id, tipo, folio, ambiente, sale_id, devolucion_id, referencia,
                              fecha_emision, emitido_por, emisor, receptor, detalle,
                              neto, exento, iva, iva_pct, impuestos_adicionales, impuestos_detalle, total)
  values (p_tenant, p_tipo, v_folio, v_ambiente, p_sale, p_devolucion, p_referencia,
          (now() at time zone fn_tenant_timezone(p_tenant))::date, p_user, v_emisor, p_receptor, p_detalle,
          (p_desglose->>'neto')::integer, 0, (p_desglose->>'iva')::integer, p_iva_pct,
          (p_desglose->>'adicionales')::integer, coalesce(p_desglose->'detalle', '[]'::jsonb), p_total)
  returning * into v_doc;
  return fn_dte_resumen(v_doc.id);
end $$;

-- Lo que la pantalla necesita para imprimir el documento con su timbre.
create or replace function public.fn_dte_resumen(p_id uuid)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id, 'tipo', d.tipo, 'folio', d.folio, 'ambiente', d.ambiente, 'estado', d.estado,
    'fecha_emision', d.fecha_emision, 'emitido_en', d.emitido_en, 'emisor', d.emisor,
    'receptor', d.receptor, 'detalle', d.detalle, 'neto', d.neto, 'exento', d.exento,
    'iva', d.iva, 'iva_pct', d.iva_pct, 'impuestos_adicionales', d.impuestos_adicionales,
    'impuestos_detalle', d.impuestos_detalle, 'total', d.total, 'referencia', d.referencia)
    from dte_documentos d where d.id = p_id
$$;

-- La boleta (39) o factura (33) de una venta, con lo que la venta guardó.
create or replace function public.fn_emitir_dte_venta(p_sale uuid)
returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_sale    sales%rowtype;
  v_tipo    smallint;
  v_detalle jsonb;
  v_iva     numeric;
begin
  select * into v_sale from sales where id = p_sale;
  if v_sale.document_type not in ('boleta', 'factura') then return null; end if;
  v_tipo := case v_sale.document_type when 'factura' then 33 else 39 end;

  select jsonb_agg(jsonb_build_object(
           'nombre', si.product_name, 'cantidad', si.quantity, 'precio', si.unit_price,
           'descuento', si.discount_amount, 'monto', si.subtotal,
           'codigo', si.impuesto_adicional_codigo, 'tasa', si.impuesto_adicional_tasa)
         order by si.id)
    into v_detalle from sale_items si where si.sale_id = p_sale;

  -- Un descuento a la venta completa va como una línea más, en negativo, para
  -- que el detalle sume el total del documento.
  if v_sale.total < v_sale.subtotal - (select coalesce(sum(discount_amount), 0) from sale_items where sale_id = p_sale) then
    v_detalle := v_detalle || jsonb_build_array(jsonb_build_object(
      'nombre', 'Descuento', 'cantidad', 1, 'precio', 0, 'descuento', 0,
      'monto', v_sale.total - (select coalesce(sum(subtotal), 0) from sale_items where sale_id = p_sale),
      'codigo', null, 'tasa', 0));
  end if;

  select coalesce((settings->>'iva_pct')::numeric, 19) into v_iva from tenants where id = v_sale.tenant_id;
  return fn_emitir_dte(
    v_sale.tenant_id, v_tipo, p_sale, null,
    case when v_tipo = 33 then jsonb_build_object(
      'rut', v_sale.receptor_rut, 'razon_social', v_sale.receptor_razon_social,
      'giro', v_sale.receptor_giro, 'direccion', v_sale.receptor_direccion) end,
    v_detalle,
    jsonb_build_object('neto', v_sale.neto, 'iva', v_sale.tax_amount,
                       'adicionales', v_sale.impuestos_adicionales, 'detalle', v_sale.impuestos_detalle),
    v_sale.total, v_iva, null, v_sale.sold_by);
end $$;

-- ---------------------------------------------------------------------------
-- fn_devolver_venta — devolución parcial o total, con nota de crédito
-- ---------------------------------------------------------------------------
-- `p_items`: [{sale_item_id, cantidad}]. Null = todo lo que queda.
-- `p_reembolso`: efectivo (sale de la caja abierta de quien devuelve),
-- transferencia, debito o credito (reversa en la máquina).
create or replace function public.fn_devolver_venta(
  p_sale_id uuid, p_items jsonb, p_motivo text, p_reembolso text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant    uuid := current_tenant_id();
  v_user      uuid := auth.uid();
  v_role      text := coalesce(current_user_role()::text, '');
  v_sale      sales%rowtype;
  v_ret       uuid;
  v_numero    bigint;
  v_it        record;
  v_pedido    jsonb;
  v_cant      numeric;
  v_ya        numeric;
  v_sumsub    numeric;
  v_devuelto  integer;
  v_monto     integer;
  v_total     integer := 0;
  v_lineas    jsonb := '[]'::jsonb;
  v_detalle   jsonb := '[]'::jsonb;
  v_es_total  boolean;
  v_ultimo    uuid;
  v_des       jsonb;
  v_iva       numeric;
  v_session   uuid;
  v_orig      dte_documentos%rowtype;
  v_nc        jsonb;
  v_rem       numeric;
  v_lote      record;
  v_toma      numeric;
begin
  if not is_active_user() or v_role not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_DEVOLVER' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_reembolso not in ('efectivo', 'transferencia', 'debito', 'credito') then
    raise exception 'REEMBOLSO_INVALIDO' using errcode = 'P0001';
  end if;

  select * into v_sale from sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VENTA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_sale.status = 'anulada' then raise exception 'VENTA_YA_ANULADA' using errcode = 'P0001'; end if;

  -- La plata en efectivo sale de la caja abierta de quien devuelve.
  if p_reembolso = 'efectivo' then
    select id into v_session from cash_sessions
     where user_id = v_user and status = 'abierta' limit 1 for share;
    if v_session is null then raise exception 'CAJA_NO_ABIERTA_DEVOLUCION' using errcode = 'P0001'; end if;
  end if;

  perform fn_lock_stock(v_tenant, v_sale.store_id, array(
    select product_id from sale_items where sale_id = p_sale_id));

  select coalesce(sum(subtotal), 0) into v_sumsub from sale_items where sale_id = p_sale_id;
  select coalesce(sum(monto), 0) into v_devuelto from sale_returns where sale_id = p_sale_id;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':devoluciones', 0));
  select coalesce(max(numero), 0) + 1 into v_numero from sale_returns where tenant_id = v_tenant;

  insert into sale_returns (tenant_id, store_id, sale_id, numero, motivo, reembolso, monto,
                            neto, iva, es_total, cash_session_id, created_by)
  values (v_tenant, v_sale.store_id, p_sale_id, v_numero, trim(p_motivo), p_reembolso, 0,
          0, 0, false, v_session, v_user)
  returning id into v_ret;

  -- Cada línea de la venta, con lo que ya se devolvió y lo que se pide ahora.
  for v_it in
    select si.*, coalesce((select sum(ri.cantidad) from sale_return_items ri where ri.sale_item_id = si.id), 0) as ya,
           p.tracks_expiry
      from sale_items si join products p on p.id = si.product_id
     where si.sale_id = p_sale_id
     order by si.id
  loop
    if p_items is null then
      v_cant := v_it.quantity - v_it.ya;
    else
      select sum((x->>'cantidad')::numeric) into v_cant
        from jsonb_array_elements(p_items) x where (x->>'sale_item_id')::uuid = v_it.id;
    end if;
    continue when coalesce(v_cant, 0) = 0;
    if v_cant < 0 or v_cant > v_it.quantity - v_it.ya then
      raise exception 'CANTIDAD_A_DEVOLVER_INVALIDA: %', v_it.product_name using errcode = 'P0001';
    end if;

    -- Lo que efectivamente se pagó por esas unidades (réplica de
    -- `montosDevolucion` en core: una sola división).
    v_monto := case when v_sumsub > 0
                    then round(v_cant * v_it.subtotal * v_sale.total / (v_it.quantity * v_sumsub))::integer
                    else 0 end;

    insert into sale_return_items (return_id, tenant_id, sale_item_id, product_id, cantidad, monto)
    values (v_ret, v_tenant, v_it.id, v_it.product_id, v_cant, v_monto)
    returning id into v_ultimo;
    v_total := v_total + v_monto;

    -- El stock vuelve a la sala, y a los lotes de donde salió (el que vence
    -- más tarde primero: es el que más sirve devolver a la repisa).
    if v_it.tracks_expiry then
      v_rem := v_cant;
      for v_lote in
        select sil.id, sil.lot_id, sil.quantity - sil.devuelto as disponible
          from sale_item_lots sil join product_lots pl on pl.id = sil.lot_id
         where sil.sale_item_id = v_it.id and sil.quantity > sil.devuelto
         order by pl.expiry_date desc
         for update of sil
      loop
        exit when v_rem <= 0;
        v_toma := least(v_rem, v_lote.disponible);
        update product_lots set quantity = quantity + v_toma where id = v_lote.lot_id;
        update sale_item_lots set devuelto = devuelto + v_toma where id = v_lote.id;
        v_rem := v_rem - v_toma;
      end loop;
    end if;
    perform fn_post_movement(v_tenant, v_sale.store_id, v_it.product_id, 'devolucion_venta',
                             v_cant, v_it.unit_cost, 'sale_return', v_ret, p_motivo, v_user);
  end loop;

  if v_ultimo is null then raise exception 'NADA_QUE_DEVOLVER' using errcode = 'P0001'; end if;

  -- ¿Se devolvió todo lo que quedaba? Entonces se devuelve exactamente lo que
  -- falta para el total cobrado: varias devoluciones nunca suman más.
  v_es_total := not exists (
    select 1 from sale_items si
     where si.sale_id = p_sale_id
       and si.quantity > coalesce((select sum(ri.cantidad) from sale_return_items ri where ri.sale_item_id = si.id), 0));
  if v_es_total then
    update sale_return_items set monto = monto + (v_sale.total - v_devuelto - v_total) where id = v_ultimo;
    v_total := v_sale.total - v_devuelto;
  end if;

  -- Impuestos de lo devuelto, por el mismo algoritmo de la venta.
  select jsonb_agg(jsonb_build_object('subtotal', ri.monto, 'tasa', si.impuesto_adicional_tasa,
                                      'nombre', si.impuesto_adicional_nombre, 'codigo', si.impuesto_adicional_codigo)),
         jsonb_agg(jsonb_build_object('nombre', si.product_name, 'cantidad', ri.cantidad,
                                      'precio', round(ri.monto / ri.cantidad)::integer, 'descuento', 0, 'monto', ri.monto,
                                      'codigo', si.impuesto_adicional_codigo, 'tasa', si.impuesto_adicional_tasa)
                   order by si.id)
    into v_lineas, v_detalle
    from sale_return_items ri join sale_items si on si.id = ri.sale_item_id
   where ri.return_id = v_ret;
  select coalesce((settings->>'iva_pct')::numeric, 19) into v_iva from tenants where id = v_tenant;
  v_des := fn_desglose_lineas(v_lineas, v_iva, 0);

  -- La fila se completa una sola vez, desde acá: el disparador solo lo
  -- permite para la devolución marcada en esta transacción.
  perform set_config('ra.devolucion', v_ret::text, true);
  update sale_returns
     set monto = v_total, neto = (v_des->>'neto')::integer, iva = (v_des->>'iva')::integer,
         impuestos_adicionales = (v_des->>'adicionales')::integer, es_total = v_es_total
   where id = v_ret;
  perform set_config('ra.devolucion', '', true);

  if p_reembolso = 'efectivo' and v_total > 0 then
    insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
    values (v_tenant, v_session, 'egreso', v_total,
            'Devolución N° ' || v_numero || ' · venta folio ' || v_sale.folio || ' · ' || trim(p_motivo), v_user);
  end if;

  -- La nota de crédito, si la venta tenía boleta o factura.
  select * into v_orig from dte_documentos
   where sale_id = p_sale_id and tipo in (33, 39) order by emitido_en limit 1;
  if found then
    v_nc := fn_emitir_dte(
      v_tenant, 61::smallint, p_sale_id, v_ret, v_orig.receptor, v_detalle, v_des, v_total, v_iva,
      jsonb_build_object('tipo', v_orig.tipo, 'folio', v_orig.folio, 'fecha', v_orig.fecha_emision,
                         'codigo', case when v_es_total and v_devuelto = 0 then 1 else 3 end,
                         'razon', left(trim(p_motivo), 90)),
      v_user);
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'devolucion', 'sales', p_sale_id,
          jsonb_build_object('devolucion', v_numero, 'monto', v_total, 'reembolso', p_reembolso,
                             'es_total', v_es_total, 'nota_credito', v_nc->'folio'));

  return jsonb_build_object('devolucion_id', v_ret, 'numero', v_numero, 'monto', v_total,
                            'es_total', v_es_total, 'reembolso', p_reembolso, 'nota_credito', v_nc);
end $$;

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0018, emitiendo la boleta o factura
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
  v_dte       jsonb;
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
-- fn_void_sale — igual que 0013, sin anular lo que tiene documento
-- ---------------------------------------------------------------------------
create or replace function public.fn_void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_role   user_role := current_user_role();
  v_sale   sales%rowtype;
  v_item   sale_items%rowtype;
begin
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  select * into v_sale from sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VENTA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_sale.status = 'anulada' then
    raise exception 'VENTA_YA_ANULADA' using errcode = 'P0001';
  end if;
  -- 0019 · Una venta con boleta o factura emitida no se anula: el documento
  -- no se puede borrar, se corrige con nota de crédito (fn_devolver_venta).
  -- Y una venta con devoluciones tampoco: anularla devolvería el stock dos
  -- veces.
  if exists (select 1 from dte_documentos where sale_id = p_sale_id) then
    raise exception 'VENTA_CON_DOCUMENTO_USAR_DEVOLUCION' using errcode = 'P0001';
  end if;
  if exists (select 1 from sale_returns where sale_id = p_sale_id) then
    raise exception 'VENTA_CON_DEVOLUCIONES' using errcode = 'P0001';
  end if;
  if coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;
  -- "Del día" es el día del local, en los dos lados de la comparación.
  if v_role = 'supervisor'
     and (v_sale.sold_at at time zone fn_tenant_timezone(v_tenant))::date
      <> (now()           at time zone fn_tenant_timezone(v_tenant))::date then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;

  perform fn_lock_stock(v_tenant, v_sale.store_id, array(
    select product_id from sale_items where sale_id = p_sale_id));

  for v_item in select * from sale_items where sale_id = p_sale_id loop
    update product_lots pl
       set quantity = pl.quantity + sil.quantity
      from sale_item_lots sil
     where sil.sale_item_id = v_item.id and pl.id = sil.lot_id;

    perform fn_post_movement(v_tenant, v_sale.store_id, v_item.product_id,
                             'anulacion_venta', v_item.quantity, v_item.unit_cost,
                             'sale_void', p_sale_id, p_reason, v_user);
  end loop;

  update sales set status = 'anulada', voided_by = v_user,
                   voided_at = now(), void_reason = p_reason
   where id = p_sale_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, v_user, 'sale_void', 'sales', p_sale_id,
          jsonb_build_object('status','completada','total',v_sale.total),
          jsonb_build_object('status','anulada','reason',p_reason));

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'anulada');
end $$;

-- ---------------------------------------------------------------------------
-- Reportes netos de devoluciones
-- ---------------------------------------------------------------------------
-- Las mismas columnas que 0013 (una vista no puede cambiar las suyas). Lo que
-- cambia es que una devolución resta el día en que se hace, del producto y
-- del vendedor de la venta original. Sin esto, una venta de $10.000 devuelta
-- entera seguía sumando $10.000 en Reportes.
create or replace view v_sales_daily
with (security_invoker = true) as
with v as (
  select s.tenant_id, (s.sold_at at time zone fn_tenant_timezone(s.tenant_id))::date as d,
         count(*) as n, sum(s.total) as t
    from sales s where s.status = 'completada' group by 1, 2
), r as (
  select sr.tenant_id, (sr.created_at at time zone fn_tenant_timezone(sr.tenant_id))::date as d,
         sum(sr.monto) as t
    from sale_returns sr join sales s on s.id = sr.sale_id
   where s.status = 'completada' group by 1, 2
)
select coalesce(v.tenant_id, r.tenant_id)            as tenant_id,
       coalesce(v.d, r.d)                            as sale_date,
       coalesce(v.n, 0)                              as sales_count,
       coalesce(v.t, 0) - coalesce(r.t, 0)           as total_amount,
       case when coalesce(v.n, 0) > 0
            then round((coalesce(v.t, 0) - coalesce(r.t, 0))::numeric / v.n)::integer
            else 0 end                               as average_ticket
  from v full join r on r.tenant_id = v.tenant_id and r.d = v.d;

create or replace view v_sales_by_product
with (security_invoker = true) as
with m as (
  select si.tenant_id, si.product_id, si.product_name,
         (s.sold_at at time zone fn_tenant_timezone(s.tenant_id))::date as d,
         si.quantity as q, si.subtotal as ingreso, round(si.quantity * si.unit_cost) as costo
    from sale_items si join sales s on s.id = si.sale_id
   where s.status = 'completada'
  union all
  select si.tenant_id, si.product_id, si.product_name,
         (sr.created_at at time zone fn_tenant_timezone(sr.tenant_id))::date,
         -ri.cantidad, -ri.monto, -round(ri.cantidad * si.unit_cost)
    from sale_return_items ri
    join sale_returns sr on sr.id = ri.return_id
    join sale_items si on si.id = ri.sale_item_id
    join sales s on s.id = sr.sale_id
   where s.status = 'completada'
)
select m.tenant_id, m.product_id, m.product_name, p.category_id,
       m.d                                   as sale_date,
       sum(m.q)                              as units_sold,
       sum(m.ingreso)                        as revenue,
       sum(m.costo)::integer                 as cost,
       sum(m.ingreso - m.costo)::integer     as gross_profit
  from m left join products p on p.id = m.product_id
 group by 1, 2, 3, 4, 5;

create or replace view v_sales_by_user
with (security_invoker = true) as
with m as (
  select s.tenant_id, s.sold_by as user_id,
         (s.sold_at at time zone fn_tenant_timezone(s.tenant_id))::date as d, 1 as n, s.total as t
    from sales s where s.status = 'completada'
  union all
  select s.tenant_id, s.sold_by,
         (sr.created_at at time zone fn_tenant_timezone(sr.tenant_id))::date, 0, -sr.monto
    from sale_returns sr join sales s on s.id = sr.sale_id
   where s.status = 'completada'
)
select m.tenant_id, m.user_id, pr.full_name, m.d as sale_date,
       sum(m.n)::bigint as sales_count, sum(m.t)::bigint as total_amount
  from m left join profiles pr on pr.id = m.user_id
 group by 1, 2, 3, 4;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_guardar_emisor(jsonb)                       from public, anon;
grant  execute on function public.fn_guardar_emisor(jsonb)                       to authenticated;
revoke execute on function public.fn_devolver_venta(uuid, jsonb, text, text)     from public, anon;
grant  execute on function public.fn_devolver_venta(uuid, jsonb, text, text)     to authenticated;

-- Internas: las usan funciones que corren como dueñas. Nadie más.
revoke execute on function public.fn_desglose_lineas(jsonb, numeric, integer)    from public, anon, authenticated;
revoke execute on function public.fn_emisor_dte(uuid)                            from public, anon, authenticated;
revoke execute on function public.fn_siguiente_folio_dte(uuid, smallint, text)   from public, anon, authenticated;
revoke execute on function public.fn_emitir_dte(uuid, smallint, uuid, uuid, jsonb, jsonb, jsonb, integer, numeric, jsonb, uuid)
                                                                                   from public, anon, authenticated;
revoke execute on function public.fn_dte_resumen(uuid)                           from public, anon, authenticated;
revoke execute on function public.fn_emitir_dte_venta(uuid)                      from public, anon, authenticated;
