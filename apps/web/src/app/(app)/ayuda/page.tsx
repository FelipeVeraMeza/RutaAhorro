import Link from 'next/link';
import { exigirRol } from '@/lib/permisos';
import { Encabezado } from '@/components/Encabezado';
import type { Rol } from '@/lib/navegacion';

export const metadata = { title: 'Ayuda' };

interface Guia { titulo: string; pasos: string[]; ir?: { href: string; texto: string }; roles: Rol[] }

const TODOS: Rol[] = ['admin', 'supervisor', 'vendedor', 'bodega'];
const CAJA: Rol[] = ['admin', 'supervisor', 'vendedor'];
const MANDO: Rol[] = ['admin', 'supervisor'];

/**
 * "¿Cómo se hace?" (RF-M9-12). Guías cortas, por rol, con el botón que lleva
 * a hacerlo. Nadie lee un manual en el mostrador: tres a cinco pasos y listo.
 */
const GUIAS: Guia[] = [
  { titulo: 'Vender', roles: CAJA, ir: { href: '/pos', texto: 'Ir a Vender' }, pasos: [
    'Abre tu caja en Caja si todavía no lo hiciste (se pide una sola vez por turno).',
    'Escanea el código o escribe parte del nombre. Sin tildes también encuentra.',
    'Toca la cantidad para cambiarla. Si te equivocas, "Deshacer" recupera la línea quitada.',
    'Para rebajar un producto, toca "Descuento" en su línea ($ o %). Si pasa tu tope, "Pedir autorización y cobrar": el administrador o el supervisor pone su PIN en tu celular (necesita internet).',
    'Cobrar → elige el medio de pago y, en efectivo, escribe cuánto te pasaron: el vuelto sale solo.',
    'En efectivo el total se redondea a la decena (Ley 20.956): $1.463 se cobra $1.460. El comprobante lo explica.',
    'Si se cae internet, sigue vendiendo: la venta se envía sola cuando vuelve.',
  ] },
  { titulo: 'Reimprimir o compartir un comprobante', roles: CAJA, ir: { href: '/ventas', texto: 'Ir a Ventas' }, pasos: [
    'En Ventas, toca la venta.',
    '"Reimprimir o compartir el comprobante": sale marcado como COPIA.',
  ] },
  { titulo: 'Fiar y recibir abonos', roles: CAJA, ir: { href: '/fiado', texto: 'Ir a Fiado' }, pasos: [
    'En Vender, elige al cliente ("Elegir cliente"). Si tiene crédito, al cobrar aparece "Fiado".',
    'Se ve cuánto debe y cuánto le queda; si no alcanza, cobra con otro medio.',
    'Cuando paga: Fiado → "Abonar". En efectivo, la plata entra a tu caja.',
    'El crédito (tope) lo da el administrador o el supervisor en Fiado.',
  ] },
  { titulo: 'Cerrar la caja', roles: CAJA, ir: { href: '/caja', texto: 'Ir a Caja' }, pasos: [
    'Cuenta el efectivo. "Contar por billete" suma por ti.',
    'Escribe lo contado y, si hay diferencia, explica por qué.',
    'Cerrar caja → queda un resumen para imprimir o guardar.',
  ] },
  { titulo: 'Consultar un precio', roles: TODOS, ir: { href: '/precio', texto: 'Consultar precio' }, pasos: [
    'Escanea o escribe el nombre. Funciona sin internet con el catálogo guardado.',
  ] },
  // Bodega también crea y edita productos (Productos y Recibir mercadería), y
  // no tenía esta guía; los precios y ofertas sí son de admin y supervisor.
  { titulo: 'Crear o cambiar un producto', roles: ['admin', 'supervisor', 'bodega'], ir: { href: '/productos', texto: 'Ir a Productos' }, pasos: [
    'Productos → "Nuevo producto", o "Editar" en uno existente.',
    'Si es perecible y cargas stock, la fecha de vencimiento es obligatoria.',
    'El precio de un producto que ya existe y sus ofertas los cambian el administrador o el supervisor ("Cambiar precio" avisa si el cambio es grande).',
    '"Revisar datos" lista los productos a los que les falta código, costo, mínimo o categoría.',
  ] },
  { titulo: 'Imprimir etiquetas y carteles de góndola', roles: ['admin', 'supervisor', 'bodega'], ir: { href: '/productos/etiquetas', texto: 'Ir a Etiquetas' }, pasos: [
    'Marca los productos y elige "Código de barras" o "Cartel de góndola".',
    'Imprimir: en el diálogo del navegador elige tu impresora o "Guardar como PDF".',
  ] },
  { titulo: 'Devolver mercadería al proveedor', roles: ['admin', 'supervisor', 'bodega'], ir: { href: '/proveedores/devolucion', texto: 'Devolver a proveedor' }, pasos: [
    'Compras → "Devolver": elige el proveedor y el motivo (vencido, dañado, mal despachado).',
    'Busca o escanea lo que vuelve y la cantidad; si es perecible, puedes elegir el lote.',
    'Sale de la bodega con su motivo. Cuando llegue la nota de crédito del proveedor, regístrala en Facturación → Recibidas.',
  ] },
  { titulo: 'Contar el inventario (toma)', roles: ['admin', 'supervisor', 'bodega'], ir: { href: '/inventario', texto: 'Ir a Inventario' }, pasos: [
    '"Imprimir hoja para contar" si prefieres contar en papel.',
    'Escribe lo contado; el sistema muestra la diferencia antes de guardar.',
  ] },
  { titulo: 'Recibir mercadería', roles: ['admin', 'supervisor', 'bodega'], ir: { href: '/proveedores/recepcion', texto: 'Recibir mercadería' }, pasos: [
    'Compras → "Recibir mercadería": elige el proveedor y escanea lo que llegó. Si no existe, "+ Nuevo".',
    'Un perecible no se recibe sin su fecha de vencimiento.',
    'Con factura a crédito, indica cuándo vence (30 o 60 días): queda en "Por pagar".',
    'Confirma: el stock sube y el costo queda registrado.',
    '"Qué comprar" arma el pedido por proveedor y lo manda por WhatsApp.',
  ] },
  { titulo: 'Pagar facturas de proveedores', roles: MANDO, ir: { href: '/proveedores?vista=pagar', texto: 'Ir a Por pagar' }, pasos: [
    'Compras → "Por pagar": las facturas ordenadas por vencimiento; lo vencido sale en rojo.',
    'El Inicio avisa lo que vence en los próximos 7 días.',
    '"Pagada" → cómo se pagó. Con "Efectivo de la caja" sale como egreso de tu caja.',
  ] },
  { titulo: 'Anular o devolver una venta', roles: MANDO, ir: { href: '/ventas', texto: 'Ir a Ventas' }, pasos: [
    'Ventas → toca la venta → Anular (todo) o Devolver (algunos productos).',
    'Siempre se pide el motivo; queda en la Bitácora y en Reportes → Anulaciones.',
  ] },
  { titulo: 'Crear una cuenta para alguien del personal', roles: ['admin'], ir: { href: '/usuarios', texto: 'Ir a Usuarios' }, pasos: [
    'Usuarios → "Crear cuenta": nombre, correo, rol y una contraseña temporal.',
    'Al entrar por primera vez se le pide cambiarla.',
    'Si alguien deja el local, desactiva su cuenta (no se borra, para no perder su historial).',
  ] },
  { titulo: 'Ver quién hizo qué', roles: ['admin'], ir: { href: '/bitacora', texto: 'Ir a la Bitácora' }, pasos: [
    'Bitácora: cambios de precio, anulaciones, devoluciones, ajustes de stock, configuración, crédito de clientes, facturas de proveedores y cambios de cuentas, con fecha y persona.',
  ] },
  { titulo: 'Sacar las ventas para el contador', roles: ['admin'], ir: { href: '/reportes', texto: 'Ir a Reportes' }, pasos: [
    'Reportes → elige el período → "Exportar ventas línea por línea".',
    'Se abre en Excel o Google Sheets.',
  ] },
];

export default async function AyudaPage() {
  const user = await exigirRol(['admin', 'supervisor', 'vendedor', 'bodega']);
  const guias = GUIAS.filter((g) => g.roles.includes(user.role));
  return (
    <div className="px-4 py-5 max-w-2xl mx-auto">
      <Encabezado titulo="Ayuda" icono="ayuda" descripcion="Cómo se hace cada cosa, paso a paso. Solo lo que te toca." />
      <div className="space-y-2">
        {guias.map((g) => (
          <details key={g.titulo} className="tarjeta p-4 group">
            <summary className="font-semibold cursor-pointer list-none flex justify-between items-center gap-2">
              {g.titulo}
              <span aria-hidden className="text-[var(--texto-suave)] group-open:rotate-90 transition-transform">›</span>
            </summary>
            <ol className="list-decimal pl-5 mt-3 space-y-1.5 text-sm">
              {g.pasos.map((p) => <li key={p}>{p}</li>)}
            </ol>
            {g.ir && <Link href={g.ir.href} className="btn btn-secundario btn-chico mt-3 inline-flex">{g.ir.texto}</Link>}
          </details>
        ))}
      </div>
      <p className="text-sm text-[var(--texto-suave)] mt-5">
        ¿No está lo que buscas? Pregúntale al administrador del local. Lo nuevo de cada versión está en{' '}
        <Link href="/novedades" className="underline inline-flex items-center min-h-[44px]">Novedades</Link>.
      </p>
    </div>
  );
}
