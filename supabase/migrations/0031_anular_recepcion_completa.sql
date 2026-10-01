-- ============================================================================
-- 0031 · Anular una recepción deshace TODO lo que hizo (revisión por rol,
-- docs/26, N° 64 a 66)
--
-- fn_void_receipt (0012) devolvía el stock con un movimiento contrario, pero:
--   · el LOTE que la recepción creó o engordó quedaba con su cantidad: un
--     lote fantasma que seguía avisando que vence y del que FEFO "vendía";
--   · el COSTO PROMEDIO quedaba calculado con la recepción anulada: un costo
--     mal tecleado (la razón más común para anular) se quedaba en el margen
--     y en el inventario valorizado para siempre;
--   · su factura en Compras → Por pagar (0030) seguía pendiente.
-- Misma firma: reemplazo, no sobrecarga (regla 21).
-- ============================================================================

create or replace function public.fn_void_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_rec    purchase_receipts%rowtype;
  v_item   purchase_receipt_items%rowtype;
  v_prod   products%rowtype;
  v_stock  numeric(14,3);
  v_resto  numeric(14,3);
  v_pagada boolean := false;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  select * into v_rec from purchase_receipts
   where id = p_receipt_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_rec.status = 'anulada' then
    raise exception 'RECEPCION_YA_ANULADA' using errcode = 'P0001';
  end if;

  perform fn_lock_stock(v_tenant, v_rec.store_id, array(
    select product_id from purchase_receipt_items where receipt_id = p_receipt_id));

  for v_item in select * from purchase_receipt_items where receipt_id = p_receipt_id loop
    select * into v_prod from products where id = v_item.product_id for update;
    select coalesce(sum(quantity), 0) into v_stock from stock_levels
     where tenant_id = v_tenant and product_id = v_item.product_id;

    -- El promedio sin esta entrada: lo inverso de lo que hizo la recepción.
    -- Si no queda stock (o el cálculo da negativo), se deja el que había.
    v_resto := v_stock - v_item.quantity;
    if v_resto > 0 then
      update products
         set avg_cost = greatest(round((v_prod.avg_cost * v_stock - v_item.quantity * v_item.unit_cost) / v_resto)::integer, 0),
             updated_at = now()
       where id = v_prod.id
         and (v_prod.avg_cost * v_stock - v_item.quantity * v_item.unit_cost) >= 0;
    end if;

    -- El lote: se le resta lo que entró, sin bajar de cero (lo que ya se
    -- vendió de él no vuelve).
    if v_prod.tracks_expiry and v_item.expiry_date is not null then
      update product_lots
         set quantity = greatest(quantity - v_item.quantity, 0)
       where tenant_id = v_tenant and store_id = v_rec.store_id and product_id = v_item.product_id
         and lot_code is not distinct from v_item.lot_code and expiry_date = v_item.expiry_date;
    end if;

    perform fn_post_movement(v_tenant, v_rec.store_id, v_item.product_id,
                             'anulacion_recepcion', -v_item.quantity, v_item.unit_cost,
                             'receipt_void', p_receipt_id, p_reason, v_user);
  end loop;

  update purchase_receipts
     set status = 'anulada', voided_by = v_user, voided_at = now(), void_reason = p_reason
   where id = p_receipt_id;

  -- La factura por pagar de esta recepción: si no está pagada, se anula con
  -- ella. Si ya se pagó, se deja (la plata salió) y se avisa en la respuesta.
  select exists (select 1 from facturas_proveedor where receipt_id = p_receipt_id
                  and anulada_en is null and pagada_en is not null) into v_pagada;
  update facturas_proveedor
     set anulada_en = now(), anulada_motivo = 'Recepción anulada: ' || trim(p_reason)
   where receipt_id = p_receipt_id and anulada_en is null and pagada_en is null;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'receipt_void', 'purchase_receipts', p_receipt_id,
          jsonb_build_object('reason', p_reason));

  return jsonb_build_object('receipt_id', p_receipt_id, 'status', 'anulada', 'factura_ya_pagada', v_pagada);
end $$;

-- ---------------------------------------------------------------------------
-- El kardex sigue inmutable, con UNA excepción que ya usaba fn_confirm_receipt
-- (0006/0012): tras insertar el movimiento de recepción, le anota el lote
-- (lot_id de null a un valor). fn_block_modify rechazaba también eso, así que
-- recibir CUALQUIER producto con vencimiento fallaba con REGISTRO_INMUTABLE.
-- Se permite solo ese cambio; cualquier otro UPDATE y todo DELETE se rechazan
-- igual que antes (ADR-006). La tabla no tiene políticas de escritura
-- (regla 14): solo las funciones pueden llegar a hacerlo.
-- ---------------------------------------------------------------------------
create or replace function public.fn_kardex_inmutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.lot_id is null and new.lot_id is not null
     and (to_jsonb(new) - 'lot_id') = (to_jsonb(old) - 'lot_id') then
    return new;
  end if;
  raise exception 'REGISTRO_INMUTABLE: % no admite % (docs/adr/ADR-006)',
    tg_table_name, tg_op using errcode = '42501';
end $$;

revoke execute on function public.fn_kardex_inmutable() from public, anon, authenticated;

drop trigger if exists trg_movements_immutable on inventory_movements;
create trigger trg_movements_immutable
  before update or delete on inventory_movements
  for each row execute function public.fn_kardex_inmutable();
