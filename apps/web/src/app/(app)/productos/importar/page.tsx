import { exigirRol } from '@/lib/permisos';
import { ImportarClient } from './ImportarClient';

export const metadata = { title: 'Carga masiva de productos' };

export default async function ImportarPage() {
  // El vendedor no puede cargar catálogo (RF-M2-11, matriz del doc 02)
  await exigirRol(['admin', 'supervisor', 'bodega']);
  return <ImportarClient />;
}
