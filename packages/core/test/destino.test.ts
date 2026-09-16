import { describe, it, expect } from 'vitest';
import { destinoSeguro, DESTINO_POR_DEFECTO } from '../src/destino.js';

const BARRA_INVERTIDA = String.fromCharCode(92);
const TAB = String.fromCharCode(9);
const SALTO = String.fromCharCode(10);

describe('destinoSeguro', () => {
  describe('deja pasar rutas internas', () => {
    it('acepta una ruta simple', () => {
      expect(destinoSeguro('/productos')).toBe('/productos');
    });

    it('acepta una ruta anidada', () => {
      expect(destinoSeguro('/productos/etiquetas')).toBe('/productos/etiquetas');
    });

    it('conserva la cadena de consulta', () => {
      expect(destinoSeguro('/inventario?vista=kardex')).toBe('/inventario?vista=kardex');
    });

    it('conserva el fragmento', () => {
      expect(destinoSeguro('/caja#cierre')).toBe('/caja#cierre');
    });
  });

  describe('cae al destino por defecto cuando no hay nada que honrar', () => {
    it('sin parámetro', () => {
      expect(destinoSeguro(null)).toBe(DESTINO_POR_DEFECTO);
    });

    it('indefinido', () => {
      expect(destinoSeguro(undefined)).toBe(DESTINO_POR_DEFECTO);
    });

    it('cadena vacía', () => {
      expect(destinoSeguro('')).toBe(DESTINO_POR_DEFECTO);
    });
  });

  describe('bloquea la salida del sitio', () => {
    it('rechaza una URL absoluta con protocolo', () => {
      expect(destinoSeguro('https://sitio-falso.cl')).toBe(DESTINO_POR_DEFECTO);
    });

    it('rechaza http sin ese', () => {
      expect(destinoSeguro('http://sitio-falso.cl/login')).toBe(DESTINO_POR_DEFECTO);
    });

    // El caso clásico: sin protocolo, el navegador hereda el de la página y
    // "//sitio.cl" termina siendo "https://sitio.cl".
    it('rechaza la URL sin protocolo', () => {
      expect(destinoSeguro('//sitio-falso.cl')).toBe(DESTINO_POR_DEFECTO);
    });

    // El navegador normaliza la barra invertida a barra normal antes de
    // resolver, así que "/\" es exactamente "//".
    it('rechaza la barra invertida, que el navegador convierte en barra', () => {
      expect(destinoSeguro(`/${BARRA_INVERTIDA}sitio-falso.cl`)).toBe(DESTINO_POR_DEFECTO);
    });

    it('rechaza el tabulador metido para esconder el doble slash', () => {
      expect(destinoSeguro(`/${TAB}/sitio-falso.cl`)).toBe(DESTINO_POR_DEFECTO);
    });

    it('rechaza el salto de línea con el mismo propósito', () => {
      expect(destinoSeguro(`/${SALTO}/sitio-falso.cl`)).toBe(DESTINO_POR_DEFECTO);
    });

    it('rechaza un destino que no empieza con barra', () => {
      expect(destinoSeguro('productos')).toBe(DESTINO_POR_DEFECTO);
    });

    it('rechaza javascript:', () => {
      expect(destinoSeguro('javascript:alert(1)')).toBe(DESTINO_POR_DEFECTO);
    });

    it('rechaza data:', () => {
      expect(destinoSeguro('data:text/html,<h1>hola</h1>')).toBe(DESTINO_POR_DEFECTO);
    });

    it('rechaza el espacio inicial que esconde el doble slash', () => {
      expect(destinoSeguro(' //sitio-falso.cl')).toBe(DESTINO_POR_DEFECTO);
    });
  });
});
