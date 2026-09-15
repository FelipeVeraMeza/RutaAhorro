'use client';

import type { FilaProducto } from '@rutaahorro/core';
import { db, normalizeSearch, type LocalProduct } from '../offline/db';
import { DEMO_PRODUCTOS } from '../demo/data';
import type {
  Categoria, Producto, ProductoEditable, ProductoNuevo,
  RepositorioProductos, ResultadoLote,
} from './tipos';

/**
 * Repositorio respaldado por IndexedDB (modo demo).
 *
 * No es una simulación con datos fijos: es un almacén real y mutable. Lo que
 * se crea, edita, elimina o importa **persiste** entre recargas, igual que
 * contra Supabase. La única diferencia es dónde vive el dato.
 *
 * Esto permite probar los flujos completos de alta, baja y carga masiva antes
 * de aplicar el esquema en Supabase.
 */

const KEY_CATEGORIAS = 'demo:categorias';
const KEY_SEMBRADO = 'demo:sembrado';

function nuevoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
}

async function leerCategorias(): Promise<Categoria[]> {
  const raw = await db().meta.get(KEY_CATEGORIAS);
  if (raw?.value) return JSON.parse(raw.value) as Categoria[];

  const base = [...new Set(DEMO_PRODUCTOS.map((p) => p.categoria))].map((n) => ({
    id: normalizeSearch(n).replace(/\s+/g, '-'),
    nombre: n,
  }));
  await db().meta.put({ key: KEY_CATEGORIAS, value: JSON.stringify(base) });
  return base;
}

async function guardarCategorias(cats: Categoria[]) {
  await db().meta.put({ key: KEY_CATEGORIAS, value: JSON.stringify(cats) });
}

/** Siembra el catálogo de ejemplo la primera vez, y solo la primera vez. */
async function asegurarSembrado() {
  const marca = await db().meta.get(KEY_SEMBRADO);
  if (marca?.value === 'si') return;

  const productos: LocalProduct[] = DEMO_PRODUCTOS.map((p) => ({
    id: p.id,
    name: p.name,
    nameSearch: normalizeSearch(p.name),
    sku: p.sku,
    salePrice: p.sale_price,
    unit: p.unit,
    categoryId: normalizeSearch(p.categoria).replace(/\s+/g, '-'),
    tracksExpiry: p.tracks_expiry,
    stock: p.stock,
    minStock: p.min_stock,
    isActive: true,
    updatedAt: new Date().toISOString(),
  }));

  await db().transaction('rw', db().products, db().barcodes, db().meta, async () => {
    await db().products.bulkPut(productos);
    await db().barcodes.bulkPut(
      DEMO_PRODUCTOS.map((p) => ({ barcode: p.barcode, productId: p.id })),
    );
    // El costo no vive en LocalProduct (el dispositivo de un vendedor no debe
    // tenerlo). En demo se guarda aparte para poder mostrarlo al admin.
    await db().meta.put({
      key: 'demo:costos',
      value: JSON.stringify(Object.fromEntries(DEMO_PRODUCTOS.map((p) => [p.id, p.avg_cost]))),
    });
    await db().meta.put({ key: KEY_SEMBRADO, value: 'si' });
  });
  await leerCategorias();
}

async function leerCostos(): Promise<Record<string, number>> {
  const raw = await db().meta.get('demo:costos');
  return raw?.value ? (JSON.parse(raw.value) as Record<string, number>) : {};
}

async function guardarCosto(id: string, costo: number) {
  const costos = await leerCostos();
  costos[id] = costo;
  await db().meta.put({ key: 'demo:costos', value: JSON.stringify(costos) });
}

async function aProducto(p: LocalProduct, verCostos: boolean, cats: Categoria[], costos: Record<string, number>): Promise<Producto> {
  const codigos = (await db().barcodes.where('productId').equals(p.id).toArray()).map((b) => b.barcode);
  return {
    id: p.id,
    nombre: p.name,
    sku: p.sku,
    categoriaId: p.categoryId,
    categoriaNombre: cats.find((c) => c.id === p.categoryId)?.nombre ?? null,
    unidad: p.unit,
    precioVenta: p.salePrice,
    ...(verCostos ? { costoPromedio: costos[p.id] ?? 0 } : {}),
    stockMinimo: p.minStock,
    perecible: p.tracksExpiry,
    diasAlerta: 30,
    activo: p.isActive,
    codigos,
    stock: p.stock,
    actualizadoEn: p.updatedAt,
  };
}

export const repoLocal: RepositorioProductos = {
  async listar(filtro, verCostos) {
    await asegurarSembrado();
    const [cats, costos] = await Promise.all([leerCategorias(), leerCostos()]);
    let todos = await db().products.toArray();

    if (filtro.soloActivos !== false) todos = todos.filter((p) => p.isActive);
    if (filtro.categoriaId) todos = todos.filter((p) => p.categoryId === filtro.categoriaId);

    if (filtro.busqueda?.trim()) {
      const q = normalizeSearch(filtro.busqueda);
      todos = todos.filter(
        (p) => p.nameSearch.includes(q) || (p.sku && normalizeSearch(p.sku).includes(q)),
      );
    }

    if (filtro.estado && filtro.estado !== 'todos') {
      todos = todos.filter((p) => {
        if (filtro.estado === 'agotado') return p.stock <= 0;
        if (filtro.estado === 'bajo') return p.stock > 0 && p.minStock > 0 && p.stock <= p.minStock;
        return p.stock > 0 && (p.minStock === 0 || p.stock > p.minStock);
      });
    }

    todos.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const pagina = todos.slice(0, filtro.limite ?? 200);
    return Promise.all(pagina.map((p) => aProducto(p, verCostos, cats, costos)));
  },

  async obtener(id, verCostos) {
    await asegurarSembrado();
    const p = await db().products.get(id);
    if (!p) return null;
    const [cats, costos] = await Promise.all([leerCategorias(), leerCostos()]);
    return aProducto(p, verCostos, cats, costos);
  },

  async crear(datos: ProductoNuevo) {
    const id = nuevoId();
    await db().products.put({
      id,
      name: datos.nombre,
      nameSearch: normalizeSearch(datos.nombre),
      sku: datos.sku,
      salePrice: datos.precioVenta,
      unit: datos.unidad,
      categoryId: datos.categoriaId,
      tracksExpiry: datos.perecible,
      stock: datos.stockInicial,
      minStock: datos.stockMinimo,
      isActive: true,
      updatedAt: new Date().toISOString(),
    });
    await guardarCosto(id, datos.costo);
    for (const c of datos.codigos.filter(Boolean)) {
      await db().barcodes.put({ barcode: c, productId: id });
    }
    return { id };
  },

  async actualizar(id, datos: ProductoEditable) {
    const actual = await db().products.get(id);
    if (!actual) throw new Error('NO_ENCONTRADO');

    await db().products.put({
      ...actual,
      name: datos.nombre,
      nameSearch: normalizeSearch(datos.nombre),
      sku: datos.sku,
      salePrice: datos.precioVenta,
      unit: datos.unidad,
      categoryId: datos.categoriaId,
      tracksExpiry: datos.perecible,
      minStock: datos.stockMinimo,
      updatedAt: new Date().toISOString(),
    });
    if (typeof datos.costo === 'number') await guardarCosto(id, datos.costo);

    await db().barcodes.where('productId').equals(id).delete();
    for (const c of datos.codigos.filter(Boolean)) {
      await db().barcodes.put({ barcode: c, productId: id });
    }
  },

  async desactivar(id) {
    const p = await db().products.get(id);
    if (!p) throw new Error('NO_ENCONTRADO');
    await db().products.put({ ...p, isActive: false, updatedAt: new Date().toISOString() });
  },

  async reactivar(id) {
    const p = await db().products.get(id);
    if (!p) throw new Error('NO_ENCONTRADO');
    await db().products.put({ ...p, isActive: true, updatedAt: new Date().toISOString() });
  },

  async tieneMovimientos(id) {
    // En demo se considera que los productos sembrados tienen historial
    // (vienen con stock inicial), y los creados a mano no.
    return DEMO_PRODUCTOS.some((p) => p.id === id);
  },

  async eliminar(id) {
    if (await this.tieneMovimientos(id)) throw new Error('TIENE_MOVIMIENTOS');
    await db().barcodes.where('productId').equals(id).delete();
    await db().products.delete(id);
  },

  async categorias() {
    await asegurarSembrado();
    return leerCategorias();
  },

  async crearCategoria(nombre) {
    const cats = await leerCategorias();
    const existente = cats.find((c) => normalizeSearch(c.nombre) === normalizeSearch(nombre));
    if (existente) return existente;
    const nueva = { id: normalizeSearch(nombre).replace(/\s+/g, '-'), nombre };
    await guardarCategorias([...cats, nueva]);
    return nueva;
  },

  async codigoEnUso(codigo, excluirProductoId) {
    const hit = await db().barcodes.get(codigo);
    if (!hit || hit.productId === excluirProductoId) return null;
    const p = await db().products.get(hit.productId);
    return p?.name ?? 'otro producto';
  },

  async importarLote(filas: FilaProducto[]): Promise<ResultadoLote> {
    const resultado: ResultadoLote = { creados: 0, actualizados: 0, errores: [] };
    const cats = await leerCategorias();

    for (const [i, fila] of filas.entries()) {
      try {
        let categoriaId: string | null = null;
        if (fila.categoria) {
          const cat = cats.find((c) => normalizeSearch(c.nombre) === normalizeSearch(fila.categoria!))
            ?? (await this.crearCategoria(fila.categoria));
          if (!cats.some((c) => c.id === cat.id)) cats.push(cat);
          categoriaId = cat.id;
        }

        // Si el SKU ya existe, se actualiza en vez de duplicar.
        const existente = fila.sku
          ? (await db().products.toArray()).find(
              (p) => p.sku && normalizeSearch(p.sku) === normalizeSearch(fila.sku!),
            )
          : undefined;

        if (existente) {
          await this.actualizar(existente.id, {
            nombre: fila.nombre,
            sku: fila.sku,
            categoriaId,
            unidad: fila.unidad,
            precioVenta: fila.precio_venta,
            costo: fila.costo,
            stockMinimo: fila.stock_minimo,
            perecible: fila.perecible,
            diasAlerta: fila.dias_alerta,
            codigos: fila.codigo_barras ? [fila.codigo_barras] : [],
          });
          resultado.actualizados++;
        } else {
          await this.crear({
            nombre: fila.nombre,
            sku: fila.sku,
            categoriaId,
            unidad: fila.unidad,
            precioVenta: fila.precio_venta,
            costo: fila.costo,
            stockMinimo: fila.stock_minimo,
            perecible: fila.perecible,
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
