import {
  calcularCarrito, diaLocal, esCodigoSeguimiento, normalizarCelular, validarPedidoWeb, ALFABETO_CODIGO,
} from '@rutaahorro/core';
import { clienteAdmin, respuestaError } from '@/lib/supabase/admin';
import { DEMO_ACTIVO } from '@/lib/demo';
import { datosTienda, tenantTienda } from '@/lib/tienda/catalogo';
import { pedidosDemo } from '@/lib/tienda/pedidosDemo';
import { deOtroSitio, ipDe, limitar } from '@/lib/limites';

/**
 * POST /api/tienda/pedidos — hacer un pedido desde el carrito (RF-T45 a
 * RF-T48, docs/33). Público como la tienda, con límite por IP.
 *
 * El navegador manda qué productos y cuántos, y los datos de contacto. Los
 * precios NO: los calcula la base (`fn_crear_pedido_web`, 0041) con los de ese
 * momento y sus ofertas. Si el total cambió desde que el cliente lo vio, la
 * respuesta lo dice (`cambio`) para mostrarlo (RNF-T49).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPE_CUERPO = 32 * 1024;

/** Los errores de la base, en palabras para quien compra. */
function traducir(mensaje: string): { codigo: string; texto: string; estado: number } {
  const [codigo, detalle = ''] = mensaje.split(/:\s*/, 2);
  switch (codigo) {
    case 'PEDIDOS_WEB_APAGADOS': return { codigo, estado: 409, texto: 'Por ahora el local no está recibiendo pedidos en línea.' };
    case 'PRODUCTO_AGOTADO': return { codigo, estado: 409, texto: `${detalle || 'Un producto'} se agotó. Sácalo del carrito para seguir.` };
    case 'PRODUCTO_NO_DISPONIBLE': return { codigo, estado: 409, texto: 'Un producto del carrito ya no está a la venta. Vuelve a abrir el carrito para ponerlo al día.' };
    case 'PRODUCTO_SIN_PRECIO': return { codigo, estado: 409, texto: `${detalle || 'Un producto'} no tiene precio confirmado: pregúntalo en el local.` };
    case 'DEMASIADOS_PEDIDOS_ABIERTOS': return { codigo, estado: 409, texto: 'Ya tienes 3 pedidos en curso con ese celular. Retíralos o llama al local antes de hacer otro.' };
    case 'PEDIDO_BAJO_MINIMO': return { codigo, estado: 409, texto: `El pedido mínimo es de $${Number(detalle).toLocaleString('es-CL')}.` };
    case 'TIENDA_SATURADA': return { codigo, estado: 503, texto: 'El local está recibiendo muchos pedidos. Intenta en unos minutos.' };
    case 'TIENDA_CERRADA': return { codigo, estado: 503, texto: 'La tienda no está abierta.' };
    case 'CELULAR_INVALIDO': return { codigo, estado: 400, texto: 'Escribe un celular chileno, ej. 9 1234 5678.' };
    case 'NOMBRE_INVALIDO': return { codigo, estado: 400, texto: 'Escribe tu nombre.' };
    case 'CORREO_INVALIDO': return { codigo, estado: 400, texto: 'Revisa el correo.' };
    default: return { codigo: 'ERROR_INTERNO', estado: 500, texto: 'No se pudo hacer el pedido. Intenta de nuevo en un momento.' };
  }
}

export async function POST(request: Request) {
  if (deOtroSitio(request)) return respuestaError('ORIGEN_INVALIDO', 'Haz el pedido desde la tienda.', 403);
  const limite = limitar('pedido', ipDe(request));
  if (limite) return limite;
  if (Number(request.headers.get('content-length') ?? 0) > TOPE_CUERPO) {
    return respuestaError('PEDIDO_INVALIDO', 'El pedido es demasiado grande.', 413);
  }
  const texto = await request.text().catch(() => '');
  if (texto.length > TOPE_CUERPO) return respuestaError('PEDIDO_INVALIDO', 'El pedido es demasiado grande.', 413);
  let cuerpo: Record<string, unknown>;
  try { cuerpo = JSON.parse(texto); } catch { return respuestaError('PEDIDO_INVALIDO', 'No se entendió el pedido.', 400); }

  // Trampa para robots: un campo que la persona no ve. Si viene lleno, no es una persona.
  if (typeof cuerpo.empresa === 'string' && cuerpo.empresa.trim()) {
    return respuestaError('PEDIDO_INVALIDO', 'No se pudo hacer el pedido.', 400);
  }

  const cliente = (cuerpo.cliente ?? {}) as { nombre?: unknown; celular?: unknown; correo?: unknown };
  const pedido = {
    cliente: { nombre: String(cliente.nombre ?? '').trim(), celular: String(cliente.celular ?? ''), correo: String(cliente.correo ?? '').trim() },
    lineas: Array.isArray(cuerpo.lineas)
      ? (cuerpo.lineas as Array<{ id?: unknown; cantidad?: unknown }>).map((l) => ({ id: String(l?.id ?? ''), cantidad: Number(l?.cantidad) }))
      : [],
    nota: typeof cuerpo.nota === 'string' ? cuerpo.nota.trim() : '',
  };
  const clientUuid = String(cuerpo.client_uuid ?? '');
  const errores = validarPedidoWeb(pedido);
  if (!UUID.test(clientUuid)) errores.push('No se entendió el pedido');
  if (errores.length) return respuestaError('PEDIDO_INVALIDO', errores[0], 400);
  const celular = normalizarCelular(pedido.cliente.celular)!;
  const totalVisto = Number(cuerpo.total_visto);

  const tienda = await datosTienda().catch(() => null);
  if (!tienda) return respuestaError('TIENDA_CERRADA', 'La tienda no está abierta.', 503);
  if (!tienda.pedidosActivos) return respuestaError('PEDIDOS_WEB_APAGADOS', 'Por ahora el local no está recibiendo pedidos en línea.', 409);

  if (DEMO_ACTIVO) return crearEnLaMaqueta(tienda, { ...pedido, celular, clientUuid, totalVisto });

  const tenant = tenantTienda();
  const admin = clienteAdmin();
  if (!tenant || !admin) return respuestaError('TIENDA_CERRADA', 'La tienda no está abierta.', 503);
  const { data, error } = await admin.rpc('fn_crear_pedido_web', {
    p_tenant: tenant,
    p_pedido: {
      client_uuid: clientUuid,
      cliente: { nombre: pedido.cliente.nombre, celular, correo: pedido.cliente.correo },
      lineas: pedido.lineas.map((l) => ({ product_id: l.id, cantidad: l.cantidad })),
      nota: pedido.nota,
    },
  });
  if (error) {
    // La base todavía sin 0041: la tienda no se cae, solo no recibe pedidos.
    if (error.code === 'PGRST202' || error.code === '42883') {
      return respuestaError('PEDIDOS_WEB_APAGADOS', 'Por ahora el local no está recibiendo pedidos en línea.', 409);
    }
    const t = traducir(error.message ?? '');
    if (t.estado >= 500) console.error('[pedido web] no se pudo crear', error.code, error.message);
    return respuestaError(t.codigo, t.texto, t.estado);
  }
  const r = data as { numero: number; codigo: string; total: number; ahorro: number; repetido: boolean };
  // RNF-T25 · sin nombre ni celular en el registro.
  console.info('[pedido web] recibido', { numero: r.numero, total: r.total, lineas: pedido.lineas.length, repetido: r.repetido });
  return Response.json(
    { ...r, cambio: Number.isFinite(totalVisto) && totalVisto !== r.total },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function crearEnLaMaqueta(
  tienda: NonNullable<Awaited<ReturnType<typeof datosTienda>>>,
  p: { cliente: { nombre: string; correo: string }; lineas: Array<{ id: string; cantidad: number }>; nota: string; celular: string; clientUuid: string; totalVisto: number },
) {
  const lista = pedidosDemo();
  const previo = lista.find((x) => x.clientUuid === p.clientUuid);
  if (previo) return Response.json({ numero: previo.numero, codigo: previo.codigo, total: previo.total, ahorro: previo.ahorro, repetido: true, cambio: false });
  const porId = new Map(tienda.catalogo.map((x) => [x.id, x]));
  const faltan = p.lineas.find((l) => !porId.get(l.id)?.precio);
  if (faltan) return respuestaError('PRODUCTO_NO_DISPONIBLE', 'Un producto del carrito ya no está a la venta. Vuelve a abrir el carrito para ponerlo al día.', 409);
  const carrito = calcularCarrito(p.lineas.map((l) => {
    const x = porId.get(l.id)!;
    return { id: x.id, nombre: x.nombre, precio: x.precio!, tramos: x.tramos, cantidad: l.cantidad };
  }), diaLocal(new Date(), tienda.zona));
  let codigo = '';
  do {
    codigo = Array.from({ length: 8 }, () => ALFABETO_CODIGO[Math.floor(Math.random() * ALFABETO_CODIGO.length)]).join('');
  } while (!esCodigoSeguimiento(codigo) || lista.some((x) => x.codigo === codigo));
  const ahora = new Date().toISOString();
  const nuevo = {
    id: crypto.randomUUID(), numero: lista.length + 1, codigo, clientUuid: p.clientUuid,
    nombre: p.cliente.nombre, celular: p.celular, correo: p.cliente.correo || null, nota: p.nota || null,
    estado: 'recibido' as const, motivo: null, total: carrito.total, ahorro: carrito.ahorro, creado: ahora, actualizado: ahora,
    items: carrito.lineas.map((l) => ({ product_id: l.id, nombre: l.nombre, cantidad: l.cantidad, precio_lista: l.precio, precio_unitario: l.precioUnitario, subtotal: l.subtotal })),
    historial: [{ estado: 'recibido' as const, fecha: ahora }],
  };
  lista.unshift(nuevo);
  return Response.json({ numero: nuevo.numero, codigo, total: nuevo.total, ahorro: nuevo.ahorro, repetido: false,
    cambio: Number.isFinite(p.totalVisto) && p.totalVisto !== nuevo.total });
}
