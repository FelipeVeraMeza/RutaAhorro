import { exigirRol } from '@/lib/permisos';
import { EtiquetasClient } from './EtiquetasClient';

export const metadata = { title: 'Etiquetas' };

export default async function EtiquetasPage() {
  // Mismo criterio que la pantalla de productos: quien puede editar el
  // catálogo puede etiquetarlo. El vendedor no.
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);
  return <EtiquetasClient puedeVerCostos={user.role === 'admin'} />;
}
