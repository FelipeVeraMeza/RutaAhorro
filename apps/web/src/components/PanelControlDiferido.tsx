'use client';

import dynamic from 'next/dynamic';

/**
 * RNF-62 · "Para revisar" se arma con datos que llegan después de pintar
 * (avisos, cajas, merma, facturas): su código también. Antes sumaba los
 * repositorios de reportes y de compras a la primera carga del Inicio.
 */
export const PanelControlDiferido = dynamic(
  () => import('./PanelControl').then((m) => m.PanelControl),
  { ssr: false },
);
