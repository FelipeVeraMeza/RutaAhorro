import { crearLimitador } from '@rutaahorro/core';
import { respuestaError } from '@/lib/supabase/admin';

/**
 * Límites de solicitudes de las rutas de la tienda y de fotos (RNF-T18).
 * En memoria del proceso: alcanza con el único servicio de Railway.
 *
 *   tienda   · /api/tienda/productos, público: 60 por minuto por IP
 *   ficha    · /api/productos/codigo: 30 por minuto por usuario (cada una es
 *              una consulta a Open Food Facts, que permite ~100 por minuto)
 *   foto     · /api/productos/foto: 30 por minuto por usuario
 */
const LIMITES = {
  tienda: crearLimitador(60, 60_000),
  ficha: crearLimitador(30, 60_000),
  foto: crearLimitador(30, 60_000),
};

/** La IP de quien pide, detrás del proxy de Railway. */
export function ipDe(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'desconocida';
}

/** Null = puede seguir; si no, la respuesta 429 para devolver. */
export function limitar(cual: keyof typeof LIMITES, clave: string): Response | null {
  if (LIMITES[cual].permitir(clave)) return null;
  const r = respuestaError('DEMASIADAS_SOLICITUDES', 'Demasiadas solicitudes seguidas. Espera un minuto e intenta de nuevo.', 429);
  r.headers.set('Retry-After', '60');
  return r;
}
