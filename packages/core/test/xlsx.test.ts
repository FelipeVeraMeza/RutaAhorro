import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  leerXlsx, columnaDesdeRef, fechaDesdeSerie, ErrorPlanilla,
} from '../src/xlsx.js';
import { parsearProductos } from '../src/import.js';

/**
 * Los archivos de prueba no los genera este lector: los genera openpyxl, que
 * escribe el mismo formato que Excel. Probar un lector contra un escritor
 * propio no prueba nada —los dos pueden estar equivocados igual—.
 */
function fixture(nombre: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, 'fixtures', nombre)));
}

describe('columnaDesdeRef', () => {
  it('la primera columna es la cero', () => {
    expect(columnaDesdeRef('A1')).toBe(0);
  });

  it('la Z es la 25', () => {
    expect(columnaDesdeRef('Z9')).toBe(25);
  });

  it('pasa a dos letras después de la Z', () => {
    expect(columnaDesdeRef('AA1')).toBe(26);
    expect(columnaDesdeRef('AB1')).toBe(27);
  });

  it('aguanta tres letras', () => {
    expect(columnaDesdeRef('BC12')).toBe(54);
    expect(columnaDesdeRef('XFD1')).toBe(16_383);  // la última de Excel
  });
});

describe('fechaDesdeSerie', () => {
  // Excel cree que 1900 fue bisiesto. Si el ancla fuera el 01/01/1900, todas
  // estas saldrían corridas un día.
  it('el día 1 es el 01/01/1900', () => {
    expect(fechaDesdeSerie(1)).toBe('1900-01-01');
  });

  it('convierte una fecha actual', () => {
    expect(fechaDesdeSerie(46_096)).toBe('2026-03-15');
  });

  it('descarta la hora y deja el día', () => {
    expect(fechaDesdeSerie(46_096.75)).toBe('2026-03-15');
  });

  it('el 28 de febrero de 1900 es el último día antes del fantasma', () => {
    expect(fechaDesdeSerie(59)).toBe('1900-02-28');
  });

  it('el día 61 es el 01/03/1900: entre medio está el 29 que no existió', () => {
    expect(fechaDesdeSerie(61)).toBe('1900-03-01');
  });
});

describe('leerXlsx', () => {
  describe('planilla de productos normal', () => {
    it('lee el encabezado y las tres filas', async () => {
      const { filas } = await leerXlsx(fixture('productos-basico.xlsx'));
      expect(filas).toHaveLength(4);
      expect(filas[0][0]).toBe('nombre');
      expect(filas[0][10]).toBe('dias_alerta');
    });

    it('lee los textos, que Excel guarda en una tabla aparte', async () => {
      const { filas } = await leerXlsx(fixture('productos-basico.xlsx'));
      expect(filas[1][0]).toBe('Coca-Cola 1.5L');
      expect(filas[2][0]).toBe('Leche entera 1 L');
    });

    it('lee los números como texto, para que los valide quien ya sabe', async () => {
      const { filas } = await leerXlsx(fixture('productos-basico.xlsx'));
      expect(filas[1][4]).toBe('2290');
      expect(filas[1][5]).toBe('1650');
    });

    it('conserva el código de barra completo, sin notación científica', async () => {
      const { filas } = await leerXlsx(fixture('productos-basico.xlsx'));
      expect(filas[1][2]).toBe('7801234567890');
    });

    it('dice qué hoja leyó', async () => {
      const { hoja, totalHojas } = await leerXlsx(fixture('productos-basico.xlsx'));
      expect(hoja).toBe('Productos');
      expect(totalHojas).toBe(1);
    });

    // La prueba que importa: el .xlsx entra por el mismo validador que el CSV.
    it('lo que sale se puede validar con parsearProductos', async () => {
      const { filas } = await leerXlsx(fixture('productos-basico.xlsx'));
      const r = parsearProductos(filas.map((f) => f.join(';')).join('\n'));
      expect(r.ok).toBe(true);
      expect(r.filas).toHaveLength(3);
      expect(r.filas[0].nombre).toBe('Coca-Cola 1.5L');
      expect(r.filas[0].precio_venta).toBe(2290);
      expect(r.filas[1].perecible).toBe(true);
    });
  });

  describe('lo que rompe a los lectores ingenuos', () => {
    it('una celda vacía al medio no corre las demás de columna', async () => {
      const { filas } = await leerXlsx(fixture('productos-dificil.xlsx'));
      // B2 está vacía: el código de barra tiene que quedar en C, no en B.
      expect(filas[1][1]).toBe('');
      expect(filas[1][2]).toBe('7803456789012');
      expect(filas[1][4]).toBe('3490');
    });

    it('una fila en blanco al medio conserva el número de fila', async () => {
      const { filas } = await leerXlsx(fixture('productos-dificil.xlsx'));
      expect(filas[2]).toEqual([]);
      expect(filas[3][0]).toBe('Azúcar 1 kg');
    });

    it('desescapa los caracteres que en XML van escritos de otra forma', async () => {
      const { filas } = await leerXlsx(fixture('productos-dificil.xlsx'));
      expect(filas[1][0]).toBe('Café ñandú <premium> & "especial"');
    });

    it('conserva los decimales tal como están', async () => {
      const { filas } = await leerXlsx(fixture('productos-dificil.xlsx'));
      expect(filas[3][4]).toBe('1190.5');
    });

    it('convierte una fecha de Excel a algo legible', async () => {
      const { filas } = await leerXlsx(fixture('productos-dificil.xlsx'));
      expect(filas[4][1]).toBe('2026-03-15');
    });

    it('un booleano sale como sí o no, que es lo que espera la columna perecible', async () => {
      const { filas } = await leerXlsx(fixture('productos-dificil.xlsx'));
      expect(filas[5][0]).toBe('si');
    });

    it('un nombre de hoja con ñ y comillas no rompe nada', async () => {
      const { hoja } = await leerXlsx(fixture('productos-dificil.xlsx'));
      expect(hoja).toBe('Hoja ñ & "rara"');
    });
  });

  describe('libro con varias hojas', () => {
    it('lee la primera y avisa cuántas hay', async () => {
      const { filas, hoja, totalHojas } = await leerXlsx(fixture('multi-hoja.xlsx'));
      expect(hoja).toBe('Catálogo');
      expect(totalHojas).toBe(2);
      expect(filas[1][0]).toBe('Producto de la primera hoja');
    });
  });

  describe('archivos que no sirven', () => {
    it('una hoja vacía devuelve cero filas, no un error', async () => {
      const { filas } = await leerXlsx(fixture('vacio.xlsx'));
      expect(filas).toEqual([]);
    });

    it('rechaza un .xls antiguo diciendo qué hacer', async () => {
      // D0 CF 11 E0 es la firma del formato binario de 1997.
      const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
      await expect(leerXlsx(xls)).rejects.toThrow(ErrorPlanilla);
      await expect(leerXlsx(xls)).rejects.toThrow(/Guardar como/);
    });

    it('rechaza un archivo que no es planilla', async () => {
      const texto = new TextEncoder().encode('nombre;precio_venta\nCoca-Cola;990');
      await expect(leerXlsx(texto)).rejects.toThrow(/no es una planilla/);
    });

    it('rechaza un archivo vacío sin reventar', async () => {
      await expect(leerXlsx(new Uint8Array(0))).rejects.toThrow(ErrorPlanilla);
    });

    it('avisa cuando el archivo está truncado en vez de leer basura', async () => {
      const entero = fixture('productos-basico.xlsx');
      await expect(leerXlsx(entero.subarray(0, Math.floor(entero.length / 2))))
        .rejects.toThrow(ErrorPlanilla);
    });
  });
});
