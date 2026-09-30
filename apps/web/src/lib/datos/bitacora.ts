'use client';

import { rangoDeDias, formatCLP } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { configuracionLocal } from './configuracion';

/**
 * La bitácora de auditoría, para leerla (RF-M9-11).
 *
 * La base la escribe desde el primer día (0002, 0003) y es inmutable, pero
 * nadie podía verla sin entrar a Supabase: "¿quién le bajó el precio al
 * aceite?" no tenía respuesta en el sistema. Solo el administrador (RLS
 * `audit_read`).
 */
export interface EntradaBitacora {
  id: string;
  fecha: string;
  quien: string | null;
  accion: string;
  texto: string;
}

export const ACCIONES: Record<string, string> = {
  price_change: 'Cambio de precio',
  sale_void: 'Venta anulada',
  receipt_void: 'Recepción anulada',
  stock_adjustment: 'Ajuste de stock',
  cash_force_close: 'Caja cerrada por otro',
  role_change: 'Cambio de rol',
  user_create: 'Usuario creado',
  user_activate: 'Usuario reactivado',
  user_deactivate: 'Usuario desactivado',
};

function detalle(accion: string, antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): string {
  const a = antes ?? {}, d = despues ?? {};
  switch (accion) {
    case 'price_change': return `${formatCLP(Number(a.sale_price ?? 0))} → ${formatCLP(Number(d.sale_price ?? 0))}`;
    case 'sale_void': return `${formatCLP(Number(a.total ?? 0))}${d.reason ? ` · ${d.reason}` : ''}`;
    case 'receipt_void': return String(d.reason ?? '');
    case 'stock_adjustment': return `${a.quantity ?? '?'} → ${d.quantity ?? '?'}${d.reason ? ` · ${d.reason}` : ''}`;
    case 'cash_force_close': return String(d.notes ?? '');
    case 'role_change': return `${a.role ?? '?'} → ${d.role ?? '?'}`;
    case 'user_create': return `${d.email ?? ''} (${d.role ?? ''})`;
    default: return '';
  }
}

export async function leerBitacora(desde: string, hasta: string, accion: string | null): Promise<EntradaBitacora[]> {
  if (DEMO_ACTIVO) {
    return [{ id: 'demo-1', fecha: new Date().toISOString(), quien: 'Felipe Vera', accion: 'price_change', texto: '$1.490 → $1.590 · Arroz grado 1 · 1 kg' }];
  }
  const { zonaHoraria } = await configuracionLocal();
  const r = rangoDeDias(desde, hasta, zonaHoraria);
  let q = supabase().from('audit_log')
    .select('id, action, entity_type, entity_id, old_values, new_values, created_at, quien:profiles!audit_log_user_id_fkey(full_name)')
    .gte('created_at', r.desde).lt('created_at', r.hasta)
    .order('created_at', { ascending: false }).limit(300);
  if (accion) q = q.eq('action', accion);
  const { data, error } = await q;
  if (error) throw error;
  // El registro guarda el id del producto, no su nombre: se busca aparte.
  const ids = [...new Set((data ?? []).filter((e) => e.entity_type === 'products' && e.entity_id).map((e) => e.entity_id as string))];
  const nombres = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await supabase().from('products_public').select('id, name').in('id', ids);
    for (const p of ps ?? []) nombres.set(p.id as string, p.name as string);
  }
  return (data ?? []).map((e) => {
    const producto = e.entity_type === 'products' ? nombres.get(e.entity_id as string) : undefined;
    const texto = detalle(e.action as string, e.old_values as Record<string, unknown> | null, e.new_values as Record<string, unknown> | null);
    return {
      id: e.id as string,
      fecha: e.created_at as string,
      quien: ((e.quien as { full_name?: string } | null)?.full_name) ?? null,
      accion: e.action as string,
      texto: producto ? `${producto} · ${texto}` : texto,
    };
  });
}
