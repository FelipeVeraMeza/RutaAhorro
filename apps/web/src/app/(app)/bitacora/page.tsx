import { exigirRol } from '@/lib/permisos';
import { BitacoraClient } from './BitacoraClient';

export const metadata = { title: 'Bitácora' };

export default async function BitacoraPage() {
  // Solo el administrador (matriz del doc 02 y RLS `audit_read`).
  await exigirRol(['admin']);
  return <BitacoraClient />;
}
