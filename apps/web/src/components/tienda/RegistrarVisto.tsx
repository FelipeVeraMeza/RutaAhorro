'use client';

import { useEffect } from 'react';
import { anotarVisto } from '@/lib/tienda/favoritos';

/** Anota la ficha abierta en "Vistos hace poco" (RF-T74). */
export function RegistrarVisto({ id }: { id: string }) {
  useEffect(() => { anotarVisto(id); }, [id]);
  return null;
}
