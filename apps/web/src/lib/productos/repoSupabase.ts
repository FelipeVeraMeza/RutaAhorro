'use client';

import type { FilaProducto } from '@rutaahorro/core';
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
  'id, name, sku, category_id, unit, sale_price, min_stock, tracks_expiry, ' +
  'expiry_alert_days, is_active, updated_at, ' +
  'categories(name), product_barcodes(barcode), stock_levels(quantity)';

const SELECT_CON_COSTO = SELECT_BASE.replace('sale_price,', 'sale_price, avg_cost,');

function aProducto(f: FilaBD): Producto {
  return {
    id: f.id,
    nombre: f.name,
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

  async actualizar(id, datos: ProductoEditable) {
    const client = supabase();
    const { tenantId } = await tenantYTienda();

    const cambios: Record<string, unknown> = {
      name: datos.nombre,
      sku: datos.sku,
      category_id: datos.categoriaId,
      unit: datos.unidad,
      sale_price: datos.precioVenta,
      min_stock: datos.stockMinimo,
      tracks_expiry: datos.perecible,
      expiry_alert_days: datos.diasAlerta,
    };
    // avg_cost lo mantiene fn_confirm_receipt: no se toca desde aquí salvo
    // que el rol tenga permiso y lo envíe explícitamente.
    if (typeof datos.costo === 'number') cambios.avg_cost = datos.costo;

    const { error } = await client.from('products').update(cambios).eq('id', id);
    if (error) throw error;

    await client.from('product_barcodes').delete().eq('product_id', id);
    if (datos.codigos.filter(Boolean).length > 0) {
      const { error: e } = await client.from('product_barcodes').insert(
        datos.codigos.filter(Boolean).map((barcode, i) => ({
          tenant_id: tenantId, product_id: id, barcode, is_primary: i === 0,
        })),
      );
      if (e) throw e;
    }
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

  async importarLote(filas: FilaProducto[]): Promise<ResultadoLote> {
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
          ? await supabase().from('products').select('id').eq('sku', fila.sku).maybeSingle()
          : { data: null };

        if (previo) {
          await this.actualizar(previo.id as string, {
            nombre: fila.nombre, sku: fila.sku, categoriaId, unidad: fila.unidad,
            precioVenta: fila.precio_venta, costo: fila.costo,
            stockMinimo: fila.stock_minimo, perecible: fila.perecible,
            diasAlerta: fila.dias_alerta,
            codigos: fila.codigo_barras ? [fila.codigo_barras] : [],
          });
          resultado.actualizados++;
        } else {
          await this.crear({
            nombre: fila.nombre, sku: fila.sku, categoriaId, unidad: fila.unidad,
            precioVenta: fila.precio_venta, costo: fila.costo,
            stockMinimo: fila.stock_minimo, perecible: fila.perecible,
            diasAlerta: fila.dias_alerta,
            codigos: fila.codigo_barras ? [fila.codigo_barras] : [],
            stockInicial: fila.stock_inicial,
          });
          resultado.creados++;
        }
      } catch (e) {
        resultado.errores.push({
          fila: i + 2,
          nombre: fila.nombre,
          mensaje: e instanceof Error ? e.message : 'Error desconocido',
        });
      }
    }
    return resultado;
  },
};
