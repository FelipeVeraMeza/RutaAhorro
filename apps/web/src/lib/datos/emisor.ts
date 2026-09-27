'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';

/**
 * Datos del contribuyente que emite las boletas y facturas (0019).
 *
 * Van congelados en cada documento. Sin ellos, en simulación las boletas
 * salen con el nombre del local y "sin configurar"; para emitir de verdad
 * son obligatorios (y además el certificado digital y los folios del SII).
 */
export interface Emisor {
  rut: string;
  razonSocial: string;
  giro: string;
  acteco: string;
  direccion: string;
  comuna: string;
  ciudad: string;
  ambiente: 'simulacion' | 'certificacion' | 'produccion';
}

export async function leerEmisor(): Promise<Emisor | null> {
  if (DEMO_ACTIVO) return null;
  const { data, error } = await supabase().from('dte_emisores')
    .select('rut, razon_social, giro, acteco, direccion, comuna, ciudad, ambiente').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    rut: data.rut as string,
    razonSocial: data.razon_social as string,
    giro: data.giro as string,
    acteco: data.acteco != null ? String(data.acteco) : '',
    direccion: data.direccion as string,
    comuna: data.comuna as string,
    ciudad: (data.ciudad as string) ?? '',
    ambiente: data.ambiente as Emisor['ambiente'],
  };
}

export async function guardarEmisor(e: Emisor): Promise<void> {
  if (DEMO_ACTIVO) throw new Error('NO_DISPONIBLE_EN_DEMO');
  const { error } = await supabase().rpc('fn_guardar_emisor', {
    p_datos: {
      rut: e.rut, razon_social: e.razonSocial, giro: e.giro,
      acteco: e.acteco.trim() || null, direccion: e.direccion, comuna: e.comuna,
      ciudad: e.ciudad.trim() || null, ambiente: 'simulacion',
    },
  });
  if (error) throw error;
}
