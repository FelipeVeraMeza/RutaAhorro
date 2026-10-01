'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { DEMO_BAJO_STOCK } from '../demo/data';

/**
 * Avisos del sistema para el jefe (RF-M8-07, RF-M8-08).
 *
 * La base ya escribía una alerta cada vez que un producto cruzaba su mínimo
 * o quedaba en negativo (vendido sin stock registrado, RQ-14), y nadie las
 * leía: la tabla `alerts` crecía sin pantalla. Y una caja olvidada abierta
 * solo se veía entrando a Caja.
 */
export interface Aviso {
  id: string;
  tipo: string;
  gravedad: 'info' | 'warning' | 'critical';
  texto: string;
  fecha: string;
}

export interface CajaOlvidada {
  id: string;
  nombre: string;
  abiertaEn: string;
  horas: number;
}

function textoDe(tipo: string, payload: Record<string, unknown>): string {
  if (tipo === 'low_stock') {
    const q = Number(payload.quantity ?? 0);
    const nombre = String(payload.product_name ?? 'Un producto');
    return q < 0
      ? `${nombre} se vendió sin stock registrado (quedó en ${q}): falta ingresar una recepción o ajustar`
      : q === 0 ? `${nombre} se agotó` : `${nombre} bajó de su mínimo (quedan ${q})`;
  }
  return String(payload.message ?? tipo);
}

export async function avisosSinLeer(): Promise<Aviso[]> {
  if (DEMO_ACTIVO) {
    return DEMO_BAJO_STOCK.slice(0, 3).map((p, i) => ({
      id: `demo-aviso-${i}`, tipo: 'low_stock', gravedad: p.quantity <= 0 ? 'critical' : 'warning',
      texto: textoDe('low_stock', { product_name: p.name, quantity: p.quantity }), fecha: new Date().toISOString(),
    }));
  }
  const { data, error } = await supabase().from('alerts')
    .select('id, type, severity, payload, created_at')
    .eq('is_read', false).order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id as string, tipo: a.type as string, gravedad: a.severity as Aviso['gravedad'],
    texto: textoDe(a.type as string, (a.payload ?? {}) as Record<string, unknown>), fecha: a.created_at as string,
  }));
}

export async function marcarAvisosLeidos(ids: string[], usuarioId: string): Promise<void> {
  if (DEMO_ACTIVO || ids.length === 0) return;
  const { error } = await supabase().from('alerts')
    .update({ is_read: true, read_at: new Date().toISOString(), read_by: usuarioId }).in('id', ids);
  if (error) throw error;
}

export async function cajasOlvidadas(horasAviso: number): Promise<CajaOlvidada[]> {
  if (DEMO_ACTIVO) {
    // La maqueta tiene una caja por cuenta, en una cookie: si quedó abierta
    // de hace más horas que el aviso, se muestra igual que en producción.
    const { leerCajaDemoNavegador, usuarioDemoActual } = await import('../demo/caja');
    const c = leerCajaDemoNavegador(usuarioDemoActual());
    const horas = Math.floor((Date.now() - new Date(c.abiertaEn).getTime()) / 3_600_000);
    return c.abierta && horas >= horasAviso
      ? [{ id: c.id, nombre: 'Tu caja (maqueta)', abiertaEn: c.abiertaEn, horas }]
      : [];
  }
  const limite = new Date(Date.now() - horasAviso * 3_600_000).toISOString();
  const { data, error } = await supabase().from('v_cash_sessions_summary')
    .select('session_id, full_name, opened_at').eq('status', 'abierta').lt('opened_at', limite).order('opened_at');
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.session_id as string, nombre: (c.full_name as string) || 'Sin nombre', abiertaEn: c.opened_at as string,
    horas: Math.floor((Date.now() - new Date(c.opened_at as string).getTime()) / 3_600_000),
  }));
}
