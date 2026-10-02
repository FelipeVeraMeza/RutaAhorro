'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db, getMeta, setMeta } from '../offline/db';
import { syncCatalog } from '../offline/catalog';
import { registrarMov } from './inventario';

/**
 * Devolución a proveedor (RQ-35, 0035).
 *
 * Lo que se le devuelve al proveedor sale de la bodega por el kardex, al costo
 * promedio, con el lote que se elija o el que vence primero. En producción lo
 * hace `fn_devolver_a_proveedor` en una transacción: no queda stock rebajado
 * sin devolución registrada.
 */
export interface ItemDevolucion {
  productId: string;
  nombre: string;
  cantidad: number;
  /** Solo perecibles. Vacío: el que vence primero. */
  loteId?: string | null;
}

export interface DevolucionProveedor {
  id: string;
  proveedor: string;
  documento: string | null;
  motivo: string;
  totalCosto: number;
  fecha: string;
  productos: number;
}

export interface NuevaDevolucion {
  proveedorId: string;
  documento: string | null;
  motivo: string;
  items: ItemDevolucion[];
}

interface Repositorio {
  devolver(d: NuevaDevolucion): Promise<{ id: string; totalCosto: number }>;
  listar(limite?: number): Promise<DevolucionProveedor[]>;
}

const supabaseRepo: Repositorio = {
  async devolver(d) {
    const { data, error } = await supabase().rpc('fn_devolver_a_proveedor', {
      p_supplier_id: d.proveedorId,
      p_items: d.items.map((i) => ({ product_id: i.productId, quantity: i.cantidad, lot_id: i.loteId || null })),
      p_motivo: d.motivo,
      p_documento: d.documento,
    });
    if (error) throw error;
    // El celular vende con el stock de su catálogo: que no siga ofreciendo lo devuelto.
    void syncCatalog().catch(() => {});
    const r = data as { id: string; total_costo: number };
    return { id: r.id, totalCosto: r.total_costo };
  },
  async listar(limite = 20) {
    const { data, error } = await supabase().from('devoluciones_proveedor')
      .select('id, documento, motivo, total_costo, created_at, suppliers(name), devolucion_proveedor_items(count)')
      .order('created_at', { ascending: false }).limit(limite);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string,
      proveedor: (r.suppliers as unknown as { name: string } | null)?.name ?? '—',
      documento: (r.documento as string) ?? null,
      motivo: r.motivo as string,
      totalCosto: Number(r.total_costo),
      fecha: r.created_at as string,
      productos: Number((r.devolucion_proveedor_items as unknown as Array<{ count: number }>)?.[0]?.count ?? 0),
    }));
  },
};

// --------------------------------------------------------------- maqueta
const CLAVE = 'demo:devoluciones-proveedor';

const demoRepo: Repositorio = {
  async devolver(d) {
    if (!d.motivo.trim()) throw new Error('MOTIVO_REQUERIDO');
    if (!d.proveedorId) throw new Error('PROVEEDOR_REQUERIDO');
    if (d.items.length === 0) throw new Error('DEVOLUCION_SIN_PRODUCTOS');
    const costos = JSON.parse((await getMeta('demo:costos')) ?? '{}') as Record<string, number>;
    // Las mismas reglas que la base: todo se revisa antes de mover nada.
    const productos = await Promise.all(d.items.map((i) => db().products.get(i.productId)));
    d.items.forEach((i, n) => {
      const p = productos[n];
      if (!p) throw new Error('PRODUCTO_NO_ENCONTRADO');
      if (!Number.isInteger(i.cantidad) || i.cantidad <= 0) throw new Error('CANTIDAD_ENTERA');
      if (p.stock < i.cantidad) throw new Error(`STOCK_INSUFICIENTE: ${p.name}`);
    });
    let total = 0;
    for (const [n, i] of d.items.entries()) {
      const p = productos[n]!;
      const saldo = p.stock - i.cantidad;
      await db().products.put({ ...p, stock: saldo, updatedAt: new Date().toISOString() });
      await registrarMov({
        productoId: p.id, productoNombre: p.name, tipo: 'devolucion_proveedor',
        cantidad: -i.cantidad, saldo, motivo: d.motivo, usuario: 'Modo demo',
      });
      total += Math.round(i.cantidad * (costos[p.id] ?? 0));
    }
    const { repoProveedores } = await import('./proveedores');
    const prov = (await repoProveedores().listar(true)).find((x) => x.id === d.proveedorId);
    const lista = JSON.parse((await getMeta(CLAVE)) ?? '[]') as DevolucionProveedor[];
    const id = crypto.randomUUID();
    lista.unshift({
      id, proveedor: prov?.nombre ?? 'Proveedor', documento: d.documento, motivo: d.motivo,
      totalCosto: total, fecha: new Date().toISOString(), productos: d.items.length,
    });
    await setMeta(CLAVE, JSON.stringify(lista.slice(0, 100)));
    return { id, totalCosto: total };
  },
  async listar(limite = 20) {
    return (JSON.parse((await getMeta(CLAVE)) ?? '[]') as DevolucionProveedor[]).slice(0, limite);
  },
};

export function repoDevoluciones(): Repositorio {
  return DEMO_ACTIVO ? demoRepo : supabaseRepo;
}
