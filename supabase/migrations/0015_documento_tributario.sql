-- ============================================================================
-- 0015 · Qué documento corresponde por cada venta: boleta, factura o voucher
--
-- Pedido del cliente en la reunión del 2026-09-19 (puntos 4, 6, 9 y 10 de su
-- lista). Tal como describe su mostrador:
--
--   · Efectivo o transferencia  → boleta, más el ticket.
--   · Tarjeta                   → el documento lo emite la MÁQUINA. Al cliente
--                                 se le entrega ese voucher. Emitir además una
--                                 boleta por la misma venta la declararía dos
--                                 veces.
--   · Factura                   → siempre una elección explícita del cajero,
--                                 con cualquier medio de pago, y con los datos
--                                 del receptor.
--
-- Que la tarjeta emita el documento es una característica del terminal, no una
-- ley: un local con una máquina no integrada sí tiene que emitir la boleta.
-- Por eso es `tenants.settings.tarjeta_emite_documento` y no una constante
-- escrita en el código (regla 13).
--
-- LO QUE ESTA MIGRACIÓN NO HACE — y conviene leerlo antes de prometerlo:
-- **no emite el documento ante el SII.** Eso necesita el certificado digital
-- del contribuyente y folios CAF autorizados (B-04 y B-05, `docs/18`), que son
-- trámites y no código. Acá se decide y se registra QUÉ documento corresponde,
-- con los datos del receptor validados. El timbre viene después y no cambia
-- ninguna de estas reglas: cuando llegue, la venta ya sabe qué emitir.
--
-- Mientras tanto el papel que sale del POS sigue diciendo COMPROBANTE INTERNO
-- y NO ES DOCUMENTO TRIBUTARIO. Un ticket que se parece a una boleta sin serlo
-- es un problema del contribuyente ante el SII, y se lo habríamos causado
-- nosotros.
-- ============================================================================

do $$ begin
  create type document_type as enum ('boleta', 'factura', 'voucher');
exception when duplicate_object then null; end $$;

-- 'boleta' por omisión: es lo que corresponde a las ventas que ya existen, que
-- son todas en efectivo o transferencia (el POS no distinguía).
alter table sales
  add column if not exists document_type          document_type not null default 'boleta',
  add column if not exists receptor_rut           text,
  add column if not exists receptor_razon_social  text,
  add column if not exists receptor_giro          text,
  add column if not exists receptor_direccion     text;

-- Una factura sin receptor no es una factura. La restricción está acá y no
-- solo en la función porque `sales` la escribe fn_register_sale hoy, pero el
-- invariante es del dato, no de quien lo inserta.
do $$ begin
  alter table sales add constraint sales_factura_con_receptor
    check (document_type <> 'factura'
           or (receptor_rut is not null and receptor_razon_social is not null));
exception when duplicate_object then null; end $$;

create index if not exists idx_sales_documento
  on sales(tenant_id, document_type, sold_at desc);

-- ---------------------------------------------------------------------------
-- fn_rut_formateado — valida el RUT y lo devuelve con puntos y guion
-- ---------------------------------------------------------------------------
-- Devuelve null si no es un RUT válido, para que quien la llame decida qué
-- hacer. Es el mismo módulo 11 de `packages/core/src/rut.ts`, probado ahí, y
-- está repetido acá a propósito: la app no es la única que puede escribir una
-- venta, y un RUT inválido en una factura lo rechaza el SII, no nosotros.
create or replace function public.fn_rut_formateado(p_rut text)
returns text
language plpgsql immutable set search_path = public
as $$
declare
  v_limpio text;
  v_cuerpo text;
  v_dv     text;
  v_suma   integer := 0;
  v_mult   integer := 2;
  v_resto  integer;
  v_calc   text;
  v_i      integer;
begin
  v_limpio := upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'));
  if length(v_limpio) < 8 then return null; end if;   -- cuerpo de 7 + dígito

  v_cuerpo := left(v_limpio, length(v_limpio) - 1);
  v_dv     := right(v_limpio, 1);
  if v_cuerpo !~ '^[0-9]+$' then return null; end if;

  for v_i in reverse length(v_cuerpo)..1 loop
    v_suma := v_suma + (substr(v_cuerpo, v_i, 1))::integer * v_mult;
    v_mult := case when v_mult = 7 then 2 else v_mult + 1 end;
  end loop;

  v_resto := 11 - (v_suma % 11);
  v_calc := case v_resto when 11 then '0' when 10 then 'K' else v_resto::text end;
  if v_calc <> v_dv then return null; end if;

  -- 76086428 -> 76.086.428-5
  return regexp_replace(reverse(regexp_replace(reverse(v_cuerpo), '(\d{3})(?=\d)', '\1.', 'g')),
                        '$', '-' || v_dv);
end $$;

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0012, con el documento decidido y guardado
-- ---------------------------------------------------------------------------
-- `create or replace` con un parámetro nuevo crearía una SOBRECARGA, no un
-- reemplazo: quedarían dos funciones y PostgreSQL elegiría según los tipos de
-- la llamada. La vieja se borra a mano (mismo criterio que 0014 con
-- fn_adjust_stock).
drop function if exists public.fn_register_sale(uuid, jsonb, jsonb, timestamptz, integer, text, boolean);
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
    v_price := coalesce((v_item->>'unit_price')::integer, v_product.sale_price);
    v_disc  := coalesce((v_item->>'discount_amount')::integer, 0);
    if v_disc < 0 then
      raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
    end if;
    v_subtotal := round(v_qty * v_price)::integer - v_disc;
    if v_subtotal < 0 then v_subtotal := 0; end if;
    v_bruto := v_bruto + round(v_qty * v_price)::integer;
    v_desc  := v_desc + v_disc;
    v_sum := v_sum + v_subtotal;

    select quantity into v_stock from stock_levels
     where tenant_id = v_tenant and store_id = v_store and product_id = v_product.id;
    if coalesce(v_stock,0) < v_qty and not p_force
       and coalesce(v_role::text, '') not in ('admin','supervisor') then
      raise exception 'STOCK_INSUFICIENTE: %', v_product.name using errcode = 'P0001';
    end if;

    insert into sale_items (sale_id, tenant_id, product_id, product_name,
                            quantity, unit_price, unit_cost, discount_amount, subtotal)
    values (v_sale, v_tenant, v_product.id, v_product.name,
            v_qty, v_price, v_product.avg_cost, v_disc, v_subtotal)
    returning id into v_item_id;

    if v_product.tracks_expiry then
      perform fn_consume_lots(v_tenant, v_store, v_product.id, v_qty, v_item_id);
    end if;

    perform fn_post_movement(v_tenant, v_store, v_product.id, 'venta',
                             -v_qty, v_product.avg_cost, 'sale', v_sale, null, v_user);
  end loop;

  v_desc := v_desc + coalesce(p_discount_total, 0);
  if v_desc > 0 then
    select coalesce(max_discount_pct, 0) into v_tope from profiles where id = v_user;
    if not fn_discount_within_limit(v_desc, v_bruto, v_tope) then
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

  update sales
     set subtotal   = v_bruto,
         discount_total = v_desc,
         total      = v_sum,
         tax_amount = round(v_sum - (v_sum / (1 + v_iva/100.0)))::integer
   where id = v_sale;

  return jsonb_build_object(
    'sale_id', v_sale, 'folio', v_folio, 'total', v_sum,
    'change_amount', v_change, 'sold_at', coalesce(p_sold_at, now()),
    'synced_at', now(), 'already_existed', false,
    'document_type', v_doc);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- Para cerrar una función hay que revocarle a `public`, no a `authenticated`:
-- PostgreSQL le concede EXECUTE a `public` al crearla (regla 12). La firma
-- nueva empieza desde cero, así que hay que volver a hacerlo.
revoke execute on function public.fn_register_sale(uuid, jsonb, jsonb, timestamptz, integer, text, boolean, jsonb) from public, anon;
grant  execute on function public.fn_register_sale(uuid, jsonb, jsonb, timestamptz, integer, text, boolean, jsonb) to authenticated;

-- fn_rut_formateado no se expone. Es una calculadora pura, así que dejarla
-- abierta no sería un riesgo, pero tampoco tiene a quién servir: la usa
-- fn_register_sale, que es `security definer` y corre como dueña. La pantalla
-- valida el RUT con `isValidRut` de core, sin ida y vuelta a la base.
--
-- Vale la pena anotar por qué casi se cuela: el verificador de
-- `tools/aplicar-esquema.mjs` solo mira funciones `security definer`, y esta
-- no lo es. La lista RPC_PERMITIDAS no la habría delatado.
revoke execute on function public.fn_rut_formateado(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Valor por omisión del local
-- ---------------------------------------------------------------------------
-- `true` es lo que describió el cliente: su máquina emite el documento. Un
-- local con terminal no integrado lo pone en false y vuelve a emitir boleta
-- con tarjeta, sin tocar código.
update tenants
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object('tarjeta_emite_documento', true)
 where not (coalesce(settings, '{}'::jsonb) ? 'tarjeta_emite_documento');
