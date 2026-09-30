import { exigirRol } from '@/lib/permisos';
import { ConfiguracionClient } from './ConfiguracionClient';

export const metadata = { title: 'Configuración' };

export default async function ConfiguracionPage() {
  // Solo el administrador. La base lo impone igual (fn_guardar_configuracion,
  // fn_guardar_impuesto): ocultar la pantalla no es la protección.
  await exigirRol(['admin']);
  return <ConfiguracionClient />;
}
