'use client';

import { normalizeBarcode, toUserMessage, type FilaProducto } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { db, normalizeSearch } from '../offline/db';
import type {
  FiltroProductos, Producto, ProductoEditable, ProductoNuevo,
  RepositorioProductos, ResultadoLote,
} from './tipos';
import { perfilActual } from '../supabase/perfil';

/**
 * Repositorio respaldado por Supabase. Es el que corre en producción.
 *
 * Nota sobre seguridad: cuando `verCostos` es falso se consulta la vista
 * `products_public`, que no expone la columna `avg_cost`. No se trata de
 * ocultar un dato en pantalla — el costo no viaja por la red hacia un
 * dispositivo que no debe tenerlo (docs/06-modelo-datos.md §6.2).
 */

interface FilaBD {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  category_id: string | null;
  unit: string;
  sale_price: number;
  avg_cost?: number;
  min_stock: number;
  tracks_expiry: boolean;
  expiry_alert_days: number;
  is_active: boolean;
  image_url?: string | null;
  updated_at: string;
  editor?: { full_name: string } | null;
  categories?: { name: string } | null;
  product_barcodes?: Array<{ barcode: string }>;
  stock_levels?: Array<{ quantity: number }>;
  stock_ubicaciones?: Array<{ ubicacion: 'sala' | 'bodega'; quantity: number }>;
}

const SELECT_BASE =
  'id, name, description, sku, category_id, unit, sale_price, min_stock, tracks_expiry, ' +
  'expiry_alert_days, is_active, image_url, updated_at, editor:profiles!products_updated_by_fkey(full_name), ' +
  'categories(name), product_barcodes(barcode), stock_levels(quantity), stock_ubicaciones(ubicacion, quantity)';

const SELECT_CON_COSTO = SELECT_BASE.replace('sale_price,', 'sale_price, avg_cost,');

function aProducto(f: FilaBD): Producto {
  return {
    id: f.id,
    nombre: f.name,
    descripcion: f.description ?? null,
    sku: f.sku,
    categoriaId: f.category_id,
    categoriaNombre: f.categories?.name ?? null,
    unidad: f.unit,
    precioVenta: Number(f.sale_price ?? 0),
    ...(typeof f.avg_cost === 'number' ? { costoPromedio: Number(f.avg_cost) } : {}),
    stockMinimo: Number(f.min_stock ?? 0),
    perecible: Boolean(f.tracks_expiry),
    diasAlerta: Number(f.expiry_alert_days ?? 30),
    activo: Boolean(f.is_active),
    codigos: (f.product_barcodes ?? []).map((b) => b.barcode),
    stock: Number(f.stock_levels?.[0]?.quantity ?? 0),
    stockSala: Number(f.stock_ubicaciones?.find((u) => u.ubicacion === 'sala')?.quantity ?? 0),
    stockBodega: Number(f.stock_ubicaciones?.find((u) => u.ubicacion === 'bodega')?.quantity ?? 0),
    actualizadoEn: f.updated_at,
    actualizadoPor: f.editor?.full_name || null,
    imagen: f.image_url ?? null,
  };
}

async function tenantYTienda() {
  const { tenantId, storeId } = await perfilActual();
  return { tenantId, storeId };
}

export const repoSupabase: RepositorioProductos = {
  async listar(filtro: FiltroProductos, verCostos) {
    const client = supabase();
    const tabla = verCostos ? 'products' : 'products_public';
    let q = client.from(tabla).select(verCostos ? SELECT_CON_COSTO : SELECT_BASE);

    if (filtro.soloActivos !== false) q = q.eq('is_active', true);
    if (filtro.categoriaId) q = q.eq('category_id', filtro.categoriaId);
    // RF-M2-05: por nombre, SKU o código de barras. Hasta el 2026-09-27 el
    // campo decía "Buscar por nombre o SKU" y filtraba solo por nombre: un
    // SKU o un código escaneado no encontraban nada.
    if (filtro.busqueda?.trim()) {
      // Las comas y paréntesis separan condiciones en el filtro `or` de la API.
      const texto = filtro.busqueda.trim().replace(/[,()]/g, ' ');
      const { data: porCodigo } = await client.from('product_barcodes')
        .select('product_id').eq('barcode', normalizeBarcode(texto));
      const ids = (porCodigo ?? []).map((c) => c.product_id as string);
      // RF-M2-20 · "azucar" no encontraba "Azúcar": `ilike` distingue tildes.
      // El catálogo del celular ya guarda el nombre normalizado (el mismo que
      // usa el POS): de ahí salen los que coinciden sin tildes.
      try {
        const q = normalizeSearch(filtro.busqueda);
        if (q.length >= 2) {
          const locales = await db().products.filter((p) => p.nameSearch.includes(q)).limit(100).toArray();
          for (const p of locales) if (!ids.includes(p.id)) ids.push(p.id);
        }
      } catch { /* sin catálogo local, queda la búsqueda de la base */ }
      q = q.or([
        `name.ilike.%${texto}%`,
        `sku.ilike.%${texto}%`,
        ...(ids.length ? [`id.in.(${ids.join(',')})`] : []),
      ].join(','));
    }

    // 2026-10-07 · Sin tope: antes traía 200 y la pantalla decía "200
    // productos" con 761 en la base, cortando la lista en la D. Supabase
    // entrega hasta 1.000 filas por consulta, así que se pide por páginas.
    const PAGINA = 1000;
    const filas: unknown[] = [];
    for (let desde = 0; ; desde += PAGINA) {
      const hasta = Math.min(desde + PAGINA, filtro.limite ?? Infinity) - 1;
      const { data, error } = await q.order('name').order('id').range(desde, hasta);
      if (error) throw error;
      filas.push(...(data ?? []));
      if (!data || data.length < hasta - desde + 1 || filas.length >= (filtro.limite ?? Infinity)) break;
    }

    let productos = filas.map((f) => aProducto(f as unknown as FilaBD));

    // El filtro por estado se aplica en el cliente: depende del stock, que
    // viene de una tabla relacionada y no se puede filtrar en la consulta.
    if (filtro.estado && filtro.estado !== 'todos') {
      productos = productos.filter((p) => {
        if (filtro.estado === 'agotado') return p.stock <= 0;
        if (filtro.estado === 'bajo') return p.stock > 0 && p.stockMinimo > 0 && p.stock <= p.stockMinimo;
        return p.stock > 0 && (p.stockMinimo === 0 || p.stock > p.stockMinimo);
      });
    }
    return productos;
  },

  async obtener(id, verCostos) {
    const client = supabase();
    const tabla = verCostos ? 'products' : 'products_public';
    const { data, error } = await client
      .from(tabla)
      .select(verCostos ? SELECT_CON_COSTO : SELECT_BASE)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? aProducto(data as unknown as FilaBD) : null;
  },

  /**
   * Alta de producto en una sola transacción.
   *
   * Antes eran tres llamadas encadenadas —producto, códigos de barra, stock
   * inicial— sin transacción. Si fallaba la segunda, el producto quedaba
   * creado sin códigos, el usuario veía un error y al reintentar creaba un
   * duplicado: dos filas del mismo artículo, y la que no tiene códigos es
   * justo la que nunca aparecerá al escanear. Ver docs/21, hallazgo A-4.
   */
  async crear(datos: ProductoNuevo) {
    const { data, error } = await supabase().rpc('fn_create_product', {
      p_name: datos.nombre,
      p_sku: datos.sku,
      p_description: datos.descripcion,
      p_category_id: datos.categoriaId,
      p_unit: datos.unidad,
      p_sale_price: datos.precioVenta,
      p_avg_cost: datos.costo,
      p_min_stock: datos.stockMinimo,
      p_tracks_expiry: datos.perecible,
      p_expiry_alert_days: datos.diasAlerta,
      p_barcodes: datos.codigos.filter(Boolean),
      p_initial_stock: datos.stockInicialBodega,
      p_initial_stock_sala: datos.stockInicialSala,
      // Solo si viene: sin fecha, la base hace lo de antes (0024).
      ...(datos.perecible && datos.vencimientoInicial ? { p_initial_expiry: datos.vencimientoInicial } : {}),
    });
    if (error) throw error;
    return { id: (data as { product_id: string }).product_id };
  },

  /**
   * Edición de producto en una sola transacción.
   *
   * Antes eran dos llamadas: un `update` al producto y, aparte, un `delete`
   * de todos sus códigos de barra seguido de un `insert`. Si la inserción
   * fallaba —código recién tomado por otro, conexión caída en el mostrador,
   * token vencido entre una llamada y la otra— el producto quedaba sin ningún
   * código. En la pantalla de productos no se nota: el artículo sigue ahí con
   * su nombre y su precio. Se nota en la caja, cuando el lector pita y no pasa
   * nada. Ver docs/22, T-02.
   */
  async actualizar(id, datos: ProductoEditable) {
    const { error } = await supabase().rpc('fn_update_product', {
      p_product_id: id,
      p_name: datos.nombre,
      p_sku: datos.sku,
      p_description: datos.descripcion,
      p_category_id: datos.categoriaId,
      p_unit: datos.unidad,
      p_sale_price: datos.precioVenta,
      // Nulo, no 0: nulo le dice a la función que deje el costo como estaba.
      p_avg_cost: typeof datos.costo === 'number' ? datos.costo : null,
      p_min_stock: datos.stockMinimo,
      p_tracks_expiry: datos.perecible,
      p_expiry_alert_days: datos.diasAlerta,
      // Lo mismo con los códigos: nulo = no tocarlos.
      p_barcodes: datos.codigos ? datos.codigos.filter(Boolean) : null,
      // 0020 · el string tal cual vino de la base, sin pasar por Date.
      p_expected_updated_at: datos.esperadoEn ?? null,
    });
    if (error) throw error;
  },

  // Con `select`, para saber si de verdad cambió: si RLS no deja, el update
  // no da error, simplemente no toca ninguna fila, y la pantalla decía que sí.
  async desactivar(id) {
    const { data, error } = await supabase().from('products').update({ is_active: false }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('SIN_PERMISO');
  },

  async reactivar(id) {
    const { data, error } = await supabase().from('products').update({ is_active: true }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('SIN_PERMISO');
  },

  async tieneMovimientos(id) {
    const { count, error } = await supabase()
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id);
    if (error) throw error;
    return (count ?? 0) > 0;
  },

  async eliminar(id) {
    // Regla del proyecto: nada que tenga historial se borra (doc 06, §1.3).
    // Un producto sin movimientos es un error de carga, no un hecho del
    // negocio, y ese sí se puede eliminar.
    if (await this.tieneMovimientos(id)) throw new Error('TIENE_MOVIMIENTOS');
    await supabase().from('product_barcodes').delete().eq('product_id', id);
    const { error } = await supabase().from('products').delete().eq('id', id);
    if (error) throw error;
  },

  async categorias() {
    const { data, error } = await supabase()
      .from('categories')
      .select('id, name')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map((c) => ({ id: c.id as string, nombre: c.name as string }));
  },

  async crearCategoria(nombre) {
    const { tenantId } = await tenantYTienda();
    const { data, error } = await supabase()
      .from('categories')
      .insert({ tenant_id: tenantId, name: nombre })
      .select('id, name')
      .single();
    if (error) throw error;
    return { id: data.id as string, nombre: data.name as string };
  },

  async historialPrecios(id) {
    const { data, error } = await supabase().from('price_history')
      .select('old_price, new_price, changed_at, quien:profiles!price_history_changed_by_fkey(full_name)')
      .eq('product_id', id).order('changed_at', { ascending: false }).limit(10);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      anterior: Number(r.old_price), nuevo: Number(r.new_price), fecha: r.changed_at as string,
      quien: ((r.quien as unknown as { full_name?: string } | null)?.full_name) || null,
    }));
  },

  async codigoEnUso(codigo, excluirProductoId) {
    const { data, error } = await supabase()
      .from('product_barcodes')
      .select('product_id, products(name)')
      .eq('barcode', codigo)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.product_id === excluirProductoId) return null;
    return (data.products as unknown as { name: string } | null)?.name ?? 'otro producto';
  },

  /**
   * Carga masiva en lotes de 100, cada uno en una sola llamada a la base
   * (0038, fn_importar_productos). Antes era producto por producto desde el
   * navegador: 714 productos tardaban más de diez minutos y cerrar la pestaña
   * los dejaba a medias. Y al actualizar uno que ya existía le pisaba el
   * costo, la categoría y el perecible con lo que la planilla no traía: la
   * función de la base ya no lo hace.
   */
  async importarLote(
    filas: FilaProducto[],
    onProgreso?: (hechas: number, total: number) => void,
  ): Promise<ResultadoLote> {
    const resultado: ResultadoLote = { creados: 0, actualizados: 0, errores: [] };
    const LOTE = 100;
    for (let desde = 0; desde < filas.length; desde += LOTE) {
      const lote = filas.slice(desde, desde + LOTE);
      const { data, error } = await supabase().rpc('fn_importar_productos', { p_filas: lote });
      if (error) throw error;
      const r = data as { creados: number; actualizados: number; errores: Array<{ indice: number; nombre: string; codigo: string }> };
      resultado.creados += r.creados;
      resultado.actualizados += r.actualizados;
      for (const e of r.errores) {
        // `toUserMessage` y no el texto de Postgres: el almacenero que sube su
        // planilla no tiene por qué leer "duplicate key value…".
        resultado.errores.push({ fila: desde + e.indice + 1, nombre: e.nombre, mensaje: toUserMessage(new Error(e.codigo)) });
      }
      onProgreso?.(Math.min(desde + LOTE, filas.length), filas.length);
    }
    return resultado;
  },
};
