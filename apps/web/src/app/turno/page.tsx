import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { inicioPara } from '@/lib/navegacion';
import { ElegirTurno } from './ElegirTurno';

export const metadata = { title: 'Tu turno' };

/**
 * Elegir con qué rol se trabaja hoy. Fuera del layout de la app, como /clave:
 * se llega justo después de entrar.
 */
export default async function TurnoPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.debeCambiarClave) redirect('/clave');
  const roles = (user.rolesPermitidos ?? []).filter((r) => r !== 'admin');
  if (roles.length < 2) redirect(inicioPara(user.role));
  return <ElegirTurno nombre={user.fullName} roles={roles} actual={user.role} />;
}
