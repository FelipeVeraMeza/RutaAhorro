import { exigirRol } from '@/lib/permisos';
import { DevolucionClient } from './DevolucionClient';

export const metadata = { title: 'Devolver a proveedor' };

export default async function DevolucionPage() {
  // Los mismos que reciben mercadería (fn_devolver_a_proveedor, 0035). El
  // valor al costo de lo devuelto, solo el administrador (bodega y supervisor
  // no ven costos).
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);
  return <DevolucionClient verCostos={user.role === 'admin'} />;
}
