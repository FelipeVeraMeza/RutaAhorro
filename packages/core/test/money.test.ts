import { describe, it, expect } from 'vitest';
import {
  clp, formatCLP, parseCLP, taxIncluded, netAmount,
  margin, marginPct, margenNeto, margenNetoPct, change, formatPct, coincide, validarCantidadStock, validarMonto,
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

describe('formatPct', () => {
  it('coma decimal y espacio antes del signo', () => {
    expect(formatPct(25.7)).toBe('25,7 %');
    expect(formatPct(30)).toBe('30 %');
    expect(formatPct(-3.25)).toBe('-3,3 %');
  });
});

describe('RF-M2-20 · coincide sin tildes', () => {
  it('ignora tildes y mayúsculas en los dos lados', () => {
    expect(coincide('José Muñoz', 'jose')).toBe(true);
    expect(coincide('Azúcar · 1 kg', 'AZUCAR')).toBe(true);
    expect(coincide('Azucar', 'azúcar')).toBe(true);
    expect(coincide('Pan', 'queso')).toBe(false);
    expect(coincide(null, '')).toBe(true);
  });
});

describe('validarCantidadStock', () => {
  it('entera para lo que se cuenta, con decimales para lo que se pesa', () => {
    expect(validarCantidadStock('2,5', 'unidad').valido).toBe(false);
    expect(validarCantidadStock('3', 'unidad').valor).toBe(3);
    expect(validarCantidadStock('2,5', 'kg').valor).toBe(2.5);
    expect(validarCantidadStock('0', 'unidad').valido).toBe(true);
    expect(validarCantidadStock('', 'unidad', { permiteVacio: true }).valido).toBe(true);
  });
});

describe('validarMonto no adivina decimales ni miles mal puestos', () => {
  it('rechaza coma decimal y puntos que no separan miles', () => {
    expect(validarMonto('20000,5').valido).toBe(false);
    expect(validarMonto('1990,5').error).toMatch(/sin decimales/);
    expect(validarMonto('1.5').valido).toBe(false);
    expect(validarMonto('12abc').valido).toBe(false);
  });
  it('acepta lo que la gente escribe de verdad', () => {
    expect(validarMonto('1.990').valor).toBe(1990);
    expect(validarMonto('$ 1.990').valor).toBe(1990);
    expect(validarMonto('$5.000').valor).toBe(5000);
    expect(validarMonto('1990').valor).toBe(1990);
    expect(validarMonto('1.234.567').valor).toBe(1234567);
    expect(validarMonto(' 20 000 ').valor).toBe(20000);
  });
});

describe('margen con costo neto', () => {
  it('el ejemplo de docs/26 N° 13: $2.490 con costo neto $1.850 deja 11,6 %, no 25,7 %', () => {
    expect(marginPct(2490, 1850)).toBe(25.7);
    expect(margenNeto(2490, 1850)).toBe(242);
    expect(margenNetoPct(2490, 1850)).toBe(11.6);
  });
  it('sin costo, el margen es todo el neto; con precio 0, 0', () => {
    expect(margenNetoPct(1190, 0)).toBe(100);
    expect(margenNetoPct(0, 500)).toBe(0);
  });
  it('vender bajo el costo neto da negativo', () => {
    expect(margenNeto(1190, 1100)).toBe(-100);
    expect(margenNetoPct(1190, 1100)).toBeLessThan(0);
  });
});
