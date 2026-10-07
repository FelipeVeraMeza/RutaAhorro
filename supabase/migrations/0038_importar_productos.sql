-- =============================================================================
-- 0038 · Importar productos en lote, en la base
-- =============================================================================
-- La carga masiva la hacía el navegador producto por producto: cinco o seis
-- llamadas por fila, 714 productos tardaban más de diez minutos y si se
-- cerraba la pestaña quedaba a medias (Felipe, 2026-10-07: "debería poder
-- cerrar la pestaña"). Ahora el navegador manda lotes de 100 filas y esta
-- función hace cada lote en una sola llamada, en segundos.
--
-- Usa fn_create_product y fn_update_product, las mismas del formulario: los
-- permisos, el local y las validaciones son los de siempre.
--
-- Y corrige lo que hacía la carga al ACTUALIZAR un producto que ya existía:
-- mandaba lo que la planilla no traía como si fuera un valor. Con la columna
-- de costo vacía viajaba 0 y el costo quedaba en cero; sin categoría se la
-- borraba; "no perecible" le quitaba el control de vencimiento a lo que lo
-- tenía. Ahora, en un producto que ya existe, lo que la planilla no trae no
-- se toca: costo 0, stock mínimo 0, categoría vacía, descripción vacía y
-- "no perecible" dejan lo que había.
--
-- Cada fila va en su propio bloque: si una falla (un código que ya es de otro
-- producto) se informa y las demás siguen, como antes.
-- =============================================================================

create or replace function public.fn_importar_productos(p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant       uuid := current_tenant_id();
  v_fila         jsonb;
  v_i            integer := 0;
  v_cat          uuid;
  v_nombre_cat   text;
  v_sku          text;
  v_codigo       text;
  v_codigos      text[];
  v_previo       uuid;
  v_costo        integer;
  v_minimo       numeric;
  v_creados      integer := 0;
  v_actualizados integer := 0;
  v_errores      jsonb := '[]'::jsonb;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'bodega') then
    raise exception 'SIN_PERMISO_CREAR_PRODUCTO' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 500 then
    raise exception 'LOTE_INVALIDO' using errcode = 'P0001';
  end if;

  for v_fila in select value from jsonb_array_elements(p_filas) loop
    v_i := v_i + 1;
    begin
      v_sku    := nullif(trim(coalesce(v_fila->>'sku', '')), '');
      v_codigo := nullif(trim(coalesce(v_fila->>'codigo_barras', '')), '');
      v_costo  := nullif(coalesce((v_fila->>'costo')::integer, 0), 0);
      v_minimo := nullif(coalesce((v_fila->>'stock_minimo')::numeric, 0), 0);

      -- La categoría por nombre, sin importar mayúsculas; se crea si no está.
      v_cat := null;
      v_nombre_cat := nullif(trim(coalesce(v_fila->>'categoria', '')), '');
      if v_nombre_cat is not null then
        select id into v_cat from categories
         where tenant_id = v_tenant and lower(name) = lower(v_nombre_cat) limit 1;
        if v_cat is null then
          insert into categories (tenant_id, name) values (v_tenant, v_nombre_cat) returning id into v_cat;
        end if;
      end if;

      -- El mismo producto: primero por SKU, después por código de barras.
      v_previo := null;
      if v_sku is not null then
        select id into v_previo from products where tenant_id = v_tenant and sku = v_sku limit 1;
      end if;
      if v_previo is null and v_codigo is not null then
        select product_id into v_previo from product_barcodes
         where tenant_id = v_tenant and barcode = v_codigo limit 1;
      end if;

      if v_previo is not null then
        -- Con código en la fila, se suma a los que ya tenía (core/codigos.ts,
        -- codigosDesdeImportacion); sin código, los suyos no se tocan.
        v_codigos := null;
        if v_codigo is not null then
          select coalesce(array_agg(barcode order by is_primary desc, created_at), '{}') into v_codigos
            from product_barcodes where product_id = v_previo;
          if not (v_codigo = any(v_codigos)) then v_codigos := v_codigos || v_codigo; end if;
        end if;
        if v_cat is null then
          select category_id into v_cat from products where id = v_previo;
        end if;
        perform fn_update_product(
          v_previo,
          v_fila->>'nombre',
          coalesce(v_sku, (select sku from products where id = v_previo)),
          nullif(trim(coalesce(v_fila->>'descripcion', '')), ''),
          v_cat,
          coalesce(nullif(v_fila->>'unidad', ''), 'unidad'),
          (v_fila->>'precio_venta')::integer,
          v_costo,
          v_minimo,
          case when coalesce((v_fila->>'perecible')::boolean, false) then true else null end,
          case when coalesce((v_fila->>'perecible')::boolean, false) then (v_fila->>'dias_alerta')::integer else null end,
          v_codigos,
          null);
        v_actualizados := v_actualizados + 1;
      else
        perform fn_create_product(
          v_fila->>'nombre',
          v_sku,
          nullif(trim(coalesce(v_fila->>'descripcion', '')), ''),
          v_cat,
          coalesce(nullif(v_fila->>'unidad', ''), 'unidad'),
          (v_fila->>'precio_venta')::integer,
          coalesce(v_costo, 0),
          coalesce(v_minimo, 0),
          coalesce((v_fila->>'perecible')::boolean, false),
          coalesce((v_fila->>'dias_alerta')::integer, 30),
          case when v_codigo is null then '{}'::text[] else array[v_codigo] end,
          coalesce((v_fila->>'stock_inicial')::numeric, 0),
          0);
        v_creados := v_creados + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('indice', v_i, 'nombre', v_fila->>'nombre', 'codigo', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados, 'errores', v_errores);
end $$;

comment on function public.fn_importar_productos(jsonb) is
  'Carga masiva de productos en lotes (0038). En los que ya existen no pisa lo que la planilla no trae.';
revoke execute on function public.fn_importar_productos(jsonb) from public, anon;
grant  execute on function public.fn_importar_productos(jsonb) to authenticated;
