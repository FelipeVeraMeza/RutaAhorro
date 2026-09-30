import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { inicioPara } from '@/lib/navegacion';
import { CambiarClave } from './CambiarClave';

export const metadata = { title: 'Cambiar contraseña' };

/**
 * Cambiar la propia contraseña. Fuera del layout de la app a propósito: el
 * layout manda acá a quien entró con una clave temporal, y si esta pantalla
 * viviera adentro sería un bucle.
 */
export default async function ClavePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <CambiarClave
      nombre={user.fullName}
      obligatorio={Boolean(user.debeCambiarClave)}
      demo={DEMO_ACTIVO}
      volverA={inicioPara(user.role)}
    />
  );
}
