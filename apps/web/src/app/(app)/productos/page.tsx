import { getCurrentUser } from '@/lib/supabase/server';
import { ProductosClient } from './ProductosClient';

export const metadata = { title: 'Productos' };

export default async function ProductosPage({ searchParams }: { searchParams: Promise<{ nuevo?: string }> }) {
  const user = await getCurrentUser();
  // ?nuevo=<código>: viene de un escaneo que no encontró el producto.
  const { nuevo } = await searchParams;
  const codigoNuevo = nuevo && /^[0-9A-Za-z-]{3,40}$/.test(nuevo) ? nuevo : null;

  // Permisos según la matriz del doc 02. La interfaz los refleja; la base de
  // datos los impone (RLS). Ocultar un botón no es seguridad.
  const rol = user!.role;
  return (
    <ProductosClient
      puedeVerCostos={rol === 'admin'}
      puedeEditar={rol === 'admin' || rol === 'supervisor' || rol === 'bodega'}
      puedeEliminar={rol === 'admin'}
      puedeEditarPrecios={rol === 'admin' || rol === 'supervisor'}
      esAdmin={rol === 'admin'}
      codigoNuevo={codigoNuevo}
    />
  );
}
