'use client';

import { validarTramos, type TramoPrecio } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db, getMeta, setMeta } from '../offline/db';
import { syncCatalog } from '../offline/catalog';
import { todasLasFilas } from '../supabase/todas';

/**
 * Ofertas por cantidad e impuestos adicionales (0018).
 *
 * Pedido del cliente, 2026-09-26: «ofertas, ejemplo 1 por $2.000 y si llevas 3
 * te llevas los 3 a $1.400 cada uno» y «poder modificar el impuesto adicional
 * y las tasas por producto o productos en general».
 *
 * En producción todo pasa por funciones de la base (`fn_guardar_impuesto`,
 * `fn_asignar_impuesto`, `fn_guardar_precios_producto`): las tablas no tienen
 * política de escritura (regla 14), y la base es la que valida que una
 * oferta sea más barata que el precio normal. En la maqueta vive en el
 * navegador, sobre el mismo catálogo que usa el POS.
 */

export interface ImpuestoAdicional {
  id: string;
  nombre: string;
  /** Código del impuesto en el documento tributario (27, 271, 24, 25, 26). */
  codigoSii: number | null;
  /** Porcentaje: 18 = 18 %. */
  tasa: number;
  activo: boolean;
  /** Cuántos productos lo tienen asignado. */
  productos: number;
}

export interface PreciosProducto {
  impuestoId: string | null;
  tramos: TramoPrecio[];
}

/** Lo que devuelve aplicar una oferta a muchos productos (0021). */
export interface ResultadoMasivo {
  aplicados: number;
  /** Los que se saltaron, con el código de por qué (OFERTA_NO_ES_MAS_BARATA…). */
  omitidos: { id: string; nombre: string; motivo: string }[];
}

export interface RepositorioPrecios {
  impuestos(): Promise<ImpuestoAdicional[]>;
  /** Crea (sin `id`) o cambia un impuesto. Devuelve su id. Solo administrador. */
  guardarImpuesto(i: { id?: string | null; nombre: string; codigoSii: number | null; tasa: number; activo: boolean }): Promise<string>;
  /** Pone el impuesto (o ninguno, con null) a todos esos productos. Devuelve cuántos cambiaron. */
  asignarImpuesto(productoIds: string[], impuestoId: string | null): Promise<number>;
  preciosDe(productoId: string): Promise<PreciosProducto>;
  /** Reemplaza las ofertas del producto. Un arreglo vacío las quita todas. */
  guardarTramos(productoId: string, tramos: TramoPrecio[]): Promise<void>;
  /** Qué impuesto tiene cada producto, para la pantalla de asignación masiva. */
  impuestoPorProducto(): Promise<Map<string, string | null>>;
  /**
   * La misma oferta a muchos productos (0021). Reemplaza en cada uno el tramo
   * con la misma cantidad y fechas; el resto de sus ofertas queda igual.
   */
  aplicarOfertaMasiva(productoIds: string[], tramo: TramoPrecio): Promise<ResultadoMasivo>;
  /** Quita todas las ofertas de esos productos. Devuelve a cuántos se les quitó. */
  quitarOfertas(productoIds: string[]): Promise<number>;
  /** Las ofertas de cada producto que tiene alguna, para la pantalla masiva. */
  tramosPorProducto(): Promise<Map<string, TramoPrecio[]>>;
}

const aFila = (t: TramoPrecio) => ({
  desde: t.desde,
  precio: t.descuentoPct != null ? null : t.precio ?? null,
  descuento_pct: t.descuentoPct ?? null,
  vigente_desde: t.vigenteDesde || null,
  vigente_hasta: t.vigenteHasta || null,
});

const deFila = (r: Record<string, unknown>): TramoPrecio => ({
  desde: Number(r.desde),
  precio: r.precio == null ? null : Number(r.precio),
  descuentoPct: r.descuento_pct == null ? null : Number(r.descuento_pct),
  vigenteDesde: (r.vigente_desde as string) ?? null,
  vigenteHasta: (r.vigente_hasta as string) ?? null,
});

const supabaseRepo: RepositorioPrecios = {
  async impuestos() {
    const [{ data, error }, prods] = await Promise.all([
      supabase().from('impuestos_adicionales').select('id, nombre, codigo_sii, tasa, is_active').order('tasa'),
      todasLasFilas((a, b) => supabase().from('products').select('impuesto_adicional_id')
        .not('impuesto_adicional_id', 'is', null).eq('is_active', true).order('id').range(a, b)),
    ]);
    if (error) throw error;
    const cuenta = new Map<string, number>();
    for (const p of prods) {
      const id = p.impuesto_adicional_id as string;
      cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
    }
    return (data ?? []).map((r) => ({
      id: r.id as string,
      nombre: r.nombre as string,
      codigoSii: (r.codigo_sii as number) ?? null,
      tasa: Number(r.tasa),
      activo: Boolean(r.is_active),
      productos: cuenta.get(r.id as string) ?? 0,
    }));
  },

  async guardarImpuesto(i) {
    const { data, error } = await supabase().rpc('fn_guardar_impuesto', {
      p_id: i.id ?? null, p_nombre: i.nombre, p_codigo_sii: i.codigoSii, p_tasa: i.tasa, p_activo: i.activo,
    });
    if (error) throw error;
    void syncCatalog().catch(() => {});
    return data as string;
  },

  async asignarImpuesto(productoIds, impuestoId) {
    const { data, error } = await supabase().rpc('fn_asignar_impuesto', {
      p_productos: productoIds, p_impuesto: impuestoId,
    });
    if (error) throw error;
    void syncCatalog().catch(() => {});
    return Number(data ?? 0);
  },

  async preciosDe(productoId) {
    const [{ data: p, error }, { data: t, error: e2 }] = await Promise.all([
      supabase().from('products').select('impuesto_adicional_id').eq('id', productoId).maybeSingle(),
      supabase().from('product_price_tiers').select('desde, precio, descuento_pct, vigente_desde, vigente_hasta')
        .eq('product_id', productoId).order('desde'),
    ]);
    if (error) throw error;
    if (e2) throw e2;
    return {
      impuestoId: (p?.impuesto_adicional_id as string) ?? null,
      tramos: (t ?? []).map(deFila),
    };
  },

  async guardarTramos(productoId, tramos) {
    const { error } = await supabase().rpc('fn_guardar_precios_producto', {
      p_product_id: productoId, p_tramos: tramos.map(aFila),
    });
    if (error) throw error;
    void syncCatalog().catch(() => {});
  },

  async impuestoPorProducto() {
    // Con más de 1.000 productos la API cortaba y los demás salían "sin impuesto".
    const data = await todasLasFilas((a, b) => supabase().from('products')
      .select('id, impuesto_adicional_id').order('id').range(a, b));
    return new Map(data.map((r) => [r.id as string, (r.impuesto_adicional_id as string) ?? null]));
  },

  async aplicarOfertaMasiva(productoIds, tramo) {
    const { data, error } = await supabase().rpc('fn_aplicar_oferta_masiva', {
      p_productos: productoIds, p_tramo: aFila(tramo),
    });
    if (error) throw error;
    void syncCatalog().catch(() => {});
    const r = data as { aplicados: number; omitidos: ResultadoMasivo['omitidos'] };
    return { aplicados: Number(r?.aplicados ?? 0), omitidos: r?.omitidos ?? [] };
  },

  async quitarOfertas(productoIds) {
    const { data, error } = await supabase().rpc('fn_quitar_ofertas', { p_productos: productoIds });
    if (error) throw error;
    void syncCatalog().catch(() => {});
    return Number(data ?? 0);
  },

  async tramosPorProducto() {
    const data = await todasLasFilas((a, b) => supabase().from('product_price_tiers')
      .select('product_id, desde, precio, descuento_pct, vigente_desde, vigente_hasta').order('product_id').order('desde').range(a, b));
    const mapa = new Map<string, TramoPrecio[]>();
    for (const r of data) {
      const id = r.product_id as string;
      mapa.set(id, [...(mapa.get(id) ?? []), deFila(r)]);
    }
    return mapa;
  },
};

// ---------------------------------------------------------------------------
// Maqueta: el catálogo del navegador y una lista de impuestos en `meta`
// ---------------------------------------------------------------------------
const CLAVE_IMPUESTOS = 'demo:impuestos';

async function impuestosDemo(): Promise<Omit<ImpuestoAdicional, 'productos'>[]> {
  const crudo = await getMeta(CLAVE_IMPUESTOS);
  return crudo ? JSON.parse(crudo) : [];
}

/** Lo que el POS lee de cada producto: se recalcula cada vez que algo cambia. */
async function refrescarCatalogoDemo() {
  const lista = await impuestosDemo();
  const porId = new Map(lista.filter((i) => i.activo).map((i) => [i.id, i]));
  const productos = await db().products.toArray();
  await db().products.bulkPut(productos.map((p) => {
    const imp = p.impuestoId ? porId.get(p.impuestoId) : undefined;
    return { ...p, tasaAdicional: imp?.tasa ?? 0, impuestoNombre: imp?.nombre ?? null };
  }));
  window.dispatchEvent(new Event('catalogo-actualizado'));
}

const demoRepo: RepositorioPrecios = {
  async impuestos() {
    const productos = await db().products.toArray();
    return (await impuestosDemo()).map((i) => ({
      ...i,
      productos: productos.filter((p) => p.isActive && p.impuestoId === i.id).length,
    }));
  },
  async guardarImpuesto(i) {
    const lista = await impuestosDemo();
    const id = i.id ?? crypto.randomUUID();
    const fila = { id, nombre: i.nombre.trim(), codigoSii: i.codigoSii, tasa: i.tasa, activo: i.activo };
    if (lista.some((x) => x.id !== id && x.nombre.toLowerCase() === fila.nombre.toLowerCase())) {
      throw new Error('IMPUESTO_DUPLICADO');
    }
    const siguiente = i.id ? lista.map((x) => (x.id === id ? fila : x)) : [...lista, fila];
    await setMeta(CLAVE_IMPUESTOS, JSON.stringify(siguiente));
    await refrescarCatalogoDemo();
    return id;
  },
  async asignarImpuesto(productoIds, impuestoId) {
    const productos = await db().products.bulkGet(productoIds);
    const cambian = productos.filter((p): p is NonNullable<typeof p> => !!p && (p.impuestoId ?? null) !== impuestoId);
    await db().products.bulkPut(cambian.map((p) => ({ ...p, impuestoId })));
    await refrescarCatalogoDemo();
    return cambian.length;
  },
  async preciosDe(productoId) {
    const p = await db().products.get(productoId);
    return { impuestoId: p?.impuestoId ?? null, tramos: p?.tramos ?? [] };
  },
  async guardarTramos(productoId, tramos) {
    const p = await db().products.get(productoId);
    if (!p) throw new Error('PRODUCTO_NO_ENCONTRADO');
    await db().products.put({ ...p, tramos });
    window.dispatchEvent(new Event('catalogo-actualizado'));
  },
  async impuestoPorProducto() {
    const productos = await db().products.toArray();
    return new Map(productos.map((p) => [p.id, p.impuestoId ?? null]));
  },
  // La misma regla que `fn_aplicar_oferta_masiva`, para que la maqueta enseñe
  // lo mismo que pasa en producción.
  async aplicarOfertaMasiva(productoIds, tramo) {
    const productos = (await db().products.bulkGet(productoIds)).filter((p): p is NonNullable<typeof p> => !!p);
    const omitidos: ResultadoMasivo['omitidos'] = [];
    const cambian = [];
    for (const p of productos) {
      if (!p.isActive) { omitidos.push({ id: p.id, nombre: p.name, motivo: 'PRODUCTO_INACTIVO' }); continue; }
      if (validarTramos([tramo], p.salePrice).length) {
        omitidos.push({ id: p.id, nombre: p.name, motivo: 'OFERTA_NO_ES_MAS_BARATA' });
        continue;
      }
      const mismo = (t: TramoPrecio) => t.desde === tramo.desde
        && (t.vigenteDesde ?? null) === (tramo.vigenteDesde ?? null)
        && (t.vigenteHasta ?? null) === (tramo.vigenteHasta ?? null);
      cambian.push({ ...p, tramos: [...(p.tramos ?? []).filter((t) => !mismo(t)), tramo] });
    }
    await db().products.bulkPut(cambian);
    window.dispatchEvent(new Event('catalogo-actualizado'));
    return { aplicados: cambian.length, omitidos };
  },
  async quitarOfertas(productoIds) {
    const productos = (await db().products.bulkGet(productoIds))
      .filter((p): p is NonNullable<typeof p> => !!p && (p.tramos?.length ?? 0) > 0);
    await db().products.bulkPut(productos.map((p) => ({ ...p, tramos: [] })));
    window.dispatchEvent(new Event('catalogo-actualizado'));
    return productos.length;
  },
  async tramosPorProducto() {
    const productos = await db().products.toArray();
    return new Map(productos.filter((p) => p.tramos?.length).map((p) => [p.id, p.tramos ?? []]));
  },
};

export function repoPrecios(): RepositorioPrecios {
  return DEMO_ACTIVO ? demoRepo : supabaseRepo;
}
