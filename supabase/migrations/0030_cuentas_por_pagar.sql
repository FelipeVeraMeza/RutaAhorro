-- ============================================================================
-- 0030 · Cuentas por pagar a proveedores (RF-M3-13)
--
-- El almacén compra a crédito (30 días) y los vencimientos se llevaban en un
-- cuaderno: se pagaban tarde o dos veces. Cada factura de proveedor queda con
-- su vencimiento y su estado (pendiente o pagada), y el Inicio avisa lo que
-- vence en los próximos 7 días.
--
--   · Se registra al recibir la mercadería (la recepción ya trae proveedor,
--     número y total) o suelta, desde Proveedores → Por pagar.
--   · Pagarla es una sola vez y queda quién y cuándo. Si se paga con plata
--     del cajón ("efectivo de la caja"), sale como egreso de la caja abierta
--     de quien paga, para que el cuadre lo explique. Con transferencia o
--     cheque no toca la caja.
--   · Una factura mal ingresada no se borra: se anula con motivo (solo
--     admin, y solo si no está pagada).
--   · Lo leen admin y supervisor (montos de compra = costos, como Reportes).
--     Bodega puede registrarla al recibir, pero no lista lo adeudado.
-- ============================================================================

create table if not exists facturas_proveedor (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  supplier_id     uuid not null references suppliers(id) on delete restrict,
  receipt_id      uuid references purchase_receipts(id) on delete set null,
  numero          text not null check (length(trim(numero)) > 0),
  emitida         date,
  vence           date not null,
  monto           integer not null check (monto > 0),
  nota            text,
  pagada_en       timestamptz,
  pagada_por      uuid references profiles(id) on delete set null,
  pago_metodo     text check (pago_metodo in ('transferencia', 'efectivo_caja', 'cheque', 'otro')),
  anulada_en      timestamptz,
  anulada_motivo  text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
-- La misma factura no se ingresa dos veces (salvo que la primera se anulara).
create unique index if not exists facturas_proveedor_unica
  on facturas_proveedor(tenant_id, supplier_id, upper(trim(numero))) where anulada_en is null;
create index if not exists idx_facturas_proveedor_vence
  on facturas_proveedor(tenant_id, vence) where pagada_en is null and anulada_en is null;

alter table facturas_proveedor enable row level security;
drop policy if exists facturas_proveedor_read on facturas_proveedor;
create policy facturas_proveedor_read on facturas_proveedor for select to authenticated
  using (tenant_id = current_tenant_id()
         and coalesce(current_user_role()::text, '') in ('admin', 'supervisor'));

-- ---------------------------------------------------------------------------
-- fn_registrar_factura_proveedor
-- ---------------------------------------------------------------------------
-- `p_datos`: {receipt_id?, supplier_id?, numero?, monto?, emitida?, vence, nota?}.
-- Con `receipt_id`, el proveedor, el número y el monto salen de la recepción
-- si no vienen.
create or replace function public.fn_registrar_factura_proveedor(p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_rec      purchase_receipts%rowtype;
  v_supplier uuid;
  v_numero   text;
  v_monto    integer;
  v_vence    date;
  v_emitida  date;
  v_id       uuid;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'bodega') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if nullif(p_datos->>'receipt_id', '') is not null then
    select * into v_rec from purchase_receipts
     where id = (p_datos->>'receipt_id')::uuid and tenant_id = v_tenant;
    if not found then raise exception 'RECEPCION_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  end if;

  v_supplier := coalesce(nullif(p_datos->>'supplier_id', '')::uuid, v_rec.supplier_id);
  v_numero   := coalesce(nullif(trim(p_datos->>'numero'), ''), nullif(trim(v_rec.document_number), ''));
  begin
    v_monto   := coalesce(nullif(p_datos->>'monto', '')::integer, v_rec.total_amount);
    v_vence   := (p_datos->>'vence')::date;
    v_emitida := coalesce(nullif(p_datos->>'emitida', '')::date,
                          (v_rec.received_at at time zone fn_tenant_timezone(v_tenant))::date);
  exception when others then
    raise exception 'DATOS_FACTURA_INVALIDOS' using errcode = 'P0001';
  end;

  if v_supplier is null or not exists (select 1 from suppliers where id = v_supplier and tenant_id = v_tenant) then
    raise exception 'PROVEEDOR_REQUERIDO' using errcode = 'P0001';
  end if;
  if v_numero is null then raise exception 'NUMERO_FACTURA_REQUERIDO' using errcode = 'P0001'; end if;
  if coalesce(v_monto, 0) <= 0 then raise exception 'MONTO_INVALIDO' using errcode = 'P0001'; end if;
  if v_vence is null then raise exception 'VENCIMIENTO_FACTURA_REQUERIDO' using errcode = 'P0001'; end if;
  if v_emitida is not null and v_vence < v_emitida then
    raise exception 'VENCE_ANTES_DE_EMITIDA' using errcode = 'P0001';
  end if;

  begin
    insert into facturas_proveedor (tenant_id, supplier_id, receipt_id, numero, emitida, vence, monto,
                                    nota, created_by)
    values (v_tenant, v_supplier, v_rec.id, v_numero, v_emitida, v_vence, v_monto,
            nullif(trim(p_datos->>'nota'), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'FACTURA_PROVEEDOR_DUPLICADA' using errcode = 'P0001';
  end;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'crear', 'factura_proveedor', v_id,
          jsonb_build_object('numero', v_numero, 'monto', v_monto, 'vence', v_vence));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- fn_pagar_factura_proveedor
-- ---------------------------------------------------------------------------
create or replace function public.fn_pagar_factura_proveedor(
  p_id uuid, p_metodo text, p_nota text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_user    uuid := auth.uid();
  v_f       facturas_proveedor%rowtype;
  v_session uuid;
  v_prov    text;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_metodo is null or p_metodo not in ('transferencia', 'efectivo_caja', 'cheque', 'otro') then
    raise exception 'METODO_INVALIDO' using errcode = 'P0001';
  end if;
  -- Bloqueada: dos personas marcándola a la vez no la pagan dos veces.
  select * into v_f from facturas_proveedor where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_f.anulada_en is not null then raise exception 'FACTURA_ANULADA' using errcode = 'P0001'; end if;
  if v_f.pagada_en is not null then raise exception 'FACTURA_YA_PAGADA' using errcode = 'P0001'; end if;

  if p_metodo = 'efectivo_caja' then
    select id into v_session from cash_sessions
     where user_id = v_user and status = 'abierta' limit 1 for share;
    if v_session is null then raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001'; end if;
    select name into v_prov from suppliers where id = v_f.supplier_id;
    insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
    values (v_tenant, v_session, 'egreso', v_f.monto,
            'Pago factura N° ' || v_f.numero || ' · ' || coalesce(v_prov, 'proveedor'), v_user);
  end if;

  update facturas_proveedor
     set pagada_en = now(), pagada_por = v_user, pago_metodo = p_metodo,
         nota = coalesce(nullif(trim(p_nota), ''), nota)
   where id = p_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'pagar', 'factura_proveedor', p_id,
          jsonb_build_object('numero', v_f.numero, 'monto', v_f.monto, 'metodo', p_metodo));
  return jsonb_build_object('id', p_id, 'pagada_en', now(), 'egreso_caja', v_session is not null);
end $$;

-- ---------------------------------------------------------------------------
-- fn_anular_factura_proveedor
-- ---------------------------------------------------------------------------
create or replace function public.fn_anular_factura_proveedor(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_f      facturas_proveedor%rowtype;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;
  select * into v_f from facturas_proveedor where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_f.pagada_en is not null then raise exception 'FACTURA_YA_PAGADA' using errcode = 'P0001'; end if;
  if v_f.anulada_en is not null then return; end if;
  update facturas_proveedor set anulada_en = now(), anulada_motivo = trim(p_motivo) where id = p_id;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'anular', 'factura_proveedor', p_id,
          jsonb_build_object('numero', v_f.numero, 'motivo', trim(p_motivo)));
end $$;

revoke execute on function public.fn_registrar_factura_proveedor(jsonb)        from public, anon;
grant  execute on function public.fn_registrar_factura_proveedor(jsonb)        to authenticated;
revoke execute on function public.fn_pagar_factura_proveedor(uuid, text, text) from public, anon;
grant  execute on function public.fn_pagar_factura_proveedor(uuid, text, text) to authenticated;
revoke execute on function public.fn_anular_factura_proveedor(uuid, text)      from public, anon;
grant  execute on function public.fn_anular_factura_proveedor(uuid, text)      to authenticated;

-- ============================================================================
-- Bodega no cambia precios (pendiente de la auditoría por rol, 2026-09-30)
--
-- La pantalla ya no le ofrece el precio a bodega, pero `fn_update_product`
-- (y cualquier otro camino) lo dejaba cambiar: ocultar un campo no es
-- seguridad (regla 6). Con un disparador y no en la función, para que valga
-- por cualquier camino que escriba `products`. El costo no se toca: la
-- recepción que hace bodega lo recalcula, y eso es correcto.
-- ============================================================================
create or replace function public.fn_bodega_sin_precio()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.sale_price is distinct from old.sale_price
     and coalesce(current_user_role()::text, '') = 'bodega' then
    raise exception 'SIN_PERMISO_PRECIO' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_bodega_sin_precio on products;
create trigger trg_bodega_sin_precio before update of sale_price on products
  for each row execute function fn_bodega_sin_precio();
revoke execute on function public.fn_bodega_sin_precio() from public, anon, authenticated;
