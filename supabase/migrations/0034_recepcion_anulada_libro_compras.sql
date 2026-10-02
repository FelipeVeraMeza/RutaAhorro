-- ============================================================================
-- 0034 · Anular una recepción anula su factura en el libro de compras
--
-- Desde 2026-10-01 Recibir mercadería deja la factura en el libro de compras
-- (`facturas_recibidas`, con su `receipt_id`, que 0026 ya guardaba). Anular la
-- recepción (0031) sacaba el stock y anulaba la factura por pagar, pero la
-- factura seguía en el libro: el IVA crédito del mes quedaba contando una
-- compra que no existió.
--
-- Va como disparador sobre `purchase_receipts` y no dentro de
-- `fn_void_receipt`: así no se reescribe esa función (0031), y la regla vale
-- para cualquier camino que anule una recepción.
-- ============================================================================

create or replace function public.fn_recepcion_anulada_libro()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update facturas_recibidas
     set estado = 'anulada',
         anulada_motivo = left('Recepción anulada: ' || coalesce(nullif(trim(new.void_reason), ''), 'sin motivo'), 500),
         anulada_por = new.voided_by
   where receipt_id = new.id and tenant_id = new.tenant_id and estado = 'vigente';
  return new;
end $$;

drop trigger if exists trg_recepcion_anulada_libro on purchase_receipts;
create trigger trg_recepcion_anulada_libro
  after update of status on purchase_receipts
  for each row
  when (new.status = 'anulada' and old.status is distinct from 'anulada')
  execute function public.fn_recepcion_anulada_libro();

revoke execute on function public.fn_recepcion_anulada_libro() from public, anon, authenticated;
