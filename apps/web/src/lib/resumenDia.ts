import { formatCLP } from '@rutaahorro/core';

/**
 * El resumen del día para mandarlo por WhatsApp (RF-M7-17): el dueño que no
 * está en el local lo recibe de quien cierra, o se lo manda a su socio.
 * wa.me sin número deja elegir el contacto en el celular.
 */
export function enlaceResumenDia(r: {
  local?: string; total: number; ventas: number; ticket: number; bajoMinimo?: number; enRiesgo?: number;
}): string {
  const lineas = [
    `Resumen de hoy${r.local ? ` · ${r.local}` : ''}`,
    `Vendido: ${formatCLP(r.total)} en ${r.ventas} ${r.ventas === 1 ? 'venta' : 'ventas'}`,
    `Ticket promedio: ${formatCLP(r.ticket)}`,
  ];
  if (r.bajoMinimo) lineas.push(`Bajo stock mínimo: ${r.bajoMinimo} ${r.bajoMinimo === 1 ? 'producto' : 'productos'}`);
  // Al costo: solo va si quien lo manda puede ver costos (lo decide quien llama).
  if (r.enRiesgo) lineas.push(`Por vencer: ${formatCLP(r.enRiesgo)} al costo en riesgo`);
  return `https://wa.me/?text=${encodeURIComponent(lineas.join('\n'))}`;
}
