import { exigirRol } from '@/lib/permisos';
import { ClientesClient } from './ClientesClient';

export const metadata = { title: 'Clientes' };

export default async function ClientesPage() {
  // Los mismos que fn_guardar_cliente. El vendedor elige al cliente en el POS.
  await exigirRol(['admin', 'supervisor']);
  return <ClientesClient />;
}
