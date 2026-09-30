import { exigirRol } from '@/lib/permisos';
import { CombosClient } from './CombosClient';

export const metadata = { title: 'Combos' };

export default async function CombosPage() {
  // Los mismos que fn_guardar_combo, y que editan ofertas.
  await exigirRol(['admin', 'supervisor']);
  return <CombosClient />;
}
