import { exigirRol } from '@/lib/permisos';
import { FiadoClient } from './FiadoClient';

export const metadata = { title: 'Fiado' };

export default async function FiadoPage() {
  // Los mismos que fn_abonar_cuenta. El tope lo ponen admin y supervisor.
  const user = await exigirRol(['admin', 'supervisor', 'vendedor']);
  return <FiadoClient puedeDarCredito={user.role === 'admin' || user.role === 'supervisor'} />;
}
