import { exigirRol } from '@/lib/permisos';
import { ReportesClient } from './ReportesClient';

export const metadata = { title: 'Reportes' };

export default async function ReportesPage() {
  // RF-M7-12: los reportes respetan la matriz del doc 02. El vendedor y bodega
  // no entran; el costo y el margen son solo del administrador, y no se piden
  // siquiera cuando no corresponde.
  const user = await exigirRol(['admin', 'supervisor']);
  return <ReportesClient verCostos={user.role === 'admin'} />;
}
