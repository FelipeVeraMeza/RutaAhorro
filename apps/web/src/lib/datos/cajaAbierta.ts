'use client';

import { DEMO_ACTIVO } from '../demo';

/**
 * ¿Quien tiene la sesión dejó su caja abierta? Lo pregunta "Salir": así se
 * originan las cajas olvidadas (RF-M8-08), que mezclan dos días en un cierre.
 * Se carga con import() desde el botón: no pesa en la primera carga.
 */
export async function miCajaAbierta(): Promise<{ abiertaEn: string } | null> {
  if (DEMO_ACTIVO) {
    const { leerCajaDemoNavegador, usuarioDemoActual } = await import('../demo/caja');
    const c = leerCajaDemoNavegador(usuarioDemoActual());
    return c.abierta ? { abiertaEn: c.abiertaEn } : null;
  }
  const { supabase } = await import('../supabase/client');
  const { data: sesion } = await supabase().auth.getSession();
  const uid = sesion.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase().from('cash_sessions').select('opened_at')
    .eq('user_id', uid).eq('status', 'abierta').maybeSingle();
  // Sin red, Supabase no lanza: devuelve el error y data null. Antes eso era
  // "no tienes caja abierta" (Recibir mercadería mandaba a abrir una caja que
  // ya estaba abierta). Se lanza: quien llama decide qué hacer sin saberlo.
  if (error) throw error;
  return data ? { abiertaEn: data.opened_at as string } : null;
}
