import { describe, it, expect } from 'vitest';
import {
  parsearProductos, parsearFilas, partirLinea, detectarSeparador, leerNumero, plantillaCSV,
} from '../src/import.js';

const ENC = 'nombre;sku;codigo_barras;categoria;precio_venta;costo;unidad;stock_inicial;stock_minimo;perecible;dias_alerta';

describe('lectura de números como los escribe una persona en Chile', () => {
  it('lee un entero simple', () => {
    expect(leerNumero('1990')).toBe(1990);
  });

  it('interpreta el punto como separador de miles, no decimal', () => {
    // "1.990" en Chile es mil novecientos noventa. Leerlo como 1,99 sería
    // cargar el catálogo completo con precios mil veces menores.
    expect(leerNumero('1.990')).toBe(1990);
    expect(leerNumero('12.345')).toBe(12345);
    expect(leerNumero('1.234.567')).toBe(1234567);
  });

  it('acepta la coma como decimal', () => {
    expect(leerNumero('1.234,56')).toBeCloseTo(1234.56);
    expect(leerNumero('0,5')).toBeCloseTo(0.5);
  });

  it('ignora el símbolo de peso y los espacios', () => {
    expect(leerNumero('$1.990')).toBe(1990);
    expect(leerNumero('  2490  ')).toBe(2490);
  });

  it('devuelve null si no hay número', () => {
    expect(leerNumero('')).toBeNull();
    expect(leerNumero('abc')).toBeNull();
  });
});

describe('separador del archivo', () => {
  it('detecta punto y coma, que es lo que exporta Excel en Chile', () => {
    expect(detectarSeparador('a;b;c\n1;2;3')).toBe(';');
  });

  it('detecta coma', () => {
    expect(detectarSeparador('a,b,c\n1,2,3')).toBe(',');
  });
});

describe('partir líneas', () => {
  it('respeta las comillas', () => {
    expect(partirLinea('"Arroz, grado 1";ARR;1590', ';'))
      .toEqual(['Arroz, grado 1', 'ARR', '1590']);
  });

  it('maneja comillas escapadas', () => {
    expect(partirLinea('"Bebida ""cola"" 1.5L";BEB', ';'))
      .toEqual(['Bebida "cola" 1.5L', 'BEB']);
  });

  it('respeta campos vacíos', () => {
    expect(partirLinea('a;;c', ';')).toEqual(['a', '', 'c']);
  });
});

describe('importación válida', () => {
  it('carga un archivo correcto', () => {
    const csv = [ENC,
      'Arroz 1 kg;ARR-1K;7801234000018;Abarrotes;1590;1100;unidad;40;10;no;30',
      'Leche 1 L;LEC-1L;7801234000056;Lácteos;1190;850;unidad;36;20;si;10',
    ].join('\n');

    const r = parsearProductos(csv);
    expect(r.ok).toBe(true);
    expect(r.errores).toHaveLength(0);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0].nombre).toBe('Arroz 1 kg');
    expect(r.filas[0].precio_venta).toBe(1590);
    expect(r.filas[1].perecible).toBe(true);
    expect(r.filas[1].dias_alerta).toBe(10);
  });

  it('acepta precios escritos con punto de miles', () => {
    const csv = [ENC, 'Aceite;ACE;;Abarrotes;2.490;1.850;unidad;10;5;no;30'].join('\n');
    const r = parsearProductos(csv);
    expect(r.ok).toBe(true);
    expect(r.filas[0].precio_venta).toBe(2490);
    expect(r.filas[0].costo).toBe(1850);
  });

  it('rellena valores por defecto cuando faltan columnas opcionales', () => {
    const r = parsearProductos(['nombre;precio_venta', 'Pan;2190'].join('\n'));
    expect(r.ok).toBe(true);
    expect(r.filas[0]).toMatchObject({
      costo: 0, unidad: 'unidad', stock_inicial: 0,
      stock_minimo: 0, perecible: false, dias_alerta: 30,
    });
  });

  it('ignora el BOM que agrega Excel', () => {
    const r = parsearProductos('﻿nombre;precio_venta\nPan;2190');
    expect(r.ok).toBe(true);
    expect(r.filas[0].nombre).toBe('Pan');
  });

  it('acepta archivos separados por coma', () => {
    const r = parsearProductos('nombre,precio_venta\nPan,2190');
    expect(r.ok).toBe(true);
    expect(r.filas[0].precio_venta).toBe(2190);
  });

  it('interpreta varias formas de decir que sí', () => {
    for (const v of ['si', 'Sí', 'SI', 'true', '1', 'x']) {
      const r = parsearProductos([
        'nombre;precio_venta;perecible', `Yogurt;590;${v}`,
      ].join('\n'));
      expect(r.filas[0].perecible, `valor "${v}"`).toBe(true);
    }
  });
});

describe('errores que impiden cargar', () => {
  it('rechaza el archivo si falta una columna obligatoria', () => {
    const r = parsearProductos('sku;costo\nARR;1100');
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.mensaje.includes('nombre'))).toBe(true);
    expect(r.errores.some((e) => e.mensaje.includes('precio_venta'))).toBe(true);
    expect(r.filas).toHaveLength(0);
  });

  it('rechaza un archivo vacío', () => {
    expect(parsearProductos('').ok).toBe(false);
  });

  it('detecta un precio no numérico e indica la fila de Excel', () => {
    // US-06: "la fila 45 tiene un precio no numérico"
    const csv = [ENC,
      'Arroz;ARR;;Abarrotes;1590;1100;unidad;40;10;no;30',
      'Fideos;FID;;Abarrotes;mil pesos;640;unidad;12;12;no;30',
    ].join('\n');

    const r = parsearProductos(csv);
    expect(r.ok).toBe(false);
    const err = r.errores.find((e) => e.columna === 'precio_venta');
    expect(err?.fila).toBe(3);      // encabezado = 1, Arroz = 2, Fideos = 3
    expect(err?.valor).toBe('mil pesos');
  });

  it('detecta un SKU repetido e indica con cuál choca', () => {
    const csv = [ENC,
      'Arroz;REP;;Abarrotes;1590;1100;unidad;40;10;no;30',
      'Fideos;REP;;Abarrotes;990;640;unidad;12;12;no;30',
    ].join('\n');

    const r = parsearProductos(csv);
    expect(r.ok).toBe(false);
    const err = r.errores.find((e) => e.columna === 'sku');
    expect(err?.fila).toBe(3);
    expect(err?.mensaje).toContain('fila 2');
  });

  it('detecta un código de barras repetido', () => {
    const csv = [ENC,
      'Arroz;A;7801234000018;Abarrotes;1590;1100;unidad;40;10;no;30',
      'Fideos;B;7801234000018;Abarrotes;990;640;unidad;12;12;no;30',
    ].join('\n');

    const r = parsearProductos(csv);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.columna === 'codigo_barras')).toBe(true);
  });

  it('rechaza precios y stock negativos', () => {
    const csv = [ENC,
      'Malo;M;;Abarrotes;-500;100;unidad;-3;0;no;30',
    ].join('\n');
    const r = parsearProductos(csv);
    expect(r.ok).toBe(false);
    expect(r.errores.filter((e) => e.mensaje.includes('negativ')).length).toBeGreaterThanOrEqual(2);
  });

  it('nombre vacío invalida la fila', () => {
    const r = parsearProductos([ENC, ';SKU;;Cat;1000;500;unidad;1;1;no;30'].join('\n'));
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.columna === 'nombre')).toBe(true);
  });

  it('NO carga NADA si alguna fila falla (todo o nada)', () => {
    // US-06: "NO se carga ningún producto hasta que corrija el archivo"
    const csv = [ENC,
      'Bueno 1;B1;;Cat;1000;500;unidad;5;1;no;30',
      'Malo;;;Cat;no es precio;500;unidad;5;1;no;30',
      'Bueno 2;B2;;Cat;2000;900;unidad;5;1;no;30',
    ].join('\n');

    const r = parsearProductos(csv);
    expect(r.ok).toBe(false);
    // Las filas buenas se parsean para poder mostrar la vista previa, pero
    // `ok:false` es lo que impide aplicar la carga.
    expect(r.filas).toHaveLength(2);
    expect(r.errores).toHaveLength(1);
  });

  it('reporta todos los errores de una vez, no solo el primero', () => {
    // Corregir de a un error por intento con 800 productos es inaceptable.
    const csv = [ENC,
      'A;;;Cat;malo;500;unidad;1;1;no;30',
      'B;;;Cat;1000;malo;unidad;1;1;no;30',
      ';;;Cat;1000;500;unidad;1;1;no;30',
    ].join('\n');

    const r = parsearProductos(csv);
    expect(r.errores.length).toBe(3);
    expect(r.errores.map((e) => e.fila).sort()).toEqual([2, 3, 4]);
  });
});

describe('avisos que no impiden cargar', () => {
  it('avisa si el precio es menor al costo, pero deja cargar', () => {
    const csv = [ENC, 'Invertido;INV;;Cat;500;1500;unidad;5;1;no;30'].join('\n');
    const r = parsearProductos(csv);
    expect(r.ok).toBe(true);
    expect(r.avisos.some((a) => a.mensaje.includes('menor al costo'))).toBe(true);
  });

  it('avisa si el dígito de control del código no cuadra', () => {
    const csv = [ENC, 'Malcopiado;MC;4006381333932;Cat;1000;500;unidad;5;1;no;30'].join('\n');
    const r = parsearProductos(csv);
    expect(r.ok).toBe(true);   // no bloquea: hay comercios con códigos propios
    expect(r.avisos.some((a) => a.columna === 'codigo_barras')).toBe(true);
  });

  it('avisa y corrige una unidad no reconocida', () => {
    const csv = [ENC, 'Raro;R;;Cat;1000;500;bidones;5;1;no;30'].join('\n');
    const r = parsearProductos(csv);
    expect(r.ok).toBe(true);
    expect(r.filas[0].unidad).toBe('unidad');
    expect(r.avisos.some((a) => a.columna === 'unidad')).toBe(true);
  });
});

describe('plantilla de ejemplo', () => {
  it('la plantilla que se entrega al cliente se importa sin errores', () => {
    // Si la plantilla no pasa su propia validación, el cliente queda atrapado.
    const r = parsearProductos(plantillaCSV());
    expect(r.ok).toBe(true);
    expect(r.errores).toHaveLength(0);
    expect(r.avisos).toHaveLength(0);
    expect(r.filas).toHaveLength(3);
  });

  it('incluye BOM para que Excel muestre bien los acentos', () => {
    expect(plantillaCSV().startsWith('﻿')).toBe(true);
  });
});

describe('escala', () => {
  it('procesa 1.000 productos sin problemas', () => {
    const filas = [ENC];
    for (let i = 1; i <= 1000; i++) {
      filas.push(`Producto ${i};SKU-${i};;Cat;${1000 + i};${500 + i};unidad;10;5;no;30`);
    }
    const inicio = Date.now();
    const r = parsearProductos(filas.join('\n'));
    const ms = Date.now() - inicio;

    expect(r.ok).toBe(true);
    expect(r.filas).toHaveLength(1000);
    expect(ms).toBeLessThan(1000);
  });
});

describe('parsearFilas — el camino que comparten el CSV y el Excel', () => {
  const ENCABEZADO = ['nombre', 'sku', 'precio_venta'];

  it('valida una matriz sin pasar por texto', () => {
    const r = parsearFilas([ENCABEZADO, ['Coca-Cola 1.5L', 'CC15', '2290']]);
    expect(r.ok).toBe(true);
    expect(r.filas[0].nombre).toBe('Coca-Cola 1.5L');
    expect(r.filas[0].precio_venta).toBe(2290);
  });

  // Un punto y coma dentro de una celda de Excel es un nombre de producto
  // normal. Si el .xlsx se convirtiera a CSV para reusar el otro camino, esa
  // celda partiría la fila en dos.
  it('un punto y coma dentro de una celda no parte la fila', () => {
    const r = parsearFilas([ENCABEZADO, ['Pack 2; oferta', 'P2', '1990']]);
    expect(r.ok).toBe(true);
    expect(r.filas[0].nombre).toBe('Pack 2; oferta');
  });

  it('una celda con salto de línea tampoco', () => {
    const r = parsearFilas([ENCABEZADO, ['Jabón' + String.fromCharCode(10) + 'líquido', 'J1', '990']]);
    expect(r.ok).toBe(true);
    expect(r.filas).toHaveLength(1);
  });

  it('acepta encabezados con mayúsculas y espacios de más', () => {
    const r = parsearFilas([['  Nombre ', 'PRECIO_VENTA'], ['Azúcar', '1190']]);
    expect(r.ok).toBe(true);
    expect(r.filas[0].nombre).toBe('Azúcar');
  });

  it('una matriz vacía avisa que el archivo está vacío', () => {
    expect(parsearFilas([]).errores[0].mensaje).toMatch(/vacío/);
    expect(parsearFilas([[], ['', '  ']]).errores[0].mensaje).toMatch(/vacío/);
  });
});

describe('numeración de filas', () => {
  // El usuario abre su planilla, va a la fila que dice el error y tiene que
  // encontrar ahí el producto del que le hablamos. Antes las líneas en blanco
  // se descartaban ANTES de numerar y todos los números salían corridos.
  it('una línea en blanco al medio no corre el número de las siguientes', () => {
    const r = parsearProductos([ENC, 'Bueno;B1;;;1000;;;;;;', '', 'Malo;M1;;;no-es-precio;;;;;;'].join(String.fromCharCode(10)));
    expect(r.errores[0].fila).toBe(4);
  });

  it('en una matriz pasa lo mismo', () => {
    const r = parsearFilas([
      ['nombre', 'precio_venta'],
      ['Bueno', '1000'],
      [],
      ['Malo', 'no-es-precio'],
    ]);
    expect(r.errores[0].fila).toBe(4);
  });

  it('las filas en blanco no se cuentan como productos', () => {
    const r = parsearFilas([
      ['nombre', 'precio_venta'],
      ['Uno', '1000'],
      [],
      ['Dos', '2000'],
    ]);
    expect(r.ok).toBe(true);
    expect(r.filas).toHaveLength(2);
  });
});

describe('columna descripcion', () => {
  const ENCABEZADO = ['nombre', 'descripcion', 'precio_venta'];

  it('se lee cuando viene', () => {
    const r = parsearFilas([ENCABEZADO, ['Leche entera 1 L', 'Leche entera, caja de 1 litro', '1190']]);
    expect(r.ok).toBe(true);
    expect(r.filas[0].descripcion).toBe('Leche entera, caja de 1 litro');
  });

  it('es opcional: sin ella la fila sigue siendo válida', () => {
    const r = parsearFilas([['nombre', 'precio_venta'], ['Leche entera 1 L', '1190']]);
    expect(r.ok).toBe(true);
    expect(r.filas[0].descripcion).toBeNull();
  });

  it('vacía queda en nulo, no en cadena vacía', () => {
    const r = parsearFilas([ENCABEZADO, ['Leche', '   ', '1190']]);
    expect(r.filas[0].descripcion).toBeNull();
  });

  it('la plantilla la incluye con un ejemplo', () => {
    const lineas = plantillaCSV().split(String.fromCharCode(13) + String.fromCharCode(10));
    expect(lineas[0]).toContain('descripcion');
    expect(lineas[1]).toContain('bolsa de 1 kilo');
  });
});

describe('celdas con solo espacios', () => {
  // Importa más desde que se leen planillas de Excel: una celda con espacios
  // se ve igual que una vacía, y sin recortar entraba como texto.
  it('una categoría de puros espacios no crea una categoría', () => {
    const r = parsearFilas([
      ['nombre', 'categoria', 'precio_venta'],
      ['Leche', '   ', '1190'],
    ]);
    expect(r.filas[0].categoria).toBeNull();
  });

  it('un sku de puros espacios queda en nulo', () => {
    const r = parsearFilas([
      ['nombre', 'sku', 'precio_venta'],
      ['Leche', '  ', '1190'],
    ]);
    expect(r.filas[0].sku).toBeNull();
  });
});
