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
  /** Qué se hizo, en palabras: "Factura de proveedor pagada". */
  nombre: string;
  texto: string;
}

/**
 * Qué se hizo. La clave es la acción o "acción:entidad": las funciones de la
 * base escriben "editar" o "crear" para cosas distintas (la configuración, un
 * cliente, un combo), y la bitácora mostraba "editar" a secas, sin decir qué.
 */
export const ACCIONES: Record<string, string> = {
  price_change: 'Cambio de precio',
  sale_void: 'Venta anulada',
  devolucion: 'Devolución de venta',
  receipt_void: 'Recepción anulada',
  stock_adjustment: 'Ajuste de stock',
  cash_force_close: 'Caja cerrada por otro',
  role_change: 'Cambio de rol',
  user_create: 'Usuario creado',
  user_activate: 'Usuario reactivado',
  user_deactivate: 'Usuario desactivado',
  'editar:configuracion': 'Configuración cambiada',
  'crear:cliente': 'Cliente creado',
  'editar:cliente': 'Cliente cambiado',
  'precios:cliente': 'Precios de cliente',
  'editar:cliente_credito': 'Crédito de cliente (fiado)',
  'crear:combo': 'Combo creado',
  'editar:combo': 'Combo cambiado',
  'desactivar:combo': 'Combo desactivado',
  ofertas: 'Ofertas de productos',
  'crear:factura_proveedor': 'Factura de proveedor registrada',
  'pagar:factura_proveedor': 'Factura de proveedor pagada',
  'anular:factura_proveedor': 'Factura de proveedor anulada',
  factura_manual: 'Factura emitida',
  nota_credito: 'Nota de crédito',
  factura_recibida: 'Factura recibida registrada',
  'anular:facturas_recibidas': 'Factura recibida anulada',
  'editar:dte_emisor': 'Datos del emisor',
  emision_sii: 'Emisión ante el SII',
  // Lo que la base escribe desde 0018–0036 y la bitácora mostraba con el
  // código interno ("autorizar_descuento"), sin poder filtrarlo tampoco.
  'crear:impuesto_adicional': 'Impuesto adicional creado',
  'editar:impuesto_adicional': 'Impuesto adicional cambiado',
  'asignar:impuesto_adicional': 'Impuesto asignado a productos',
  autorizar_descuento: 'Descuento autorizado con PIN',
  guardar_pin: 'PIN de autorización cambiado',
  devolucion_proveedor: 'Devolución a proveedor',
  factura_descartada: 'Factura descartada',
  factura_emitida_sii: 'Factura emitida en el SII',
  ensayo_sii: 'Ensayo en el portal del SII',
  credenciales_sii: 'Claves del SII guardadas',
  credenciales_sii_borradas: 'Claves del SII borradas',
};

/** El nombre de una entrada, por acción y entidad. */
export function nombreAccion(accion: string, entidad?: string | null): string {
  return ACCIONES[`${accion}:${entidad ?? ''}`] ?? ACCIONES[accion] ?? accion;
}

const lista = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v as object).join(', ') : '');

function detalle(accion: string, entidad: string | null, antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): string {
  const a = antes ?? {}, d = despues ?? {};
  switch (accion) {
    case 'price_change': return `${formatCLP(Number(a.sale_price ?? 0))} → ${formatCLP(Number(d.sale_price ?? 0))}`;
    case 'sale_void': return `${formatCLP(Number(a.total ?? 0))}${d.reason ? ` · ${d.reason}` : ''}`;
    case 'devolucion': return `N° ${d.devolucion ?? '?'} · ${formatCLP(Number(d.monto ?? 0))}${d.reembolso ? ` en ${d.reembolso}` : ''}`;
    case 'receipt_void': return String(d.reason ?? '');
    case 'stock_adjustment': return `${a.quantity ?? '?'} → ${d.quantity ?? '?'}${d.reason ? ` · ${d.reason}` : ''}`;
    case 'cash_force_close': return String(d.notes ?? '');
    case 'role_change': return `${a.role ?? '?'} → ${d.role ?? '?'}`;
    case 'user_create': return `${d.email ?? ''} (${d.role ?? ''})`;
  }
  if (entidad === 'cliente_credito') return `tope ${formatCLP(Number(a.credito_tope ?? 0))} → ${formatCLP(Number(d.credito_tope ?? 0))}`;
  if (entidad === 'factura_proveedor') {
    return [d.numero ? `N° ${d.numero}` : '', d.monto != null ? formatCLP(Number(d.monto)) : '', d.motivo ? String(d.motivo) : '']
      .filter(Boolean).join(' · ');
  }
  if (accion === 'autorizar_descuento') return `hasta ${String(d.pct ?? '?').replace('.', ',')} %${d.motivo ? ` · ${d.motivo}` : ''}`;
  if (accion === 'devolucion_proveedor') return [d.documento ? `doc. ${d.documento}` : '', d.motivo ? String(d.motivo) : ''].filter(Boolean).join(' · ');
  if (accion === 'factura_descartada') return [d.numero ? `N° ${d.numero}` : '', d.motivo ? String(d.motivo) : ''].filter(Boolean).join(' · ');
  if (accion === 'factura_emitida_sii') return d.folio ? `folio ${d.folio}` : '';
  if (entidad === 'impuesto_adicional') return d.nombre ? `${d.nombre} ${d.tasa != null ? `${String(d.tasa).replace('.', ',')} %` : ''}`.trim() : d.productos != null ? `${d.productos} productos` : '';
  if (entidad === 'configuracion') return lista(d);
  if (entidad === 'cliente' || entidad === 'combo') return String(d.nombre ?? '');
  return '';
}

export async function leerBitacora(desde: string, hasta: string, accion: string | null): Promise<EntradaBitacora[]> {
  if (DEMO_ACTIVO) {
    // La fila de ejemplo respeta el filtro: antes salía con "Anulaciones" elegido.
    if (accion && accion.split(':')[0] !== 'price_change') return [];
    return [{ id: 'demo-1', fecha: new Date().toISOString(), quien: 'Felipe Vera', accion: 'price_change', nombre: ACCIONES.price_change, texto: '$1.490 → $1.590 · Arroz grado 1 · 1 kg' }];
  }
  const { zonaHoraria } = await configuracionLocal();
  const r = rangoDeDias(desde, hasta, zonaHoraria);
  let q = supabase().from('audit_log')
    .select('id, action, entity_type, entity_id, old_values, new_values, created_at, quien:profiles!audit_log_user_id_fkey(full_name)')
    .gte('created_at', r.desde).lt('created_at', r.hasta)
    .order('created_at', { ascending: false }).limit(300);
  if (accion) {
    const [acc, ent] = accion.split(':');
    q = q.eq('action', acc);
    if (ent) q = q.eq('entity_type', ent);
  }
  const { data, error } = await q;
  if (error) throw error;
  // El registro guarda el id del producto, no su nombre: se busca aparte.
  // "product" (en singular) es como escriben las ofertas (0018, 0021): esas
  // entradas salían sin decir de qué producto eran.
  const esProducto = (t: unknown) => t === 'products' || t === 'product';
  const ids = [...new Set((data ?? []).filter((e) => esProducto(e.entity_type) && e.entity_id).map((e) => e.entity_id as string))];
  const nombres = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await supabase().from('products_public').select('id, name').in('id', ids);
    for (const p of ps ?? []) nombres.set(p.id as string, p.name as string);
  }
  return (data ?? []).map((e) => {
    const producto = esProducto(e.entity_type) ? nombres.get(e.entity_id as string) : undefined;
    const texto = detalle(e.action as string, (e.entity_type as string) ?? null,
      e.old_values as Record<string, unknown> | null, e.new_values as Record<string, unknown> | null);
    return {
      id: e.id as string,
      fecha: e.created_at as string,
      quien: ((e.quien as { full_name?: string } | null)?.full_name) ?? null,
      accion: e.action as string,
      nombre: nombreAccion(e.action as string, e.entity_type as string),
      texto: producto ? `${producto} · ${texto}` : texto,
    };
  });
}
