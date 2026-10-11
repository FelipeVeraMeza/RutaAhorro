'use client';

import type { EstadoPedidoWeb } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';

/**
 * Pedidos web (0040, docs/33): los que los clientes hacen en la tienda. El
 * personal los lee por RLS (admin, supervisor, vendedor) y los mueve con
 * `fn_cambiar_estado_pedido_web`.
 */
export interface PedidoWeb {
  id: string;
  numero: number;
  codigo: string;
  nombre: string;
  celular: string;
  correo: string | null;
  nota: string | null;
  estado: EstadoPedidoWeb;
  motivo: string | null;
  total: number;
  ahorro: number;
  creado: string;
  actualizado: string;
  items: Array<{ nombre: string; cantidad: number; precioUnitario: number; subtotal: number; productId: string | null }>;
}

/** Los abiertos (de cualquier día) y los cerrados de los últimos 7 días, los más nuevos primero. */
export async function listarPedidosWeb(): Promise<PedidoWeb[]> {
  if (DEMO_ACTIVO) {
    const r = await fetch('/api/tienda/pedidos/demo', { cache: 'no-store' });
    const d = await r.json() as { pedidos: Array<Record<string, unknown>> };
    return d.pedidos.map((p) => ({
      id: p.id as string, numero: p.numero as number, codigo: p.codigo as string, nombre: p.nombre as string,
      celular: p.celular as string, correo: (p.correo as string) ?? null, nota: (p.nota as string) ?? null,
      estado: p.estado as EstadoPedidoWeb, motivo: (p.motivo as string) ?? null, total: p.total as number, ahorro: p.ahorro as number,
      creado: p.creado as string, actualizado: p.actualizado as string,
      items: (p.items as Array<{ nombre: string; cantidad: number; precio_unitario: number; subtotal: number; product_id: string }>)
        .map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precioUnitario: i.precio_unitario, subtotal: i.subtotal, productId: i.product_id })),
    }));
  }
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase().from('pedidos_web')
    .select('id, numero, codigo, cliente_nombre, cliente_celular, cliente_correo, nota, estado, motivo_cancelacion, total, ahorro, created_at, updated_at, ' +
      'pedido_web_items(nombre, cantidad, precio_unitario, subtotal, product_id)')
    .or(`estado.in.(recibido,preparando,listo),updated_at.gte."${desde}"`)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => ({
    id: p.id as string, numero: p.numero as number, codigo: p.codigo as string, nombre: p.cliente_nombre as string,
    celular: p.cliente_celular as string, correo: (p.cliente_correo as string) ?? null, nota: (p.nota as string) ?? null,
    estado: p.estado as EstadoPedidoWeb, motivo: (p.motivo_cancelacion as string) ?? null,
    total: Number(p.total), ahorro: Number(p.ahorro), creado: p.created_at as string, actualizado: p.updated_at as string,
    items: ((p.pedido_web_items as Array<{ nombre: string; cantidad: number; precio_unitario: number; subtotal: number; product_id: string | null }>) ?? [])
      .map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precioUnitario: i.precio_unitario, subtotal: i.subtotal, productId: i.product_id })),
  }));
}

export async function cambiarEstadoPedidoWeb(id: string, estado: EstadoPedidoWeb, motivo?: string): Promise<void> {
  if (DEMO_ACTIVO) {
    const r = await fetch('/api/tienda/pedidos/demo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, estado, motivo }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.code ?? 'ERROR');
    return;
  }
  const { error } = await supabase().rpc('fn_cambiar_estado_pedido_web', { p_id: id, p_estado: estado, p_motivo: motivo ?? null });
  if (error) throw error;
}

/** Cuántos pedidos esperan que alguien los mire (recibidos). Null si no se pudo saber (sin 0040, sin red). */
export async function contarPedidosNuevos(): Promise<number | null> {
  if (DEMO_ACTIVO) {
    try { return (await listarPedidosWeb()).filter((p) => p.estado === 'recibido').length; } catch { return null; }
  }
  const { count, error } = await supabase().from('pedidos_web').select('id', { count: 'exact', head: true }).eq('estado', 'recibido');
  return error ? null : count ?? 0;
}
