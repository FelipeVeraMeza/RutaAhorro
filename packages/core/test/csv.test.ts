import { describe, it, expect } from 'vitest';
import { aCSV, celdaCSV, nombreArchivoReporte } from '../src/csv.js';
import { parsearFilas, partirLinea } from '../src/import.js';

const SALTO = String.fromCharCode(10);
const RETORNO = String.fromCharCode(13);
const BOM = String.fromCharCode(0xfeff);

describe('celdaCSV', () => {
  it('el texto simple no se toca', () => {
    expect(celdaCSV('Coca-Cola')).toBe('Coca-Cola');
  });

  it('vacío y nulo salen como celda vacía', () => {
    expect(celdaCSV(null)).toBe('');
    expect(celdaCSV(undefined)).toBe('');
    expect(celdaCSV('')).toBe('');
  });

  it('un entero no gana decimales', () => {
    expect(celdaCSV(2290)).toBe('2290');
  });

  // Con configuración regional chilena, Excel lee "1234.5" como texto y la
  // columna deja de poder sumarse, que es lo primero que alguien intenta.
  it('un decimal va con coma, como espera Excel en Chile', () => {
    expect(celdaCSV(1.5)).toBe('1,5');
  });

  describe('entrecomilla lo que rompería la fila', () => {
    it('un punto y coma dentro del texto', () => {
      expect(celdaCSV('Pack 2; oferta')).toBe('"Pack 2; oferta"');
    });

    // El caso de mayor daño: un motivo de merma escrito en dos líneas partía
    // la fila en dos y corría todo el resto del archivo.
    it('un salto de línea', () => {
      expect(celdaCSV(`Vencido${SALTO}y dañado`)).toBe(`"Vencido${SALTO}y dañado"`);
    });

    it('una comilla, duplicándola', () => {
      expect(celdaCSV('Leche "premium"')).toBe('"Leche ""premium"""');
    });
  });
});

describe('aCSV', () => {
  interface Fila { nombre: string; unidades: number; total: number }
  const COLUMNAS = [
    { titulo: 'nombre', valor: (f: Fila) => f.nombre },
    { titulo: 'unidades', valor: (f: Fila) => f.unidades },
    { titulo: 'total', valor: (f: Fila) => f.total },
  ];

  it('empieza con BOM para que Excel muestre bien los acentos', () => {
    expect(aCSV([], COLUMNAS).startsWith(BOM)).toBe(true);
  });

  it('escribe el encabezado aunque no haya filas', () => {
    expect(aCSV([], COLUMNAS)).toBe(`${BOM}nombre;unidades;total${RETORNO}${SALTO}`);
  });

  it('escribe una fila por elemento', () => {
    const csv = aCSV([
      { nombre: 'Coca-Cola', unidades: 12, total: 27480 },
      { nombre: 'Leche', unidades: 30, total: 38700 },
    ], COLUMNAS);
    const lineas = csv.replace(BOM, '').trim().split(`${RETORNO}${SALTO}`);
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toBe('Coca-Cola;12;27480');
  });

  it('separa con punto y coma: con coma, Excel en español abre todo en una columna', () => {
    expect(aCSV([{ nombre: 'A', unidades: 1, total: 2 }], COLUMNAS)).toContain('A;1;2');
  });

  // La prueba que cierra el círculo: lo que exportamos se puede volver a leer.
  it('lo exportado se puede volver a importar sin perder nada', () => {
    const csv = aCSV(
      [{ nombre: 'Pack 2; oferta', unidades: 3, total: 5970 }],
      [
        { titulo: 'nombre', valor: (f: Fila) => f.nombre },
        { titulo: 'precio_venta', valor: (f: Fila) => f.total },
      ],
    );
    const matriz = csv
      .replace(BOM, '')
      .split(`${RETORNO}${SALTO}`)
      .filter((l) => l !== '')
      .map((l) => partirLinea(l, ';'));
    const r = parsearFilas(matriz);
    expect(r.ok).toBe(true);
    expect(r.filas[0].nombre).toBe('Pack 2; oferta');
  });
});

describe('nombreArchivoReporte', () => {
  it('sin acentos ni espacios: el archivo viaja por correo y por WhatsApp', () => {
    expect(nombreArchivoReporte('Ventas por período')).toBe('ventas-por-periodo.csv');
  });

  it('incluye el rango de fechas cuando lo hay', () => {
    expect(nombreArchivoReporte('Mermas', '2026-09-01', '2026-09-30'))
      .toBe('mermas-2026-09-01-a-2026-09-30.csv');
  });

  it('no deja guiones sueltos en los extremos', () => {
    expect(nombreArchivoReporte('  ¿Margen?  ')).toBe('margen.csv');
  });
});
