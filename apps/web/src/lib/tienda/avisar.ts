import { DEMO_ACTIVO } from '../demo';

/**
 * Le dice a la tienda online que el catálogo cambió (precio, oferta, producto
 * nuevo): bota su copia y la próxima visita ve lo nuevo. Sin esperar la
 * renovación de cada minuto. En modo demo no hay tienda real que avisar.
 */
export function avisarTienda() {
  if (DEMO_ACTIVO) return;
  void fetch('/api/tienda/refrescar', { method: 'POST' }).catch(() => {});
}
