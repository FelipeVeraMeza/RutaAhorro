import { describe, it, expect } from 'vitest';
import { modulosEan13, etiquetaSvg, MODULOS_EAN13 } from '../src/etiqueta.js';
import { generateInternalBarcode } from '../src/barcode.js';

// Un código válido cualquiera, generado por la misma función que usa el
// sistema para los productos sin código de fábrica.
const CODIGO = generateInternalBarcode(1);

describe('tablas de codificación', () => {
  // Estas tres relaciones son las que validan que las tablas estén bien
  // transcritas. Si alguien se equivoca en un dígito al copiarlas, una de las
  // tres se cae — y el error sería invisible hasta que un lector real no
  // enganchara la etiqueta impresa.
  const L = [
    '0001101', '0011001', '0010011', '0111101', '0100011',
    '0110001', '0101111', '0111011', '0110111', '0001011',
  ];
  const G = [
    '0100111', '0110011', '0011011', '0100001', '0011101',
    '0111001', '0000101', '0010001', '0001001', '0010111',
  ];
  const R = [
    '1110010', '1100110', '1101100', '1000010', '1011100',
    '1001110', '1010000', '1000100', '1001000', '1110100',
  ];

  it('R es el complemento bit a bit de L', () => {
    for (let d = 0; d < 10; d++) {
      const complemento = [...L[d]].map((b) => (b === '0' ? '1' : '0')).join('');
      expect(complemento).toBe(R[d]);
    }
  });

  it('G es R al revés', () => {
    for (let d = 0; d < 10; d++) {
      expect([...R[d]].reverse().join('')).toBe(G[d]);
    }
  });

  it('L tiene paridad impar y G par: es lo que codifica el primer dígito', () => {
    for (let d = 0; d < 10; d++) {
      const unos = (s: string) => [...s].filter((b) => b === '1').length;
      expect(unos(L[d]) % 2).toBe(1);
      expect(unos(G[d]) % 2).toBe(0);
    }
  });
});

describe('modulosEan13', () => {
  it('produce exactamente 95 módulos', () => {
    const m = modulosEan13(CODIGO)!;
    expect(m).not.toBeNull();
    expect(m).toHaveLength(MODULOS_EAN13);
    expect(m).toMatch(/^[01]+$/);
  });

  it('coloca las tres guardas donde corresponde', () => {
    const m = modulosEan13(CODIGO)!;
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(92)).toBe('101');
  });

  it('cada dígito ocupa 7 módulos en su grupo', () => {
    const m = modulosEan13(CODIGO)!;
    expect(m.slice(3, 45)).toHaveLength(42);
    expect(m.slice(50, 92)).toHaveLength(42);
  });

  it('con primer dígito 0 el grupo izquierdo va todo en L', () => {
    // 0123456789012 tiene dígito de control válido.
    const codigo = '0123456789012';
    const m = modulosEan13(codigo);
    expect(m).not.toBeNull();
    // El primer dígito del grupo izquierdo es el 1: su código L es 0011001.
    expect(m!.slice(3, 10)).toBe('0011001');
  });

  it('el grupo derecho siempre usa R, que empieza en 1', () => {
    const m = modulosEan13(CODIGO)!;
    for (let i = 0; i < 6; i++) {
      expect(m[50 + i * 7]).toBe('1');
    }
  });

  it('dos códigos distintos dan patrones distintos', () => {
    expect(modulosEan13(generateInternalBarcode(1)))
      .not.toBe(modulosEan13(generateInternalBarcode(2)));
  });

  it('rechaza lo que no es un EAN-13 válido', () => {
    expect(modulosEan13('')).toBeNull();
    expect(modulosEan13('123')).toBeNull();
    expect(modulosEan13('abcdefghijklm')).toBeNull();
    expect(modulosEan13('7801234000019')).toBeNull();   // dígito de control malo
    expect(modulosEan13('78012340000180')).toBeNull();  // 14 dígitos
  });

  it('acepta todos los códigos internos que genera el sistema', () => {
    for (let i = 1; i <= 200; i++) {
      expect(modulosEan13(generateInternalBarcode(i))).not.toBeNull();
    }
  });
});

describe('etiquetaSvg', () => {
  it('devuelve un SVG con medidas en milímetros', () => {
    const svg = etiquetaSvg(CODIGO)!;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('mm"');
  });

  it('dibuja una barra por cada módulo en 1', () => {
    const m = modulosEan13(CODIGO)!;
    const unos = [...m].filter((b) => b === '1').length;
    const svg = etiquetaSvg(CODIGO)!;
    expect(svg.match(/<rect/g)!.length).toBe(unos + 1); // +1 del fondo blanco
  });

  it('imprime los dígitos y separa el primero del resto', () => {
    const svg = etiquetaSvg(CODIGO)!;
    expect(svg).toContain(`>${CODIGO[0]}<`);
    expect(svg).toContain(`>${CODIGO.slice(1, 7)}<`);
    expect(svg).toContain(`>${CODIGO.slice(7)}<`);
  });

  it('puede omitir los números impresos', () => {
    const svg = etiquetaSvg(CODIGO, { conNumeros: false })!;
    // No se busca el código como subcadena: el aria-label lo lleva siempre, a
    // propósito, para que un lector de pantalla pueda decir cuál código es.
    expect(svg).not.toContain('<text');
    expect(svg).toContain(`aria-label="Código de barras ${CODIGO}"`);
  });

  it('incluye título y pie cuando se piden', () => {
    const svg = etiquetaSvg(CODIGO, { titulo: 'Arroz 1 kg', pie: '$1.590' })!;
    expect(svg).toContain('Arroz 1 kg');
    expect(svg).toContain('$1.590');
  });

  it('escapa el nombre del producto para no romper el SVG', () => {
    const svg = etiquetaSvg(CODIGO, { titulo: 'Pan <grande> & rico' })!;
    expect(svg).toContain('&lt;grande&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<grande>');
  });

  it('recorta un nombre largo en vez de desbordar la etiqueta', () => {
    const largo = 'Producto con un nombre absurdamente largo que no cabe jamás';
    const svg = etiquetaSvg(CODIGO, { titulo: largo })!;
    expect(svg).toContain('…');
    expect(svg).not.toContain(largo);
  });

  it('crece de alto cuando se agregan título y pie', () => {
    const alto = (svg: string) => Number(svg.match(/height="([\d.]+)mm"/)![1]);
    const simple = etiquetaSvg(CODIGO, { conNumeros: false })!;
    const completa = etiquetaSvg(CODIGO, { titulo: 'X', pie: '$1' })!;
    expect(alto(completa)).toBeGreaterThan(alto(simple));
  });

  it('respeta el ancho de módulo pedido', () => {
    const ancho = (svg: string) => Number(svg.match(/width="([\d.]+)mm"/)![1]);
    expect(ancho(etiquetaSvg(CODIGO, { anchoModulo: 0.5 })!))
      .toBeGreaterThan(ancho(etiquetaSvg(CODIGO, { anchoModulo: 0.33 })!));
  });

  it('devuelve null con un código inválido, sin lanzar', () => {
    expect(etiquetaSvg('no es un código')).toBeNull();
  });
});

describe('el precio no se monta sobre los dígitos', () => {
  // Regresión: el pie se posicionaba a 2,7 mm de la línea de base de los
  // dígitos, con una tipografía de 3,6 mm. Se veía al imprimir, no al leer el
  // código: el precio quedaba encima del número del producto.
  const lineaBase = (svg: string, texto: string) => {
    const m = svg.match(new RegExp(`y="([\\d.]+)"[^>]*>${texto.replace(/[.$]/g, '\\$&')}<`));
    return m ? Number(m[1]) : null;
  };

  for (const anchoModulo of [0.26, 0.33, 0.43]) {
    for (const altoBarras of [12, 18, 24]) {
      it(`deja aire suficiente con módulo ${anchoModulo} y barras ${altoBarras}`, () => {
        const svg = etiquetaSvg(CODIGO, {
          anchoModulo, altoBarras, titulo: 'Producto', pie: '$1.590',
        })!;
        const yDigitos = lineaBase(svg, CODIGO.slice(7))!;
        const yPie = lineaBase(svg, '\$1.590')!;
        expect(yDigitos).not.toBeNull();
        expect(yPie).not.toBeNull();
        // El pie va debajo, y separado al menos por su propio tamaño de letra.
        expect(yPie - yDigitos).toBeGreaterThanOrEqual(3.6);
      });
    }
  }

  it('el contenido no se sale del alto declarado', () => {
    const svg = etiquetaSvg(CODIGO, { titulo: 'Producto', pie: '$1.590' })!;
    const alto = Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);
    const yPie = Number(svg.match(/y="([\d.]+)"[^>]*font-weight="bold"/)![1]);
    expect(yPie).toBeLessThan(alto);
  });
});
