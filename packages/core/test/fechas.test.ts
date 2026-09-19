import { describe, it, expect } from 'vitest';
import { diaLocal, inicioDelDia, rangoDeDias, sumarDias, desfaseMinutos } from '../src/fechas.js';

const CL = 'America/Santiago';

describe('desfase de la zona', () => {
  it('Chile en invierno está a -04:00 y en verano a -03:00', () => {
    expect(desfaseMinutos(CL, new Date('2026-07-01T12:00:00Z'))).toBe(-240);
    expect(desfaseMinutos(CL, new Date('2026-12-01T12:00:00Z'))).toBe(-180);
  });
});

describe('día del local', () => {
  it('una venta de las 21:30 en Chile es de ese día, aunque en UTC ya sea mañana', () => {
    // 21:30 de invierno en Santiago = 01:30 UTC del día siguiente.
    expect(diaLocal('2026-07-15T01:30:00Z', CL)).toBe('2026-07-14');
  });

  it('Isla de Pascua va dos horas atrás del continente', () => {
    expect(diaLocal('2026-09-11T03:30:00Z', 'Pacific/Easter')).toBe('2026-09-10');
    expect(diaLocal('2026-09-11T03:30:00Z', CL)).toBe('2026-09-11');
  });
});

describe('inicio del día', () => {
  it('en invierno, medianoche de Chile son las 04:00 UTC', () => {
    expect(inicioDelDia('2026-07-14', CL)).toBe('2026-07-14T04:00:00.000Z');
  });

  it('en verano, las 03:00 UTC', () => {
    expect(inicioDelDia('2026-12-14', CL)).toBe('2026-12-14T03:00:00.000Z');
  });

  it('el día del cambio a verano, cuando la medianoche no existe, empieza a la 01:00', () => {
    // 2026-09-06: el reloj salta de 23:59:59 a 01:00.
    const inicio = inicioDelDia('2026-09-06', CL);
    expect(diaLocal(inicio, CL)).toBe('2026-09-06');
    expect(diaLocal(new Date(new Date(inicio).getTime() - 1), CL)).toBe('2026-09-05');
  });

  it('el día del cambio a invierno empieza en la primera medianoche', () => {
    const inicio = inicioDelDia('2026-04-05', CL);
    expect(diaLocal(inicio, CL)).toBe('2026-04-05');
    expect(diaLocal(new Date(new Date(inicio).getTime() - 1), CL)).toBe('2026-04-04');
  });
});

describe('rango de días', () => {
  it('"hoy" cubre desde la medianoche local hasta la siguiente, sin perder la noche', () => {
    const r = rangoDeDias('2026-07-14', '2026-07-14', CL);
    expect(r).toEqual({ desde: '2026-07-14T04:00:00.000Z', hasta: '2026-07-15T04:00:00.000Z' });
    const ventaNocturna = '2026-07-15T01:30:00.000Z'; // 21:30 del 14 en Chile
    expect(ventaNocturna >= r.desde && ventaNocturna < r.hasta).toBe(true);
  });

  it('sumar días cruza meses y años', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
});
