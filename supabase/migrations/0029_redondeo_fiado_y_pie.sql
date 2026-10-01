-- ============================================================================
-- 0029 · Redondeo del efectivo, venta fiada y pie del comprobante
--
-- (1) RF-M5-28 · Ley 20.956 (2017). Sin monedas de $1 ni $5, lo que se paga
--     todo en efectivo se redondea a la decena: terminados en 1 a 5 bajan, en
--     6 a 9 suben (`redondeoEfectivo` en core, `fn_redondeo_efectivo` acá).
--     Decisión de diseño, a confirmar con el contador:
--       · El TOTAL de la venta, su IVA y la boleta siguen siendo los exactos.
--         El redondeo no cambia el precio de nada ni la base del impuesto.
--       · El pago en efectivo registra lo que entró al cajón (el redondeado),
--         y la diferencia queda en `sales.ajuste_redondeo` (−5 a +4).
--       · Por eso el cuadre de caja, que suma los pagos en efectivo, cuadra
--         solo, y el resumen de la caja muestra el ajuste del turno aparte.
--     Una venta que llega con el monto exacto se sigue aceptando (la cola sin
--     conexión de una versión anterior).
--
-- (2) RF-M5-30 · Venta fiada. Medio de pago `fiado`, solo con un cliente
--     elegido y hasta su `credito_tope` (0 = no se le fía; lo pone admin o
--     supervisor). La cuenta del cliente es una lista inmutable de
--     movimientos (`cuenta_cliente_movimientos`): cargo por cada venta
--     fiada, abono cuando paga, y la anulación o devolución de una venta
--     fiada rebaja la deuda. El saldo es la suma; nada se edita.
--     Lo fiado NO entra al efectivo esperado de la caja; un abono en
--     efectivo SÍ (entra plata al cajón de quien lo recibe).
--
-- (3) RF-M9-13 · `comprobante_pie`: un texto de hasta 160 caracteres que el
--     administrador escribe en Configuración y sale al pie del comprobante.
-- ============================================================================

alter type payment_method add value if not exists 'fiado';

-- La pantalla redondea solo si la base lo sabe hacer: `redondeo_efectivo` lo
-- pone esta migración. Una versión de la aplicación publicada antes de
-- aplicarla cobraría $1.460 por una venta de $1.463 y la base anterior la
-- rechazaría (PAGO_NO_CUADRA): ninguna venta en efectivo pasaría. No está en
-- la lista blanca de la configuración: es ley, no una preferencia.
update tenants
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('redondeo_efectivo', true)
 where not (coalesce(settings, '{}'::jsonb) ? 'redondeo_efectivo');
alter table tenants alter column settings set default jsonb_build_object(
  'iva_pct', 19,
  'timezone', 'America/Santiago',
  'currency', 'CLP',
  'max_discount_pct', jsonb_build_object(
    'admin', 100, 'supervisor', 10, 'vendedor', 0, 'bodega', 0),
  'cash_alert_hours', 12,
  'cost_variation_alert_pct', 20,
  'tarjeta_emite_documento', true,
  'vender_sin_stock', true,
  'efectivo_inicial_sugerido', 20000,
  'redondeo_efectivo', true
);

alter table sales add column if not exists ajuste_redondeo integer not null default 0;
alter table clientes add column if not exists credito_tope integer not null default 0;
do $$ begin
  alter table clientes add constraint clientes_credito_tope_rango
    check (credito_tope >= 0 and credito_tope <= 5000000);
exception when duplicate_object then null; end $$;

-- Una devolución de una venta fiada se "reembolsa" a la cuenta.
alter table sale_returns drop constraint if exists sale_returns_reembolso_check;
alter table sale_returns add constraint sale_returns_reembolso_check
  check (reembolso in ('efectivo', 'transferencia', 'debito', 'credito', 'fiado'));

create table if not exists cuenta_cliente_movimientos (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  cliente_id       uuid not null references clientes(id) on delete restrict,
  tipo             text not null check (tipo in ('cargo', 'abono', 'anulacion', 'devolucion')),
  monto            integer not null check (monto > 0),
  sale_id          uuid references sales(id) on delete restrict,
  -- Abono: cómo pagó. En efectivo, a la caja de quien lo recibió.
  metodo           text check (metodo in ('efectivo', 'transferencia', 'debito', 'credito')),
  cash_session_id  uuid references cash_sessions(id) on delete set null,
  nota             text,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_cuenta_cliente on cuenta_cliente_movimientos(cliente_id, created_at);
create index if not exists idx_cuenta_caja on cuenta_cliente_movimientos(cash_session_id)
  where cash_session_id is not null;

-- RLS: se lee en el local (el vendedor ve cuánto le queda al cliente); se
-- escribe solo con las funciones (regla 14).
alter table cuenta_cliente_movimientos enable row level security;
drop policy if exists cuenta_cliente_read on cuenta_cliente_movimientos;
create policy cuenta_cliente_read on cuenta_cliente_movimientos for select to authenticated
  using (tenant_id = current_tenant_id());

-- Inmutable (como el kardex): una corrección es otro movimiento.
create or replace function public.fn_cuenta_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'MOVIMIENTO_INMUTABLE' using errcode = 'P0001';
end $$;
drop trigger if exists trg_cuenta_inmutable on cuenta_cliente_movimientos;
create trigger trg_cuenta_inmutable before update or delete on cuenta_cliente_movimientos
  for each row execute function fn_cuenta_inmutable();

-- ---------------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------------
-- Réplica de `redondeoEfectivo` en core.
create or replace function public.fn_redondeo_efectivo(p_total integer)
returns integer language sql immutable as $$
  select case when p_total % 10 <= 5 then p_total - p_total % 10
              else p_total + 10 - p_total % 10 end
$$;

create or replace function public.fn_saldo_cliente(p_cliente uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(case tipo when 'cargo' then monto else -monto end), 0)::integer
    from cuenta_cliente_movimientos where cliente_id = p_cliente
$$;

-- Saldo de cada cliente con cuenta, para la lista y el POS.
drop view if exists v_cuenta_clientes;
create view v_cuenta_clientes with (security_invoker = true) as
select c.tenant_id, c.id as cliente_id, c.nombre, c.credito_tope,
       coalesce(sum(case m.tipo when 'cargo' then m.monto else -m.monto end), 0)::integer as saldo,
       max(m.created_at) filter (where m.tipo = 'abono') as ultimo_abono,
       max(m.created_at) filter (where m.tipo = 'cargo') as ultimo_cargo
  from clientes c left join cuenta_cliente_movimientos m on m.cliente_id = c.id
 group by c.tenant_id, c.id, c.nombre, c.credito_tope;

-- ---------------------------------------------------------------------------
-- fn_tope_credito — cuánto se le puede fiar a un cliente
-- ---------------------------------------------------------------------------
create or replace function public.fn_tope_credito(p_cliente uuid, p_tope integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_antes  integer;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_tope is null or p_tope < 0 or p_tope > 5000000 then
    raise exception 'TOPE_CREDITO_INVALIDO' using errcode = 'P0001';
  end if;
  select credito_tope into v_antes from clientes
   where id = p_cliente and tenant_id = v_tenant for update;
  if not found then raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  update clientes set credito_tope = p_tope, updated_at = now() where id = p_cliente;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), 'editar', 'cliente_credito', p_cliente,
          jsonb_build_object('credito_tope', v_antes), jsonb_build_object('credito_tope', p_tope));
  return p_tope;
end $$;

-- ---------------------------------------------------------------------------
-- fn_abonar_cuenta — el cliente paga lo que debe (todo o una parte)
-- ---------------------------------------------------------------------------
-- En efectivo, la plata entra a la caja abierta de quien lo recibe (y suma
-- a su efectivo esperado). No se abona más de lo que se debe: un saldo a
-- favor es plata que el local guarda sin que nada lo diga.
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

  if p_metodo = 'efectivo' then
    -- `for share`, como la venta: no se cuela en una caja que se está cerrando.
    select id into v_session from cash_sessions
     where user_id = v_user and status = 'abierta' limit 1 for share;
    if v_session is null then
      raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
    end if;
  end if;

  insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto, metodo,
                                          cash_session_id, nota, created_by)
  values (v_tenant, p_cliente, 'abono', p_monto, p_metodo, v_session,
          nullif(trim(p_nota), ''), v_user)
  returning id into v_id;

  return jsonb_build_object('movimiento_id', v_id, 'saldo', v_saldo - p_monto);
end $$;

-- ---------------------------------------------------------------------------
-- Anular una venta fiada rebaja la deuda
-- ---------------------------------------------------------------------------
-- Con un disparador y no copiando fn_void_sale: cualquier camino que anule
-- una venta (hoy uno solo) deja la cuenta al día.
create or replace function public.fn_cuenta_al_anular()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_fiado integer;
  v_saldo integer;
begin
  if new.status = 'anulada' and old.status = 'completada' and new.cliente_id is not null then
    select coalesce(sum(amount), 0) into v_fiado from sale_payments
     where sale_id = new.id and method = 'fiado';
    if v_fiado > 0 then
      perform 1 from clientes where id = new.cliente_id for update;
      v_saldo := fn_saldo_cliente(new.cliente_id);
      if least(v_fiado, v_saldo) > 0 then
        insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto, sale_id, nota, created_by)
        values (new.tenant_id, new.cliente_id, 'anulacion', least(v_fiado, v_saldo), new.id,
                'Venta folio ' || new.folio || ' anulada', auth.uid());
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_cuenta_al_anular on sales;
create trigger trg_cuenta_al_anular after update of status on sales
  for each row execute function fn_cuenta_al_anular();

-- ---------------------------------------------------------------------------
-- fn_cash_session_summary — con el redondeo, lo fiado y los abonos
-- ---------------------------------------------------------------------------
-- Misma firma. El esperado suma los abonos en efectivo recibidos en esta caja;
-- lo fiado aparece en `by_payment_method` pero no en `cash_sales`.
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

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', v_s.status,
    'opened_at', v_s.opened_at,
    'opening_amount', v_s.opening_amount,
    'cash_sales', v_cash_sales,
    'cash_in', v_in,
    'cash_out', v_out,
    'abonos_efectivo', v_abonos,
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

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0023, con el redondeo y el fiado
-- ---------------------------------------------------------------------------
-- Misma firma (regla 21): reemplazo, no sobrecarga.
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
  -- 0029
  v_redondeo         integer := 0;
  v_fiado            integer := 0;
  v_tope_credito     integer;
  v_saldo            integer;
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
      'ajuste_redondeo', v_existing.ajuste_redondeo,
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

  -- 0029 · RF-M5-30 · Fiado: solo a un cliente identificado y hasta su tope.
  -- La fila del cliente se bloquea: dos cajas fiándole a la vez no pasan las
  -- dos el tope mirando el mismo saldo.
  select coalesce(sum((x->>'amount')::integer), 0) into v_fiado
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) x where x->>'method' = 'fiado';
  if v_fiado > 0 then
    if v_cliente is null then
      raise exception 'FIADO_SIN_CLIENTE' using errcode = 'P0001';
    end if;
    select credito_tope into v_tope_credito from clientes where id = v_cliente for update;
    v_saldo := fn_saldo_cliente(v_cliente);
    if v_saldo + v_fiado > coalesce(v_tope_credito, 0) then
      raise exception 'FIADO_EXCEDE_TOPE' using errcode = 'P0001';
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

  -- 0029 · RF-M5-28 · Ley 20.956: pagado todo en efectivo, se cobra el total
  -- redondeado a la decena. El total de la venta (y de la boleta) sigue
  -- siendo el exacto; la diferencia queda en `ajuste_redondeo` y el pago en
  -- efectivo es lo que entró al cajón, que es lo que cuadra la caja. Se sigue
  -- aceptando el monto exacto: una venta que esperaba en la cola sin conexión
  -- desde antes de esta versión llega así.
  if v_paid <> v_sum then
    if jsonb_array_length(p_payments) > 0
       and not exists (select 1 from jsonb_array_elements(p_payments) x where x->>'method' <> 'efectivo')
       and v_paid = fn_redondeo_efectivo(v_sum) then
      v_redondeo := v_paid - v_sum;
    else
      raise exception 'PAGO_NO_CUADRA' using errcode = 'P0001';
    end if;
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
         combos_aplicados      = case when v_desc > 0 then v_combos->'aplicados' else '[]'::jsonb end,
         ajuste_redondeo       = v_redondeo
   where id = v_sale;

  -- 0029 · Lo fiado entra a la cuenta del cliente, en la misma transacción.
  if v_fiado > 0 then
    insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto, sale_id,
                                            cash_session_id, created_by)
    values (v_tenant, v_cliente, 'cargo', v_fiado, v_sale, v_session, v_user);
  end if;

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
    'ajuste_redondeo', v_redondeo, 'cobrado', v_paid,
    'dte', v_dte);
end $$;

-- ---------------------------------------------------------------------------
-- fn_devolver_venta — igual que 0019, con la devolución a la cuenta
-- ---------------------------------------------------------------------------
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
  -- 0029
  v_fiado     integer := 0;
  v_cliente   uuid;
  v_saldo     integer;
begin
  if not is_active_user() or v_role not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_DEVOLVER' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_reembolso not in ('efectivo', 'transferencia', 'debito', 'credito', 'fiado') then
    raise exception 'REEMBOLSO_INVALIDO' using errcode = 'P0001';
  end if;

  select * into v_sale from sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VENTA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_sale.status = 'anulada' then raise exception 'VENTA_YA_ANULADA' using errcode = 'P0001'; end if;

  -- 0029 · Lo que se fió no se devuelve en plata: se rebaja de la cuenta. Y
  -- una venta pagada no se "devuelve a la cuenta" de nadie.
  select coalesce(sum(amount), 0) into v_fiado from sale_payments
   where sale_id = p_sale_id and method = 'fiado';
  if p_reembolso = 'fiado' and v_fiado = 0 then
    raise exception 'REEMBOLSO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_reembolso <> 'fiado' and v_fiado > 0 then
    raise exception 'VENTA_FIADA_REEMBOLSO_A_CUENTA' using errcode = 'P0001';
  end if;

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

  -- 0029 · Devuelto a la cuenta: rebaja la deuda, nunca por debajo de cero
  -- (si ya abonó, lo que sobra se le devuelve aparte, en plata).
  if p_reembolso = 'fiado' and v_total > 0 then
    select cliente_id into v_cliente from sales where id = p_sale_id;
    perform 1 from clientes where id = v_cliente for update;
    v_saldo := fn_saldo_cliente(v_cliente);
    if least(v_total, v_saldo) > 0 then
      insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto, sale_id,
                                              nota, created_by)
      values (v_tenant, v_cliente, 'devolucion', least(v_total, v_saldo), p_sale_id,
              'Devolución N° ' || v_numero || ' · ' || trim(p_motivo), v_user);
    end if;
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
-- fn_guardar_configuracion — igual que 0021, más `comprobante_pie`
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
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'CONFIGURACION_INVALIDA' using errcode = 'P0001';
  end if;

  for v_clave, v_valor in select * from jsonb_each(p_cambios) loop
    case v_clave
      when 'vender_sin_stock', 'tarjeta_emite_documento', 'ofertas_activas' then
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
      -- 0029 · RF-M9-13 · El pie del comprobante: texto corto o vacío.
      when 'comprobante_pie' then
        if jsonb_typeof(v_valor) <> 'string' or length(v_valor #>> '{}') > 160 then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        v_valor := to_jsonb(trim(v_valor #>> '{}'));
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
-- Permisos (regla 12: se le revoca a public)
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_redondeo_efectivo(integer)            from public, anon;
grant  execute on function public.fn_redondeo_efectivo(integer)            to authenticated;
revoke execute on function public.fn_saldo_cliente(uuid)                    from public, anon, authenticated;
revoke execute on function public.fn_cuenta_al_anular()                     from public, anon, authenticated;
revoke execute on function public.fn_cuenta_inmutable()                     from public, anon, authenticated;
revoke execute on function public.fn_tope_credito(uuid, integer)            from public, anon;
grant  execute on function public.fn_tope_credito(uuid, integer)            to authenticated;
revoke execute on function public.fn_abonar_cuenta(uuid, integer, text, text) from public, anon;
grant  execute on function public.fn_abonar_cuenta(uuid, integer, text, text) to authenticated;
