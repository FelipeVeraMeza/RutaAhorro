import { describe, it, expect } from 'vitest';
import { ConfirmadorLecturas, lecturasNecesarias } from '../src/barcode.js';

// El código del bon o bon blanco de la foto: 7802225640848.
const BONOBON = '7802225640848';

describe('lecturasNecesarias', () => {
  it('un EAN con su dígito de control bien pide 2 lecturas', () => {
    expect(lecturasNecesarias(BONOBON, 'ean_13')).toBe(2);
  });
  it('un EAN con el dígito de control malo se descarta', () => {
    expect(lecturasNecesarias('7802225640847', 'ean_13')).toBe(0);
  });
  it('los formatos que se inventan con un trozo de otro código piden 3', () => {
    expect(lecturasNecesarias('12345678', 'itf')).toBe(3);
    expect(lecturasNecesarias('ABC-123', 'code_128')).toBe(3);
    expect(lecturasNecesarias('ABC-123')).toBe(3);
  });
  it('vacío no es una lectura', () => {
    expect(lecturasNecesarias('  ')).toBe(0);
  });
});

describe('ConfirmadorLecturas', () => {
  it('no acepta la primera lectura: espera la segunda igual', () => {
    const c = new ConfirmadorLecturas();
    expect(c.registrar(BONOBON, 0, 'ean_13')).toBe(false);
    expect(c.registrar(BONOBON, 70, 'ean_13')).toBe(true);
  });
  it('una lectura distinta en medio reinicia la cuenta', () => {
    const c = new ConfirmadorLecturas();
    c.registrar(BONOBON, 0, 'ean_13');
    expect(c.registrar('7801620001643', 70, 'ean_13')).toBe(false);
    expect(c.registrar(BONOBON, 140, 'ean_13')).toBe(false);
    expect(c.registrar(BONOBON, 210, 'ean_13')).toBe(true);
  });
  it('mientras el producto sigue en cuadro no se vuelve a sumar', () => {
    const c = new ConfirmadorLecturas();
    const confirmadas = [0, 70, 140, 210, 280, 350, 2000, 2070].filter((t) => c.registrar(BONOBON, t, 'ean_13'));
    // 70: primera confirmación. 2000: salió de cuadro (más de 700 ms) y volvió.
    expect(confirmadas).toEqual([70, 2070]);
  });
  it('dos lecturas separadas por más de la ventana no confirman', () => {
    const c = new ConfirmadorLecturas(700);
    c.registrar(BONOBON, 0, 'ean_13');
    expect(c.registrar(BONOBON, 900, 'ean_13')).toBe(false);
  });
  it('las lecturas descartadas no cuentan ni rompen la racha', () => {
    const c = new ConfirmadorLecturas();
    c.registrar(BONOBON, 0, 'ean_13');
    expect(c.registrar('7802225640847', 50, 'ean_13')).toBe(false);
    expect(c.registrar(BONOBON, 100, 'ean_13')).toBe(true);
  });
});
