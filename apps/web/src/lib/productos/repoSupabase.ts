'use client';

import { codigosDesdeImportacion, toUserMessage, type FilaProducto } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import type {
  FiltroProductos, Producto, ProductoEditable, ProductoNuevo,
  RepositorioProductos, ResultadoLote,
} from './tipos';

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
  updated_at: string;
  categories?: { name: string } | null;
  product_barcodes?: Array<{ barcode: string }>;
  stock_levels?: Array<{ quantity: number }>;
}

const SELECT_BASE =
  'id, name, description, sku, category_id, unit, sale_price, min_stock, tracks_expiry, ' +
  'expiry_alert_days, is_active, updated_at, ' +
  'categories(name), product_barcodes(barcode), stock_levels(quantity)';

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
    actualizadoEn: f.updated_at,
  };
}

async function tenantYTienda() {
  const client = supabase();
  const { data: { user } } = await client.auth.getUser();
  const { data } = await client
    .from('profiles')
    .select('tenant_id, store_id')
    .eq('id', user!.id)
    .single();
  return { tenantId: data!.tenant_id as string, storeId: data!.store_id as string | null };
}

export const repoSupabase: RepositorioProductos = {
  async listar(filtro: FiltroProductos, verCostos) {
    const client = supabase();
    const tabla = verCostos ? 'products' : 'products_public';
    let q = client.from(tabla).select(verCostos ? SELECT_CON_COSTO : SELECT_BASE);

    if (filtro.soloActivos !== false) q = q.eq('is_active', true);
    if (filtro.categoriaId) q = q.eq('category_id', filtro.categoriaId);
    if (filtro.busqueda?.trim()) q = q.ilike('name', `%${filtro.busqueda.trim()}%`);

    const { data, error } = await q.order('name').limit(filtro.limite ?? 200);
    if (error) throw error;

    let productos = (data ?? []).map((f) => aProducto(f as unknown as FilaBD));

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
      p_initial_stock: datos.stockInicial,
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
    });
    if (error) throw error;
  },

  async desactivar(id) {
    const { error } = await supabase().from('products').update({ is_active: false }).eq('id', id);
    if (error) throw error;
  },

  async reactivar(id) {
    const { error } = await supabase().from('products').update({ is_active: true }).eq('id', id);
    if (error) throw error;
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

  async importarLote(
    filas: FilaProducto[],
    onProgreso?: (hechas: number, total: number) => void,
  ): Promise<ResultadoLote> {
    const resultado: ResultadoLote = { creados: 0, actualizados: 0, errores: [] };
    const cats = await this.categorias();

    for (const [i, fila] of filas.entries()) {
      try {
        let categoriaId: string | null = null;
        if (fila.categoria) {
          const existente = cats.find(
            (c) => c.nombre.toLowerCase() === fila.categoria!.toLowerCase(),
          );
          const cat = existente ?? (await this.crearCategoria(fila.categoria));
          if (!existente) cats.push(cat);
          categoriaId = cat.id;
        }

        const { data: previo } = fila.sku
          ? await supabase()
              .from('products')
              .select('id, product_barcodes(barcode)')
              .eq('sku', fila.sku)
              .maybeSingle()
          : { data: null };

        if (previo) {
          // Una planilla que actualiza precios no trae columna de código de
          // barra, y antes eso se traducía en "el producto queda sin códigos":
          // la planilla del proveedor dejaba el catálogo invisible al escáner.
          // Sin código en la fila no se toca nada; con código, se suma a los
          // que ya tenía en vez de reemplazarlos.
          const previos = ((previo.product_barcodes ?? []) as Array<{ barcode: string }>)
            .map((b) => b.barcode);
          const codigos = codigosDesdeImportacion(previos, fila.codigo_barras);

          await this.actualizar(previo.id as string, {
            nombre: fila.nombre, descripcion: fila.descripcion,
            sku: fila.sku, categoriaId, unidad: fila.unidad,
            precioVenta: fila.precio_venta, costo: fila.costo,
            stockMinimo: fila.stock_minimo, perecible: fila.perecible,
            diasAlerta: fila.dias_alerta,
            ...(codigos ? { codigos } : {}),
          });
          resultado.actualizados++;
        } else {
          await this.crear({
            nombre: fila.nombre, descripcion: fila.descripcion,
            sku: fila.sku, categoriaId, unidad: fila.unidad,
            precioVenta: fila.precio_venta, costo: fila.costo,
            stockMinimo: fila.stock_minimo, perecible: fila.perecible,
            diasAlerta: fila.dias_alerta,
            codigos: fila.codigo_barras ? [fila.codigo_barras] : [],
            stockInicial: fila.stock_inicial,
          });
          resultado.creados++;
        }
      } catch (e) {
        // `toUserMessage` y no `e.message`: lo que sale de Postgres es
        // "duplicate key value violates unique constraint …", y el almacenero
        // que sube su planilla no tiene por qué leer eso.
        resultado.errores.push({
          fila: i + 2,
          nombre: fila.nombre,
          mensaje: toUserMessage(e),
        });
      }
      onProgreso?.(i + 1, filas.length);
    }
    return resultado;
  },
};
