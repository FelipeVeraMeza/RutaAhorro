import { describe, it, expect } from 'vitest';
import { validarCantidadVenta, admiteDecimales, formatCantidad, validarCantidadStock, validarCantidad } from '../src/money.js';

// Hallazgo 4 del flujo completo (2026-09-28): para 20 panes había que tocar
// "+" 19 veces, y un producto por kilo no admitía 0,35.
describe('validarCantidadVenta', () => {
  it('un producto por unidad acepta enteros escritos', () => {
    expect(validarCantidadVenta('20', 'unidad')).toEqual({ valido: true, valor: 20, error: null });
    expect(validarCantidadVenta(' 3 ', 'paquete').valor).toBe(3);
  });

  it('un producto por unidad NO acepta fracciones', () => {
    const r = validarCantidadVenta('1,5', 'unidad');
    expect(r.valido).toBe(false);
    expect(r.error).toMatch(/entero/);
    expect(validarCantidadVenta('2.5', 'caja').valido).toBe(false);
    // Sin unidad conocida, se cuenta entero: es lo prudente.
    expect(validarCantidadVenta('0,5', null).valido).toBe(false);
  });

  it('kg, gramo, litro y ml aceptan decimales con coma o punto', () => {
    expect(validarCantidadVenta('0,35', 'kg')).toEqual({ valido: true, valor: 0.35, error: null });
    expect(validarCantidadVenta('1.5', 'litro').valor).toBe(1.5);
    expect(validarCantidadVenta('250', 'gramo').valor).toBe(250);
    expect(validarCantidadVenta('0,125', 'ml').valor).toBe(0.125);
  });

  it('hasta 3 decimales, que es lo que guarda la base', () => {
    const r = validarCantidadVenta('0,1255', 'kg');
    expect(r.valido).toBe(false);
    expect(r.error).toMatch(/3 decimales/);
  });

  it('el valor queda limpio de errores de coma flotante', () => {
    // 0,35 × 1000 es 349,99999999999994 en coma flotante.
    expect(validarCantidadVenta('0,35', 'kg').valor * 1000).toBe(350);
  });

  it('cero, vacío, negativos y basura se rechazan', () => {
    for (const t of ['0', '', '-2', 'abc', ',']) {
      expect(validarCantidadVenta(t, 'kg').valido, `"${t}"`).toBe(false);
    }
  });

  it('tiene un máximo, para que un dedo de más no venda 2.000.000', () => {
    expect(validarCantidadVenta('2000000', 'unidad').valido).toBe(false);
    expect(validarCantidadVenta('50', 'unidad', 40).valido).toBe(false);
  });
});

describe('admiteDecimales', () => {
  it('solo lo que se pesa o se mide', () => {
    expect(['kg', 'gramo', 'litro', 'ml', ' KG '].map(admiteDecimales)).toEqual([true, true, true, true, true]);
    expect(['unidad', 'paquete', 'caja', '', null, undefined].map(admiteDecimales)).toEqual([false, false, false, false, false, false]);
  });
});

describe('formatCantidad', () => {
  it('coma decimal, sin ceros de más ni separador de miles', () => {
    expect(formatCantidad(0.35)).toBe('0,35');
    expect(formatCantidad(20)).toBe('20');
    expect(formatCantidad(1.5)).toBe('1,5');
    expect(formatCantidad(1234.125)).toBe('1234,125');
    expect(formatCantidad(Number.NaN)).toBe('0');
  });
});

describe('cantidades como se escriben en Chile (revisión 2026-10-11)', () => {
  it('"1.000" de algo que se cuenta entero son mil, no uno', () => {
    expect(validarCantidadVenta('1.000', 'unidad').valor).toBe(1000);
    expect(validarCantidadStock('1.000', 'unidad').valor).toBe(1000);
    expect(validarCantidadStock('12.500', 'unidad').valor).toBe(12500);
  });
  it('lo que se pesa sigue con punto o coma decimal', () => {
    expect(validarCantidadVenta('1.5', 'litro').valor).toBe(1.5);
    expect(validarCantidadVenta('0,350', 'kg').valor).toBe(0.35);
  });
  it('"1e2" o "0x10" no son cantidades', () => {
    expect(validarCantidadStock('1e2', 'unidad').valido).toBe(false);
    expect(validarCantidadVenta('0x10', 'unidad').valido).toBe(false);
    expect(validarCantidad('1e3').valido).toBe(false);
  });
  it('"2.0" sigue siendo 2 y "1.5" de algo entero sigue rechazado', () => {
    expect(validarCantidadStock('2.0', 'unidad').valor).toBe(2);
    expect(validarCantidadVenta('1.5', 'unidad').valido).toBe(false);
  });
});
