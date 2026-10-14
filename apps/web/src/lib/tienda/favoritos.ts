'use client';

import { crearAlmacen } from './almacen';

/**
 * RF-T73 · Favoritos y RF-T74 · vistos hace poco: solo los id de producto, en
 * este navegador (como el carrito). Nada sale de acá: no hay cuenta.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^p\d+$/i;
const soloIds = (tope: number) => (x: unknown) =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && UUID.test(v)).slice(0, tope) : null;

const TOPE_FAVORITOS = 100;
const TOPE_VISTOS = 12;
const NADA: string[] = [];

const favoritos = crearAlmacen<string[]>('tienda:favoritos', NADA, soloIds(TOPE_FAVORITOS));
const vistos = crearAlmacen<string[]>('tienda:vistos', NADA, soloIds(TOPE_VISTOS));

export const useFavoritos = favoritos.usar;
export const useVistos = vistos.usar;

export function alternarFavorito(id: string) {
  const actual = favoritos.leer();
  favoritos.guardar(actual.includes(id) ? actual.filter((x) => x !== id) : [id, ...actual].slice(0, TOPE_FAVORITOS));
}

/** El más reciente primero, sin repetir. */
export function anotarVisto(id: string) {
  const actual = vistos.leer();
  if (actual[0] === id) return;
  vistos.guardar([id, ...actual.filter((x) => x !== id)].slice(0, TOPE_VISTOS));
}

export function borrarFavoritosYVistos() {
  favoritos.guardar(NADA);
  vistos.guardar(NADA);
}
