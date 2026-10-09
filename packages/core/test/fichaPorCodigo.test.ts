import { describe, it, expect } from 'vitest';
import { fotoCopiable, leerFichaPorCodigo, urlFichaPorCodigo } from '../src/fichaPorCodigo.js';

// Respuesta real de Open Food Facts para 7802950004892 (2026-10-09), recortada.
const MANJAR = {
  status: 1,
  product: {
    product_name: 'El Manjar', brands: 'Nestlé', quantity: '1 kg',
    image_front_url: 'https://images.openfoodfacts.org/images/products/780/295/000/4892/front_es.3.400.jpg',
  },
};

describe('leerFichaPorCodigo', () => {
  it('arma nombre, descripción y foto', () => {
    expect(leerFichaPorCodigo(MANJAR)).toEqual({
      nombre: 'El Manjar Nestlé 1 kg',
      marca: 'Nestlé',
      cantidad: '1 kg',
      descripcion: 'El Manjar · Nestlé · 1 kg',
      imagen: MANJAR.product.image_front_url,
    });
  });

  it('prefiere el nombre en español y no repite la marca ni la cantidad', () => {
    const f = leerFichaPorCodigo({ status: 1, product: {
      product_name: 'Takis Xplosion', product_name_es: 'Takis Xplosion 190 g', brands: 'Takis, Barcel', quantity: '190 g',
    } });
    expect(f?.nombre).toBe('Takis Xplosion 190 g');
    expect(f?.marca).toBe('Takis');
    expect(f?.imagen).toBeNull();
  });

  it('no encontrado, sin nombre o basura: null', () => {
    expect(leerFichaPorCodigo({ status: 0 })).toBeNull();
    expect(leerFichaPorCodigo({ status: 1, product: { brands: 'X' } })).toBeNull();
    expect(leerFichaPorCodigo(null)).toBeNull();
    expect(leerFichaPorCodigo('hola')).toBeNull();
  });

  it('una foto que no es https no se usa', () => {
    expect(leerFichaPorCodigo({ status: 1, product: { product_name: 'A', image_front_url: 'http://x/y.jpg' } })?.imagen).toBeNull();
  });
});

describe('fotoCopiable', () => {
  it('solo https y de Open Food Facts', () => {
    expect(fotoCopiable(MANJAR.product.image_front_url)).toBe(true);
    expect(fotoCopiable('http://images.openfoodfacts.org/a.jpg')).toBe(false);
    expect(fotoCopiable('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(fotoCopiable('https://images.openfoodfacts.org.malo.com/a.jpg')).toBe(false);
    expect(fotoCopiable('no es url')).toBe(false);
  });
});

describe('urlFichaPorCodigo', () => {
  it('codifica el código', () => {
    expect(urlFichaPorCodigo('7802950004892')).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/7802950004892\.json\?fields=/);
  });
});
