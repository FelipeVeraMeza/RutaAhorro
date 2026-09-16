import { describe, it, expect } from 'vitest';
import { validarMonto, validarCantidad } from '../src/money.js';

describe('validarMonto', () => {
  it('acepta un monto normal escrito con formato chileno', () => {
    expect(validarMonto('12.990')).toEqual({ valido: true, valor: 12990, error: null });
    expect(validarMonto('$5.000')).toEqual({ valido: true, valor: 5000, error: null });
    expect(validarMonto('3000')).toEqual({ valido: true, valor: 3000, error: null });
  });

  it('RECHAZA negativos', () => {
    // Es el motivo por el que existe esta función: `parseCLP` los acepta, y un
    // "ingreso" de caja de −500 entra como egreso encubierto.
    const r = validarMonto('-500');
    expect(r.valido).toBe(false);
    expect(r.valor).toBe(0);
    expect(r.error).toBe('El monto no puede ser negativo');
  });

  it('rechaza un negativo escrito con formato', () => {
    expect(validarMonto('-1.500').valido).toBe(false);
    expect(validarMonto('$-200').valido).toBe(false);
  });

  it('exige el campo por defecto y lo permite vacío si se pide', () => {
    expect(validarMonto('')).toEqual({ valido: false, valor: 0, error: 'Escribe el monto' });
    expect(validarMonto('   ')).toEqual({ valido: false, valor: 0, error: 'Escribe el monto' });
    expect(validarMonto('', { permiteVacio: true })).toEqual({ valido: true, valor: 0, error: null });
  });

  it('acepta cero por defecto y lo rechaza cuando no corresponde', () => {
    expect(validarMonto('0').valido).toBe(true);
    const r = validarMonto('0', { permiteCero: false });
    expect(r.valido).toBe(false);
    expect(r.error).toBe('El monto tiene que ser mayor que cero');
  });

  it('avisa cuando el texto no tiene ningún número', () => {
    const r = validarMonto('abc');
    expect(r.valido).toBe(false);
    expect(r.error).toBe('El monto tiene que ser un número');
  });

  it('atája un cero de más con el tope', () => {
    const r = validarMonto('5.000.000', { maximo: 1_000_000 });
    expect(r.valido).toBe(false);
    expect(r.error).toContain('máximo');
    expect(validarMonto('900.000', { maximo: 1_000_000 }).valido).toBe(true);
  });

  it('usa la etiqueta del campo en el mensaje', () => {
    expect(validarMonto('', { etiqueta: 'efectivo inicial' }).error)
      .toBe('Escribe el efectivo inicial');
    expect(validarMonto('-1', { etiqueta: 'efectivo contado' }).error)
      .toBe('El efectivo contado no puede ser negativo');
  });

  it('nunca devuelve un valor distinto de cero cuando es inválido', () => {
    for (const entrada of ['-500', 'abc', '', '-0.01']) {
      const r = validarMonto(entrada);
      if (!r.valido) expect(r.valor).toBe(0);
    }
  });
});

describe('validarCantidad', () => {
  it('acepta enteros y decimales, porque hay venta por peso', () => {
    expect(validarCantidad('12')).toEqual({ valido: true, valor: 12, error: null });
    expect(validarCantidad('0.5')).toEqual({ valido: true, valor: 0.5, error: null });
    expect(validarCantidad('1,25')).toEqual({ valido: true, valor: 1.25, error: null });
  });

  it('RECHAZA cantidades negativas', () => {
    const r = validarCantidad('-5');
    expect(r.valido).toBe(false);
    expect(r.error).toBe('La cantidad no puede ser negativa');
  });

  it('permite cero: contar cero es un resultado válido de una toma', () => {
    expect(validarCantidad('0').valido).toBe(true);
  });

  it('rechaza cero cuando el campo no lo admite', () => {
    expect(validarCantidad('0', { permiteCero: false }).error)
      .toBe('La cantidad tiene que ser mayor que cero');
  });

  it('distingue vacío de cero', () => {
    expect(validarCantidad('').valido).toBe(false);
    expect(validarCantidad('', { permiteVacio: true })).toEqual({ valido: true, valor: 0, error: null });
  });

  it('rechaza texto que no es número', () => {
    expect(validarCantidad('dos').error).toBe('La cantidad tiene que ser un número');
  });

  it('respeta el tope', () => {
    expect(validarCantidad('5000', { maximo: 1000 }).valido).toBe(false);
  });
});
