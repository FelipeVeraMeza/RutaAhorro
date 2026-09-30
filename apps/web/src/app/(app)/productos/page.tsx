import { getCurrentUser } from '@/lib/supabase/server';
import { ProductosClient } from './ProductosClient';

export const metadata = { title: 'Productos' };

export default async function ProductosPage({ searchParams }: { searchParams: Promise<{ nuevo?: string; editar?: string }> }) {
  const user = await getCurrentUser();
  // ?nuevo=<código>: viene de un escaneo que no encontró el producto.
  const { nuevo, editar } = await searchParams;
  const editarId = editar && /^[0-9a-zA-Z-]{1,64}$/.test(editar) ? editar : null;
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
      editarId={editarId}
    />
  );
}
