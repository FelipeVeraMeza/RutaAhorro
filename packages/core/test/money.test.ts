import { describe, it, expect } from 'vitest';
import {
  clp, formatCLP, parseCLP, taxIncluded, netAmount,
  margin, marginPct, change,
} from '../src/money.js';

describe('clp', () => {
  it('redondea al entero más cercano', () => {
    expect(clp(1990.4)).toBe(1990);
    expect(clp(1990.5)).toBe(1991);
    expect(clp(1990)).toBe(1990);
  });

  it('redondea simétricamente en negativos', () => {
    // Un faltante de caja de -2000.5 debe dar -2001, no -2000.
    // Math.round(-2000.5) daría -2000 y el arqueo mostraría $1 de menos.
    expect(clp(-2000.5)).toBe(-2001);
    expect(clp(-2000.4)).toBe(-2000);
  });

  it('no explota con valores no finitos', () => {
    expect(clp(NaN)).toBe(0);
    expect(clp(Infinity)).toBe(0);
  });
});

describe('formatCLP', () => {
  it('usa formato chileno sin decimales', () => {
    expect(formatCLP(12990)).toBe('$12.990');
    expect(formatCLP(1000000)).toBe('$1.000.000');
    expect(formatCLP(0)).toBe('$0');
  });

  it('no deja espacios duros que rompan el diseño móvil', () => {
    expect(formatCLP(7450)).not.toMatch(/ /);
  });
});

describe('parseCLP', () => {
  it('lee montos escritos de varias formas', () => {
    expect(parseCLP('$12.990')).toBe(12990);
    expect(parseCLP('12990')).toBe(12990);
    expect(parseCLP('12.990')).toBe(12990);
  });

  it('devuelve null cuando no hay número', () => {
    expect(parseCLP('')).toBeNull();
    expect(parseCLP('abc')).toBeNull();
  });
});

describe('IVA', () => {
  it('extrae el IVA contenido en un precio que ya lo incluye', () => {
    // $11.900 con IVA incluido => neto $10.000, IVA $1.900
    expect(taxIncluded(11900)).toBe(1900);
    expect(netAmount(11900)).toBe(10000);
  });

  it('neto + IVA siempre reconstruye el bruto', () => {
    for (const gross of [1, 999, 1990, 7450, 12990, 123457]) {
      expect(netAmount(gross) + taxIncluded(gross)).toBe(gross);
    }
  });
});

describe('margen', () => {
  it('calcula margen en pesos', () => {
    expect(margin(1990, 1200)).toBe(790);
  });

  it('calcula el porcentaje sobre el PRECIO DE VENTA, no sobre el costo', () => {
    // 790/1990 = 39,7 %. Sobre el costo daría 65,8 %, que no es la convención.
    expect(marginPct(1990, 1200)).toBe(39.7);
  });

  it('no divide por cero', () => {
    expect(marginPct(0, 1200)).toBe(0);
  });
});

describe('vuelto', () => {
  it('calcula el vuelto', () => {
    expect(change(10000, 7450)).toBe(2550);
  });

  it('nunca es negativo si el cliente paga de menos', () => {
    expect(change(5000, 7450)).toBe(0);
  });
});
