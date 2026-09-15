-- ============================================================================
-- RutaAhorro · 0003 · Triggers
-- Inmutabilidad, historial de precios, alertas. Ver docs/06-modelo-datos.md §5.5
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Inmutabilidad del kardex y la bitácora (ADR-006)
-- Rechaza UPDATE y DELETE para TODOS los roles, incluido admin y el propietario
-- de la base. Un administrador que puede borrar la bitácora convierte la
-- bitácora en decoración.
-- ---------------------------------------------------------------------------
create or replace function public.fn_block_modify()
returns trigger
language plpgsql
as $$
begin
  raise exception 'REGISTRO_INMUTABLE: % no admite % (docs/adr/ADR-006)',
    tg_table_name, tg_op using errcode = '42501';
end $$;

drop trigger if exists trg_movements_immutable on inventory_movements;
create trigger trg_movements_immutable
  before update or delete on inventory_movements
  for each row execute function public.fn_block_modify();

drop trigger if exists trg_audit_immutable on audit_log;
create trigger trg_audit_immutable
  before update or delete on audit_log
  for each row execute function public.fn_block_modify();

drop trigger if exists trg_price_history_immutable on price_history;
create trigger trg_price_history_immutable
  before update or delete on price_history
  for each row execute function public.fn_block_modify();

-- ---------------------------------------------------------------------------
-- Caja cerrada es inmutable (RF-M6-08)
-- ---------------------------------------------------------------------------
create or replace function public.fn_block_closed_session()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from cash_sessions
              where id = new.cash_session_id and status = 'cerrada') then
    raise exception 'CAJA_YA_CERRADA' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_cash_movement_session_open on cash_movements;
create trigger trg_cash_movement_session_open
  before insert on cash_movements
  for each row execute function public.fn_block_closed_session();

-- ---------------------------------------------------------------------------
-- Historial de precios (RF-M2-09)
-- ---------------------------------------------------------------------------
create or replace function public.fn_track_price_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.sale_price is distinct from old.sale_price then
    insert into price_history (tenant_id, product_id, old_price, new_price, changed_by)
    values (new.tenant_id, new.id, old.sale_price, new.sale_price, auth.uid());

    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id,
                           old_values, new_values)
    values (new.tenant_id, auth.uid(), 'price_change', 'products', new.id,
            jsonb_build_object('sale_price', old.sale_price),
            jsonb_build_object('sale_price', new.sale_price));
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_price_history on products;
create trigger trg_price_history
  before update on products
  for each row execute function public.fn_track_price_change();

-- ---------------------------------------------------------------------------
-- Alerta de stock bajo mínimo (RF-M8-01)
-- Solo al CRUZAR el umbral hacia abajo: si no, cada venta de un producto ya
-- bajo mínimo generaría una alerta nueva y el panel se volvería inútil.
-- ---------------------------------------------------------------------------
create or replace function public.fn_low_stock_alert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_min numeric(14,3); v_name text;
begin
  select min_stock, name into v_min, v_name from products where id = new.product_id;

  if v_min > 0 and new.quantity <= v_min
     and (tg_op = 'INSERT' or old.quantity > v_min) then
    insert into alerts (tenant_id, type, severity, payload)
    values (new.tenant_id, 'low_stock',
            case when new.quantity <= 0 then 'critical' else 'warning' end,
            jsonb_build_object('product_id', new.product_id, 'product_name', v_name,
                               'quantity', new.quantity, 'min_stock', v_min));
  end if;
  return new;
end $$;

drop trigger if exists trg_low_stock on stock_levels;
create trigger trg_low_stock
  after insert or update of quantity on stock_levels
  for each row execute function public.fn_low_stock_alert();

-- ---------------------------------------------------------------------------
-- Auditoría de cambios de usuario (RF-M9-05)
-- ---------------------------------------------------------------------------
create or replace function public.fn_audit_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      insert into audit_log (tenant_id, user_id, action, entity_type, entity_id,
                             old_values, new_values)
      values (new.tenant_id, auth.uid(), 'role_change', 'profiles', new.id,
              jsonb_build_object('role', old.role),
              jsonb_build_object('role', new.role));
    end if;
    if new.is_active is distinct from old.is_active then
      insert into audit_log (tenant_id, user_id, action, entity_type, entity_id,
                             old_values, new_values)
      values (new.tenant_id, auth.uid(),
              case when new.is_active then 'user_activate' else 'user_deactivate' end,
              'profiles', new.id,
              jsonb_build_object('is_active', old.is_active),
              jsonb_build_object('is_active', new.is_active));
    end if;
  elsif tg_op = 'INSERT' then
    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (new.tenant_id, auth.uid(), 'user_create', 'profiles', new.id,
            jsonb_build_object('role', new.role, 'email', new.email));
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_profile on profiles;
create trigger trg_audit_profile
  after insert or update on profiles
  for each row execute function public.fn_audit_profile();
