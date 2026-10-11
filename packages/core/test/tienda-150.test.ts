import { describe, it, expect } from 'vitest';
import {
  filtrarCatalogo, contienePalabra, sugerenciaBusqueda, precioPorMedida, paginasVisibles, ofertasDestacadas,
  enlaceMapa, mensajePedido, listaDeCompras, calcularCarrito, type ProductoTienda,
} from '../src/tienda.js';
import {
  parsearTramos, validarHorario, estadoAtencion, resumenHorario, hayHorario, momentoLocal,
} from '../src/horario.js';
import {
  puedeCambiarEstado, accionPrincipal, validarPedidoWeb, normalizarCelular, formatoCelular, esCodigoSeguimiento,
  mensajeEstadoCliente, haceCuanto, TRANSICIONES_PEDIDO, ESTADOS_PEDIDO_WEB,
} from '../src/pedidoWeb.js';

const prod = (id: string, nombre: string, extra: Partial<ProductoTienda> = {}): ProductoTienda => ({
  id, nombre, descripcion: null, categoria: null, grupo: null, precio: 1000, imagen: null, disponible: true,
  ofertas: [], tramos: [], marca: null, formato: null, ...extra,
});
const ids = (ps: ProductoTienda[]) => ps.map((p) => p.id);

describe('búsqueda de la tienda (docs/33)', () => {
  const catalogo = [
    prod('1', 'Empanada de pino'),
    prod('2', 'Pan amasado'),
    prod('3', 'Tomate larga vida'),
    prod('4', 'Leche entera 1 L', { marca: 'Soprole' }),
    prod('5', 'Galleta de agua', { disponible: false }),
  ];

  it('encuentra el singular aunque se busque en plural', () => {
    expect(contienePalabra('tomate larga vida', 'tomates')).toBe(true);
    expect(contienePalabra('pan amasado', 'panes')).toBe(true);
    expect(ids(filtrarCatalogo(catalogo, { busqueda: 'tomates' }).productos)).toEqual(['3']);
  });

  it('busca también por la marca', () => {
    expect(ids(filtrarCatalogo(catalogo, { busqueda: 'soprole' }).productos)).toEqual(['4']);
  });

  it('pone primero lo que empieza con lo buscado', () => {
    expect(ids(filtrarCatalogo(catalogo, { busqueda: 'pan' }).productos)).toEqual(['2', '1']);
  });

  it('puede dejar fuera lo agotado', () => {
    expect(ids(filtrarCatalogo(catalogo, { soloDisponibles: true }).productos)).not.toContain('5');
    expect(filtrarCatalogo(catalogo, { soloDisponibles: true }).total).toBe(4);
  });

  it('ordena por mayor descuento', () => {
    const c = [
      prod('a', 'A', { tramos: [{ desde: 1, precio: 900, vigenteDesde: '2020-01-01' }], ofertas: ['x'] }),
      prod('b', 'B', { tramos: [{ desde: 1, precio: 500, vigenteDesde: '2020-01-01' }], ofertas: ['x'] }),
      prod('c', 'C'),
    ];
    expect(ids(filtrarCatalogo(c, { orden: 'mayor-descuento' }).productos)).toEqual(['b', 'a', 'c']);
  });

  it('sugiere la palabra parecida cuando no encuentra nada', () => {
    expect(sugerenciaBusqueda(catalogo, 'lehe')).toBe('leche');
    expect(sugerenciaBusqueda(catalogo, 'galeta de agua')).toBe('galleta de agua');
    expect(sugerenciaBusqueda(catalogo, 'leche')).toBeNull();
    expect(sugerenciaBusqueda(catalogo, 'xyzw')).toBeNull();
    expect(sugerenciaBusqueda(catalogo, '')).toBeNull();
  });
});

describe('precio por medida, páginas, ofertas y mapa', () => {
  it('calcula el precio por kg, litro o unidad', () => {
    expect(precioPorMedida(1290, '500 g')).toBe('$2.580 el kg');
    expect(precioPorMedida(990, '250 ml')).toBe('$3.960 el litro');
    expect(precioPorMedida(1290, '6 unidades')).toBe('$215 c/u');
    expect(precioPorMedida(5990, '3 L')).toBe('$1.997 el litro');
    expect(precioPorMedida(1290, '1 kg')).toBeNull();
    expect(precioPorMedida(null, '500 g')).toBeNull();
    expect(precioPorMedida(1290, null)).toBeNull();
  });

  it('muestra la primera, la última y las vecinas', () => {
    expect(paginasVisibles(5, 20)).toEqual([1, null, 4, 5, 6, null, 20]);
    expect(paginasVisibles(1, 3)).toEqual([1, 2, 3]);
    expect(paginasVisibles(1, 1)).toEqual([1]);
    expect(paginasVisibles(2, 6)).toEqual([1, 2, 3, null, 6]);
  });

  it('destaca las ofertas que más rebajan y solo las que se pueden comprar', () => {
    const c = [
      prod('a', 'A', { tramos: [{ desde: 1, precio: 900, vigenteDesde: '2020-01-01' }] }),
      prod('b', 'B', { tramos: [{ desde: 1, precio: 500, vigenteDesde: '2020-01-01' }] }),
      prod('c', 'C', { tramos: [{ desde: 1, precio: 100, vigenteDesde: '2020-01-01' }], disponible: false }),
      prod('d', 'D'),
    ];
    expect(ids(ofertasDestacadas(c, 5))).toEqual(['b', 'a']);
  });

  it('arma el enlace al mapa solo con dirección', () => {
    expect(enlaceMapa('Av. Siempre Viva 742')).toBe('https://www.google.com/maps/search/?api=1&query=Av.%20Siempre%20Viva%20742');
    expect(enlaceMapa('  ')).toBeNull();
  });

  it('el mensaje lleva la nota, y la lista no lleva datos personales', () => {
    const carrito = calcularCarrito([{ id: '1', nombre: 'Pan', precio: 1000, tramos: [], cantidad: 2 }], '2026-10-11');
    expect(mensajePedido(carrito, null, 'Sin bolsa')).toContain('Nota: Sin bolsa');
    expect(mensajePedido(carrito, null, '  ')).not.toContain('Nota');
    expect(listaDeCompras(carrito)).toBe('2 × Pan\nTotal estimado: $2.000');
  });
});

describe('horario de atención', () => {
  it('lee los tramos como los escribe el dueño', () => {
    expect(parsearTramos('09:00-14:00, 16:00-21:00')).toEqual([[540, 840], [960, 1260]]);
    expect(parsearTramos('9-21')).toEqual([[540, 1260]]);
    expect(parsearTramos('9 a 13 y 15 a 20')).toEqual([[540, 780], [900, 1200]]);
    expect(parsearTramos('')).toEqual([]);
    expect(parsearTramos('cerrado')).toEqual([]);
    expect(parsearTramos('21-9')).toBeNull();
    expect(parsearTramos('25:00-26:00')).toBeNull();
    expect(parsearTramos('9-14, 13-20')).toBeNull();
    expect(validarHorario({ lun: '9-21', mar: 'temprano' })).toEqual(['mar']);
  });

  const semana = { lun: '09:00-21:00', mar: '09:00-21:00', mie: '09:00-21:00', jue: '09:00-21:00', vie: '09:00-21:00', sab: '10:00-14:00', dom: '' };
  // 2026-10-12 es lunes. 15:00 en Santiago (UTC-3) = 18:00 UTC.
  const lunes15 = new Date('2026-10-12T18:00:00Z');

  it('sabe el día y la hora en la zona del local', () => {
    expect(momentoLocal(lunes15, 'America/Santiago')).toEqual({ dia: 'lun', minuto: 900 });
  });

  it('dice si está abierto y cuándo cierra o abre', () => {
    expect(estadoAtencion(semana, lunes15, 'America/Santiago')).toEqual({ abierto: true, texto: 'Abierto · cierra a las 21:00' });
    expect(estadoAtencion(semana, new Date('2026-10-12T11:00:00Z'), 'America/Santiago'))
      .toEqual({ abierto: false, texto: 'Cerrado · abre hoy a las 09:00' });
    // Sábado 18:00 → el domingo no abre: abre el lunes.
    expect(estadoAtencion(semana, new Date('2026-10-17T21:00:00Z'), 'America/Santiago'))
      .toEqual({ abierto: false, texto: 'Cerrado · abre el lunes a las 09:00' });
    // Lunes 22:00 → mañana.
    expect(estadoAtencion(semana, new Date('2026-10-13T01:00:00Z'), 'America/Santiago'))
      .toEqual({ abierto: false, texto: 'Cerrado · abre mañana a las 09:00' });
    expect(estadoAtencion({}, lunes15, 'America/Santiago')).toBeNull();
    expect(hayHorario(null)).toBe(false);
  });

  it('resume la semana agrupando días iguales', () => {
    expect(resumenHorario(semana)).toEqual([
      { dias: 'Lun a Vie', horas: '09:00–21:00' },
      { dias: 'Sáb', horas: '10:00–14:00' },
      { dias: 'Dom', horas: 'Cerrado' },
    ]);
  });
});

describe('pedido web', () => {
  it('solo permite avanzar por los estados válidos', () => {
    expect(puedeCambiarEstado('recibido', 'preparando')).toBe(true);
    expect(puedeCambiarEstado('listo', 'entregado')).toBe(true);
    expect(puedeCambiarEstado('entregado', 'cancelado')).toBe(false);
    expect(puedeCambiarEstado('cancelado', 'recibido')).toBe(false);
    expect(puedeCambiarEstado('preparando', 'recibido')).toBe(false);
    for (const e of ESTADOS_PEDIDO_WEB) expect(TRANSICIONES_PEDIDO[e]).toBeDefined();
    expect(accionPrincipal('recibido')).toEqual({ a: 'preparando', texto: 'Empezar a preparar' });
    expect(accionPrincipal('entregado')).toBeNull();
  });

  const id = '11111111-2222-3333-4444-555555555555';
  const bueno = { cliente: { nombre: 'Ana Pérez', celular: '9 1234 5678', correo: '' }, lineas: [{ id, cantidad: 2 }] };

  it('valida el pedido antes de mandarlo', () => {
    expect(validarPedidoWeb(bueno)).toEqual([]);
    expect(validarPedidoWeb({ ...bueno, cliente: { ...bueno.cliente, nombre: 'A' } })).toContain('Escribe tu nombre');
    expect(validarPedidoWeb({ ...bueno, cliente: { ...bueno.cliente, celular: '123' } })[0]).toMatch(/celular/);
    expect(validarPedidoWeb({ ...bueno, lineas: [] })).toContain('El carrito está vacío');
    expect(validarPedidoWeb({ ...bueno, lineas: [{ id, cantidad: 100 }] })[0]).toMatch(/1 a 99/);
    expect(validarPedidoWeb({ ...bueno, lineas: [{ id, cantidad: 1.5 }] })[0]).toMatch(/1 a 99/);
    expect(validarPedidoWeb({ ...bueno, lineas: [{ id: 'x; drop table', cantidad: 1 }] })[0]).toMatch(/1 a 99/);
    expect(validarPedidoWeb({ ...bueno, nota: 'x'.repeat(301) })[0]).toMatch(/nota/);
    expect(validarPedidoWeb({ ...bueno, cliente: { ...bueno.cliente, correo: 'ana.gmail.com' } })).toContain('Revisa el correo');
  });

  it('guarda el celular siempre igual, y solo celulares', () => {
    expect(normalizarCelular('9 1234 5678')).toBe('+56912345678');
    expect(normalizarCelular('+56 9 1234 5678')).toBe('+56912345678');
    expect(normalizarCelular('(2) 2345 6789')).toBeNull();
    expect(normalizarCelular('')).toBeNull();
    expect(formatoCelular('+56912345678')).toBe('+56 9 1234 5678');
  });

  it('reconoce un código de seguimiento sin letras confusas', () => {
    expect(esCodigoSeguimiento('K7PX9QRM')).toBe(true);
    expect(esCodigoSeguimiento('K7PX9QR0')).toBe(false);
    expect(esCodigoSeguimiento('k7px9qrm')).toBe(false);
    expect(esCodigoSeguimiento('K7PX9QR')).toBe(false);
    expect(esCodigoSeguimiento(null)).toBe(false);
  });

  it('arma el aviso al cliente', () => {
    const base = { numero: 12, nombreCliente: 'Ana Pérez', local: 'Almacén', direccion: 'Calle 1', total: 2500 };
    expect(mensajeEstadoCliente({ ...base, estado: 'listo' }))
      .toBe('Hola Ana, te escribimos de Almacén. Tu pedido N° 12 está listo para retirar en Calle 1. Total: $2.500 (pagas al retirar).');
    expect(mensajeEstadoCliente({ ...base, estado: 'cancelado', motivo: 'sin stock' })).toContain('cancelar tu pedido N° 12: sin stock');
    expect(mensajeEstadoCliente({ ...base, estado: 'preparando', enlace: 'https://x/p' })).toContain('https://x/p');
  });

  it('dice hace cuánto llegó', () => {
    const ahora = new Date('2026-10-11T12:00:00Z');
    expect(haceCuanto('2026-10-11T11:59:40Z', ahora)).toBe('recién');
    expect(haceCuanto('2026-10-11T11:55:00Z', ahora)).toBe('hace 5 min');
    expect(haceCuanto('2026-10-11T09:00:00Z', ahora)).toBe('hace 3 h');
    expect(haceCuanto('2026-10-10T11:00:00Z', ahora)).toBe('ayer');
  });
});
