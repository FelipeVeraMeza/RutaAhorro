import { exigirRol } from '@/lib/permisos';
import { RecepcionClient } from './RecepcionClient';

export const metadata = { title: 'Recibir mercadería' };

export default async function RecepcionPage() {
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);
  return <RecepcionClient usuarioId={user.id} />;
}
