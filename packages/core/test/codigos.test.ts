import { describe, it, expect } from 'vitest';
import { planCodigos, codigosDesdeImportacion } from '../src/codigos.js';

describe('planCodigos', () => {
  describe('no pedir nada no es pedir nada', () => {
    it('sin definir, no toca los códigos', () => {
      const plan = planCodigos(['7801234567890'], undefined);
      expect(plan.tocar).toBe(false);
      expect(plan.quitar).toEqual([]);
      expect(plan.agregar).toEqual([]);
      expect(plan.finales).toEqual(['7801234567890']);
    });

    it('nulo tampoco los toca', () => {
      expect(planCodigos(['7801234567890'], null).tocar).toBe(false);
    });

    // Esta es la distinción que produjo el defecto: la carga masiva mandaba
    // lista vacía cuando quería decir "no sé nada de los códigos".
    it('la lista vacía sí los borra: es lo que pide quien vacía el formulario', () => {
      const plan = planCodigos(['7801234567890', '7809999999999'], []);
      expect(plan.tocar).toBe(true);
      expect(plan.quitar).toEqual(['7801234567890', '7809999999999']);
      expect(plan.finales).toEqual([]);
    });
  });

  describe('reconcilia por diferencia', () => {
    it('agrega solo lo que falta', () => {
      const plan = planCodigos(['111'], ['111', '222']);
      expect(plan.agregar).toEqual(['222']);
      expect(plan.quitar).toEqual([]);
    });

    it('quita solo lo que sobra', () => {
      const plan = planCodigos(['111', '222'], ['111']);
      expect(plan.quitar).toEqual(['222']);
      expect(plan.agregar).toEqual([]);
    });

    it('un código que no cambió no se borra ni se reinserta', () => {
      const plan = planCodigos(['111', '222'], ['222', '333']);
      expect(plan.agregar).toEqual(['333']);
      expect(plan.quitar).toEqual(['111']);
      expect(plan.agregar).not.toContain('222');
      expect(plan.quitar).not.toContain('222');
    });

    it('sin cambios, no hay nada que escribir', () => {
      const plan = planCodigos(['111', '222'], ['111', '222']);
      expect(plan.agregar).toEqual([]);
      expect(plan.quitar).toEqual([]);
      expect(plan.tocar).toBe(true);
    });

    it('reordenar cambia cuál es el principal, no cuáles existen', () => {
      const plan = planCodigos(['111', '222'], ['222', '111']);
      expect(plan.agregar).toEqual([]);
      expect(plan.quitar).toEqual([]);
      expect(plan.finales[0]).toBe('222');
    });
  });

  describe('limpia lo que escribe el usuario', () => {
    it('descarta vacíos y espacios', () => {
      expect(planCodigos([], ['  ', '', '111']).finales).toEqual(['111']);
    });

    it('recorta los espacios alrededor', () => {
      expect(planCodigos([], [' 111 ']).finales).toEqual(['111']);
    });

    it('un código pegado dos veces se guarda una', () => {
      expect(planCodigos([], ['111', '111']).finales).toEqual(['111']);
    });

    it('el mismo código con espacios no cuenta como cambio', () => {
      const plan = planCodigos(['111'], [' 111 ']);
      expect(plan.agregar).toEqual([]);
      expect(plan.quitar).toEqual([]);
    });

    it('un previo vacío no aparece como código a borrar', () => {
      expect(planCodigos(['', '111'], ['111']).quitar).toEqual([]);
    });
  });
});

describe('codigosDesdeImportacion', () => {
  // El caso que dejaba el catálogo invisible al escáner: la planilla de
  // precios del proveedor no trae columna de código de barra.
  it('sin código en la fila, no toca los códigos del producto', () => {
    expect(codigosDesdeImportacion(['7801234567890'], null)).toBeUndefined();
    expect(codigosDesdeImportacion(['7801234567890'], undefined)).toBeUndefined();
    expect(codigosDesdeImportacion(['7801234567890'], '')).toBeUndefined();
    expect(codigosDesdeImportacion(['7801234567890'], '   ')).toBeUndefined();
  });

  it('con código nuevo, lo suma a los que ya tenía', () => {
    expect(codigosDesdeImportacion(['111'], '222')).toEqual(['111', '222']);
  });

  it('el principal del producto no cambia porque la planilla traiga otro', () => {
    expect(codigosDesdeImportacion(['111'], '222')?.[0]).toBe('111');
  });

  it('con un código que ya tenía, no lo duplica', () => {
    expect(codigosDesdeImportacion(['111', '222'], '222')).toEqual(['111', '222']);
  });

  it('recorta el código de la planilla antes de compararlo', () => {
    expect(codigosDesdeImportacion(['111'], ' 111 ')).toEqual(['111']);
  });

  it('un producto sin códigos se queda con el de la planilla', () => {
    expect(codigosDesdeImportacion([], '111')).toEqual(['111']);
  });
});
