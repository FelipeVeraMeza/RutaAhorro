/**
 * MODO DEMO — recorrer la aplicación sin autenticarse y sin base de datos.
 *
 * ⚠️  Es una herramienta de desarrollo. Se activa SOLO con la variable
 *     NEXT_PUBLIC_DEMO=true en .env.local, que jamás se configura en Vercel.
 *
 * Reglas que hacen que esto no sea un agujero de seguridad:
 *  1. Si la variable no está, todo el código de demo queda muerto y la
 *     aplicación exige sesión como siempre.
 *  2. El modo demo NUNCA lee ni escribe en Supabase: sirve datos fijos desde
 *     src/lib/demo/data.ts. No existe forma de que filtre datos reales.
 *  3. La interfaz muestra un banner permanente e imposible de ignorar.
 *
 * Para apagarlo: pon NEXT_PUBLIC_DEMO=false en .env.local y reinicia.
 */

import type { CurrentUser } from '../supabase/server';

export const DEMO_ACTIVO = process.env.NEXT_PUBLIC_DEMO === 'true';

export type DemoRole = 'admin' | 'supervisor' | 'vendedor' | 'bodega';

export const DEMO_COOKIE = 'demo_rol';

const PERFILES: Record<DemoRole, { nombre: string; descuento: number }> = {
  admin:      { nombre: 'Felipe Vera',  descuento: 100 },
  supervisor: { nombre: 'Marcela Soto', descuento: 10 },
  vendedor:   { nombre: 'Jorge Peña',   descuento: 0 },
  bodega:     { nombre: 'Luis Rojas',   descuento: 0 },
};

export function esRolValido(valor: string | undefined): valor is DemoRole {
  return valor === 'admin' || valor === 'supervisor' || valor === 'vendedor' || valor === 'bodega';
}

/** Usuario ficticio del modo demo. Nunca corresponde a una persona real. */
export function usuarioDemo(rol: DemoRole = 'admin'): CurrentUser {
  const perfil = PERFILES[rol];
  return {
    id: `demo-${rol}`,
    email: `${rol}@demo.local`,
    fullName: perfil.nombre,
    role: rol,
    tenantId: 'demo-tenant',
    storeId: 'demo-store',
    maxDiscountPct: perfil.descuento,
    isActive: true,
  };
}
