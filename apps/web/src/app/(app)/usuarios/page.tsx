import { exigirRol } from '@/lib/permisos';
import { UsuariosClient } from './UsuariosClient';

export const metadata = { title: 'Usuarios' };

export default async function UsuariosPage() {
  // Solo el administrador gestiona usuarios (matriz del doc 02)
  const user = await exigirRol(['admin']);
  return <UsuariosClient miId={user.id} />;
}
