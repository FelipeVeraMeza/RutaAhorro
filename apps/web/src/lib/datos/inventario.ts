'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db } from '../offline/db';

/**
 * Movimientos de inventario: ajustes, mermas y kardex (módulo M4).
 *
 * El kardex es inmutable (ADR-006): corregir nunca significa editar un
 * movimiento, sino agregar uno compensatorio. Por eso aquí no existe ninguna
 * función de editar ni borrar movimientos — y no es un olvido.
 */

export type TipoMovimiento =
  | 'inventario_inicial' | 'venta' | 'anulacion_venta' | 'recepcion'
  | 'anulacion_recepcion' | 'ajuste_positivo' | 'ajuste_negativo'
  | 'merma' | 'toma_inventario';

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  inventario_inicial: 'Inventario inicial',
  venta: 'Venta',
  anulacion_venta: 'Anulación de venta',
  recepcion: 'Recepción',
  anulacion_recepcion: 'Anulación de recepción',
  ajuste_positivo: 'Ajuste (suma)',
  ajuste_negativo: 'Ajuste (resta)',
  merma: 'Merma',
  toma_inventario: 'Toma de inventario',
};

/** Motivos frecuentes: escribirlos a mano cada vez genera datos inconsistentes. */
export const MOTIVOS_SUGERIDOS = [
  'Producto vencido',
  'Producto dañado',
  'Robo o pérdida',
  'Error de digitación',
  'Diferencia de conteo',
  'Consumo interno',
  'Devolución a proveedor',
];

export interface Movimiento {
  id: string;
  fecha: string;
  productoId: string;
  productoNombre: string;
  tipo: TipoMovimiento;
  cantidad: number;
  saldo: number;
  motivo: string | null;
  usuario: string | null;
}

export interface RepositorioInventario {
  kardex(productoId: string | null, limite?: number): Promise<Movimiento[]>;
  ajustar(datos: {
    productoId: string;
    nuevaCantidad: number;
    tipo: 'ajuste_positivo' | 'ajuste_negativo' | 'merma';
    motivo: string;
  }): Promise<void>;
  aplicarToma(items: Array<{ productoId: string; contado: number }>): Promise<{
    diferencias: number;
    valorDiferencia: number;
  }>;
}

const KEY = 'demo:movimientos';

async function leerMovs(): Promise<Movimiento[]> {
  const raw = await db().meta.get(KEY);
  return raw?.value ? (JSON.parse(raw.value) as Movimiento[]) : [];
}

async function registrarMov(m: Omit<Movimiento, 'id' | 'fecha'>) {
  const movs = await leerMovs();
  movs.unshift({ ...m, id: `mv${Date.now()}${Math.random().toString(16).slice(2, 6)}`, fecha: new Date().toISOString() });
  await db().meta.put({ key: KEY, value: JSON.stringify(movs.slice(0, 500)) });
}

const repoLocal: RepositorioInventario = {
  async kardex(productoId, limite = 100) {
    const movs = await leerMovs();
    return (productoId ? movs.filter((m) => m.productoId === productoId) : movs).slice(0, limite);
  },

  async ajustar({ productoId, nuevaCantidad, tipo, motivo }) {
    if (motivo.trim() === '') throw new Error('MOTIVO_REQUERIDO');
    const p = await db().products.get(productoId);
    if (!p) throw new Error('PRODUCTO_NO_ENCONTRADO');

    const delta = nuevaCantidad - p.stock;
    if (delta === 0) return;

    await db().products.put({ ...p, stock: nuevaCantidad, updatedAt: new Date().toISOString() });
    await registrarMov({
      productoId, productoNombre: p.name, tipo,
      cantidad: delta, saldo: nuevaCantidad,
      motivo, usuario: 'Modo demo',
    });
  },

  async aplicarToma(items) {
    const costos = JSON.parse((await db().meta.get('demo:costos'))?.value ?? '{}') as Record<string, number>;
    let diferencias = 0;
    let valorDiferencia = 0;

    for (const it of items) {
      const p = await db().products.get(it.productoId);
      if (!p) continue;
      const delta = it.contado - p.stock;
      if (delta === 0) continue;

      diferencias++;
      valorDiferencia += Math.round(delta * (costos[it.productoId] ?? 0));

      await db().products.put({ ...p, stock: it.contado, updatedAt: new Date().toISOString() });
      await registrarMov({
        productoId: it.productoId, productoNombre: p.name,
        tipo: 'toma_inventario', cantidad: delta, saldo: it.contado,
        motivo: 'Toma de inventario', usuario: 'Modo demo',
      });
    }
    return { diferencias, valorDiferencia };
  },
};

const repoSupabase: RepositorioInventario = {
  async kardex(productoId, limite = 100) {
    let q = supabase()
      .from('inventory_movements')
      .select('id, created_at, product_id, movement_type, quantity, balance_after, reason, products(name), profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(limite);
    if (productoId) q = q.eq('product_id', productoId);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((m) => ({
      id: m.id as string,
      fecha: m.created_at as string,
      productoId: m.product_id as string,
      productoNombre: (m.products as unknown as { name: string } | null)?.name ?? 'Producto',
      tipo: m.movement_type as TipoMovimiento,
      cantidad: Number(m.quantity ?? 0),
      saldo: Number(m.balance_after ?? 0),
      motivo: m.reason as string | null,
      usuario: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
    }));
  },

  async ajustar({ productoId, nuevaCantidad, tipo, motivo }) {
    const { error } = await supabase().rpc('fn_adjust_stock', {
      p_product_id: productoId,
      p_new_quantity: nuevaCantidad,
      p_movement_type: tipo,
      p_reason: motivo,
    });
    if (error) throw error;
  },

  async aplicarToma(items) {
    const client = supabase();
    const { data: { user } } = await client.auth.getUser();
    const { data: perfil } = await client.from('profiles').select('tenant_id, store_id').eq('id', user!.id).single();

    const { data: conteo, error: e1 } = await client
      .from('stock_counts')
      .insert({ tenant_id: perfil!.tenant_id, store_id: perfil!.store_id })
      .select('id').single();
    if (e1) throw e1;

    const { data, error } = await client.rpc('fn_apply_stock_count', {
      p_count_id: conteo.id,
      p_items: items.map((i) => ({ product_id: i.productoId, counted_qty: i.contado })),
    });
    if (error) throw error;

    const r = data as { differences: unknown[]; difference_value: number };
    return { diferencias: (r.differences ?? []).length, valorDiferencia: r.difference_value ?? 0 };
  },
};

export function repoInventario(): RepositorioInventario {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}
