import { redirect } from 'next/navigation';
import { getCurrentUser, type CurrentUser } from './supabase/server';
import { inicioPara, type Rol } from './navegacion';

/**
 * La puerta de cada pantalla, en el servidor.
 *
 * Antes cada página escribía su propio `if (...) redirect('/')`, y varias lo
 * hacían DESPUÉS de la rama del modo demo: en la maqueta el vendedor abría
 * Ofertas, Combos, Clientes y Facturación con permisos de administrador, y el
 * selector de rol enseñaba una matriz de permisos que no es la real. Además
 * /pos, /caja y el Inicio no tenían ninguna: bodega vendía y veía la plata.
 *
 * Quien no puede entrar vuelve a SU primera pantalla (no a "/", que es del
 * dueño). La base lo impone igual con RLS: esto es orden, no seguridad.
 */
export async function exigirRol(roles: readonly Rol[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!roles.includes(user.role)) redirect(inicioPara(user.role));
  return user;
}
