import { describe, it, expect } from 'vitest';
import {
  filtrarCatalogo, categoriasDelCatalogo, ofertasVisibles, enlaceWhatsApp, normalizarBusqueda, precioTienda,
  calcularCarrito, mensajePedido, validarDatosCliente, destacadosDelDia, POR_PAGINA_TIENDA,
  rubroPorNombre, descripcionPublica, rebajaMaximaPct, proximaOferta, relacionados, type ProductoTienda, type LineaCarritoTienda,
} from '../src/tienda.js';

const prod = (id: string, nombre: string, extra: Partial<ProductoTienda> = {}): ProductoTienda => ({
  id, nombre, descripcion: null, categoria: null, precio: 1000, imagen: null, disponible: true, ofertas: [], tramos: [], ...extra,
  grupo: extra.grupo !== undefined ? extra.grupo : extra.categoria ?? null,
});

describe('filtrarCatalogo', () => {
  const catalogo = [
    prod('1', 'Azúcar · 1 kg', { categoria: 'Abarrotes' }),
    prod('2', 'Leche entera · 1 L', { categoria: 'Lácteos', descripcion: 'Caja de 1 litro' }),
    prod('3', 'Arroz grado 1', { categoria: 'Abarrotes', disponible: false }),
    prod('4', 'Aceite vegetal', { categoria: 'Abarrotes' }),
  ];

  it('busca sin tildes y en cualquier orden de palabras', () => {
    expect(filtrarCatalogo(catalogo, { busqueda: 'azucar' }).productos.map((p) => p.id)).toEqual(['1']);
    expect(filtrarCatalogo(catalogo, { busqueda: 'entera LECHE' }).productos.map((p) => p.id)).toEqual(['2']);
    expect(filtrarCatalogo(catalogo, { busqueda: 'litro' }).productos.map((p) => p.id)).toEqual(['2']);
    expect(filtrarCatalogo(catalogo, { busqueda: 'lacteos' }).productos.map((p) => p.id)).toEqual(['2']);
  });

  it('filtra por categoría y deja lo agotado al final', () => {
    const r = filtrarCatalogo(catalogo, { categoria: 'Abarrotes' });
    expect(r.productos.map((p) => p.id)).toEqual(['4', '1', '3']);
    expect(r.total).toBe(3);
  });

  it('corta en páginas y corrige una página fuera de rango', () => {
    const muchos = Array.from({ length: POR_PAGINA_TIENDA + 5 }, (_, i) => prod(String(i), `P${String(i).padStart(3, '0')}`));
    const p2 = filtrarCatalogo(muchos, { pagina: 2 });
    expect(p2.paginas).toBe(2);
    expect(p2.productos).toHaveLength(5);
    expect(filtrarCatalogo(muchos, { pagina: 99 }).pagina).toBe(2);
    expect(filtrarCatalogo(muchos, { pagina: -3 }).pagina).toBe(1);
    expect(filtrarCatalogo(muchos, { pagina: Number('abc') }).pagina).toBe(1);
  });

  it('sin resultados dice 0 de 1 página, no 0 páginas', () => {
    const r = filtrarCatalogo(catalogo, { busqueda: 'no existe' });
    expect(r).toMatchObject({ total: 0, pagina: 1, paginas: 1, productos: [] });
  });
});

describe('categoriasDelCatalogo', () => {
  it('sin repetir, sin las vacías, las con más productos primero', () => {
    expect(categoriasDelCatalogo([
      prod('1', 'a', { categoria: 'Lácteos' }), prod('2', 'b', { categoria: 'Abarrotes' }),
      prod('3', 'c', { categoria: 'Lácteos' }), prod('4', 'd'),
    ])).toEqual(['Lácteos', 'Abarrotes']);
  });
});

describe('ofertasVisibles', () => {
  it('por mayor y promoción, solo las que rigen ese día', () => {
    expect(ofertasVisibles(2000, [
      { desde: 3, precio: 1400 },
      { desde: 1, precio: 1800, vigenteDesde: '2026-10-01', vigenteHasta: '2026-10-07' },
    ], '2026-10-05')).toEqual(['Oferta: $1.800', 'Desde 3: $1.400 c/u']);
    expect(ofertasVisibles(2000, [
      { desde: 1, precio: 1800, vigenteDesde: '2026-10-01', vigenteHasta: '2026-10-07' },
    ], '2026-10-09')).toEqual([]);
  });

  it('un porcentaje se muestra en pesos', () => {
    expect(ofertasVisibles(1990, [{ desde: 6, descuentoPct: 10 }], '2026-10-09')).toEqual(['Desde 6: $1.791 c/u']);
  });

  it('no muestra un tramo que no rebaja nada, ni nada con las ofertas apagadas', () => {
    expect(ofertasVisibles(1000, [{ desde: 3, precio: 1200 }], '2026-10-09')).toEqual([]);
    expect(ofertasVisibles(2000, [{ desde: 3, precio: 1400 }], '2026-10-09', false)).toEqual([]);
  });
});

describe('filtrarCatalogo · ofertas', () => {
  it('solo los que tienen oferta hoy', () => {
    const r = filtrarCatalogo([prod('1', 'a', { ofertas: ['Desde 3: $1.400 c/u'] }), prod('2', 'b')], { soloOfertas: true });
    expect(r.productos.map((p) => p.id)).toEqual(['1']);
  });
});

describe('calcularCarrito', () => {
  const linea = (id: string, precio: number, cantidad: number, tramos: LineaCarritoTienda['tramos'] = []): LineaCarritoTienda =>
    ({ id, nombre: id, precio, tramos, cantidad });

  it('aplica el precio por cantidad a todas las unidades, como la caja', () => {
    const c = calcularCarrito([linea('pap', 2000, 4, [{ desde: 3, precio: 1400 }]), linea('pan', 1000, 2)], '2026-10-09');
    expect(c.lineas.map((l) => [l.precioUnitario, l.subtotal, l.conOferta])).toEqual([[1400, 5600, true], [1000, 2000, false]]);
    expect(c.total).toBe(7600);
    expect(c.unidades).toBe(6);
  });

  it('con 2, el precio "desde 3" no rige', () => {
    expect(calcularCarrito([linea('pap', 2000, 2, [{ desde: 3, precio: 1400 }])], '2026-10-09').total).toBe(4000);
  });

  it('deja fuera lo que no tiene precio o cantidad', () => {
    expect(calcularCarrito([linea('a', 0, 2), linea('b', 500, 0)], '2026-10-09')).toEqual({ lineas: [], unidades: 0, total: 0, ahorro: 0 });
  });

  it('el mensaje de WhatsApp lista el pedido y el total', () => {
    const c = calcularCarrito([linea('Arroz', 1590, 2)], '2026-10-09');
    expect(mensajePedido(c)).toBe('Hola, quiero hacer este pedido:\n• 2 × Arroz = $3.180\nTotal: $3.180');
  });
});

describe('pedido con los datos del cliente', () => {
  it('el mensaje dice quién pide', () => {
    const c = calcularCarrito([{ id: 'a', nombre: 'Arroz', precio: 1590, tramos: [], cantidad: 1 }], '2026-10-09');
    expect(mensajePedido(c, { nombre: ' Ana ', celular: '9 1234 5678', correo: '' }).split('\n')[0])
      .toBe('Hola, soy Ana (9 1234 5678). Quiero hacer este pedido:');
  });
  it('nombre y celular son obligatorios; el correo, si viene, válido', () => {
    expect(validarDatosCliente({ nombre: 'Ana', celular: '912345678', correo: '' })).toEqual({});
    expect(Object.keys(validarDatosCliente({ nombre: '', celular: '123', correo: 'x@' })).sort())
      .toEqual(['celular', 'correo', 'nombre']);
  });
});

describe('destacadosDelDia', () => {
  const cat = Array.from({ length: 30 }, (_, i) => prod(String(i), `P${i}`, i % 5 === 0 ? { precio: null } : {}));
  it('solo con precio y disponibles, el mismo orden todo el día y otro al día siguiente', () => {
    const hoy = destacadosDelDia(cat, '2026-10-09', 8);
    expect(hoy).toHaveLength(8);
    expect(hoy.every((p) => p.precio != null)).toBe(true);
    expect(destacadosDelDia(cat, '2026-10-09', 8)).toEqual(hoy);
    expect(destacadosDelDia(cat, '2026-10-10', 8).map((p) => p.id)).not.toEqual(hoy.map((p) => p.id));
  });
});

describe('orden', () => {
  const cat = [prod('a', 'Caro', { precio: 3000 }), prod('b', 'Barato', { precio: 500 }), prod('c', 'Sin', { precio: null }), prod('d', 'Medio', { precio: 1000 })];
  it('menor y mayor precio, y los sin precio siempre al final', () => {
    expect(filtrarCatalogo(cat, { orden: 'menor-precio' }).productos.map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(filtrarCatalogo(cat, { orden: 'mayor-precio' }).productos.map((p) => p.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(filtrarCatalogo(cat, {}).productos.map((p) => p.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('rubroPorNombre', () => {
  it.each([
    ['ACEITE MARAVILLA PARRAL 5L', 'Abarrotes'],
    ['1+1 Yog P/Llevar Choco Krispis', 'Lácteos'],
    ['Alfajor bon o bon blanco', 'Snacks y dulces'],
    ['Camarón crudo 36/40 pelado sin vena 1k', 'Carnes y congelados'],
    ['CACHANTUN 600cc C/G', 'Bebidas'],
    ['Detergente líquido 3 L', 'Limpieza y aseo'],
    ['Pan de molde 500 g', 'Panadería'],
    ['Tornillo 3/8', null],
  ])('%s → %s', (nombre, rubro) => {
    expect(rubroPorNombre(nombre)).toBe(rubro);
  });
});

describe('descripcionPublica', () => {
  it('saca el "Código anterior" de la planilla', () => {
    expect(descripcionPublica('Código anterior: 3020002')).toBeNull();
    expect(descripcionPublica('Codigo anterior: I-554 · Caja de 1 litro')).toBe('Caja de 1 litro');
    expect(descripcionPublica('Caja de 1 litro')).toBe('Caja de 1 litro');
    expect(descripcionPublica(null)).toBeNull();
  });
});

describe('ofertas en el carrito y en la tarjeta', () => {
  const tramos = [{ desde: 2, precio: 500 }, { desde: 6, precio: 450 }];
  it('la rebaja más grande, en %', () => {
    expect(rebajaMaximaPct(600, tramos)).toBe(25);
    expect(rebajaMaximaPct(600, [])).toBe(0);
    expect(rebajaMaximaPct(null, tramos)).toBe(0);
  });
  it('cuánto falta para la próxima oferta', () => {
    expect(proximaOferta({ precio: 600, tramos, cantidad: 1 }, '2026-10-09')).toEqual({ faltan: 1, precio: 500 });
    expect(proximaOferta({ precio: 600, tramos, cantidad: 3 }, '2026-10-09')).toEqual({ faltan: 3, precio: 450 });
    expect(proximaOferta({ precio: 600, tramos, cantidad: 6 }, '2026-10-09')).toBeNull();
  });
  it('el ahorro del carrito contra el precio de lista', () => {
    expect(calcularCarrito([{ id: 'a', nombre: 'a', precio: 600, tramos, cantidad: 3 }], '2026-10-09').ahorro).toBe(300);
  });
  it('relacionados: mismo grupo, con precio, disponibles, sin él mismo', () => {
    const cat = [prod('1', 'a', { grupo: 'X' }), prod('2', 'b', { grupo: 'X' }), prod('3', 'c', { grupo: 'X', precio: null }), prod('4', 'd', { grupo: 'Y' })];
    expect(relacionados(cat, cat[0], 4).map((p) => p.id)).toEqual(['2']);
  });
});

describe('precioTienda', () => {
  it('sin precio dice "Consultar precio", nunca $0', () => {
    expect(precioTienda(1290)).toBe('$1.290');
    expect(precioTienda(null)).toBe('Consultar precio');
    expect(precioTienda(0)).toBe('Consultar precio');
  });
  it('un producto sin precio no muestra ofertas', () => {
    expect(ofertasVisibles(0, [{ desde: 3, precio: 1400 }], '2026-10-09')).toEqual([]);
  });
});

describe('enlaceWhatsApp', () => {
  it('acepta el celular como lo anote el dueño', () => {
    for (const t of ['+56 9 1234 5678', '912345678', '56912345678', '0056 9 1234 5678']) {
      expect(enlaceWhatsApp(t, 'Hola')).toBe('https://wa.me/56912345678?text=Hola');
    }
  });
  it('codifica el mensaje', () => {
    expect(enlaceWhatsApp('912345678', 'Hola, ¿tienen Azúcar?')).toBe(
      'https://wa.me/56912345678?text=Hola%2C%20%C2%BFtienen%20Az%C3%BAcar%3F');
  });
  it('sin un número chileno, no hay enlace', () => {
    expect(enlaceWhatsApp(null, 'x')).toBeNull();
    expect(enlaceWhatsApp('', 'x')).toBeNull();
    expect(enlaceWhatsApp('12345', 'x')).toBeNull();
  });
});

describe('normalizarBusqueda', () => {
  it('igual que el POS', () => {
    expect(normalizarBusqueda('  ÑANDÚ Azúcar ')).toBe('nandu azucar');
  });
});
