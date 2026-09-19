import { PrecioClient } from './PrecioClient';

export const metadata = { title: 'Consultar precio' };

/**
 * No necesita datos del servidor: lee el catálogo replicado en el dispositivo,
 * que es lo que la hace funcionar sin internet.
 */
export default function PrecioPage() {
  return <PrecioClient />;
}
