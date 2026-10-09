import { rubroPorNombre } from '@rutaahorro/core';
import type { NombreIcono } from '@/components/Icono';

/**
 * El ícono de un producto sin foto: el de su grupo (categoría del local o
 * rubro, ver `rubroPorNombre` en core) o, si el grupo no dice nada, el que
 * calza con su nombre. "ACEITE MARAVILLA" con una canasta se entiende mejor
 * que con una caja genérica.
 */
const ICONO_RUBRO: Record<string, NombreIcono> = {
  'Limpieza y aseo': 'limpieza',
  'Lácteos': 'leche',
  'Bebidas': 'botella',
  'Snacks y dulces': 'snack',
  'Panadería': 'pan',
  'Carnes y congelados': 'productos',
  'Frutas y verduras': 'fruta',
  'Abarrotes': 'canasta',
};

export function iconoProducto(grupo: string | null, nombre: string): NombreIcono {
  for (const texto of [grupo, nombre]) {
    if (!texto) continue;
    const rubro = ICONO_RUBRO[texto] ? texto : rubroPorNombre(texto);
    if (rubro) return ICONO_RUBRO[rubro];
  }
  return 'productos';
}
