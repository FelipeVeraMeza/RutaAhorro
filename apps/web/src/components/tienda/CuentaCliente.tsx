'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { NOMBRE_ESTADO_PEDIDO, formatCLP, validarDatosCliente, type DatosCliente, type EstadoPedidoWeb } from '@rutaahorro/core';
import { agregarAlCarrito } from '@/lib/tienda/carrito';
import { borrarMisDatos, guardarDatosCliente, useDatosCliente, usePedidos, type PedidoEnviado } from '@/lib/tienda/cliente';
import { borrarFavoritosYVistos } from '@/lib/tienda/favoritos';
import { ProductosGuardados } from './ProductosGuardados';

type Estados = Record<string, { estado: EstadoPedidoWeb; numero: number }>;

const CAMPO = 'w-full h-12 px-3 rounded-xl border border-[var(--borde)] bg-[var(--superficie)] focus:outline-2 focus:outline-marca-500';

/**
 * Mi cuenta, sin cuenta: los datos para los pedidos y los pedidos enviados,
 * guardados en este navegador (lib/tienda/cliente.ts).
 */
export function CuentaCliente() {
  const { valor: datos, listo } = useDatosCliente();
  const { valor: pedidos } = usePedidos();
  const [form, setForm] = useState<DatosCliente>(datos);
  const [errores, setErrores] = useState<Partial<Record<keyof DatosCliente, string>>>({});
  const [guardado, setGuardado] = useState(false);

  // Cuando termina de leer el navegador, el formulario parte con lo guardado.
  useEffect(() => { if (listo) setForm(datos); }, [listo, datos]);

  // RF-T43 · En qué va cada pedido hecho en la tienda (los con código).
  const [estados, setEstados] = useState<Estados>({});
  const codigos = pedidos.map((p) => p.codigo).filter(Boolean).join(',');
  useEffect(() => {
    if (!codigos) return;
    let vivo = true;
    fetch(`/api/tienda/pedidos/estado?codigos=${codigos}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { pedidos: [] }))
      .then((d: { pedidos: Array<{ codigo: string; estado: EstadoPedidoWeb; numero: number }> }) => {
        if (vivo) setEstados(Object.fromEntries(d.pedidos.map((p) => [p.codigo, { estado: p.estado, numero: p.numero }])));
      })
      .catch(() => { /* sin red: se ven sin estado */ });
    return () => { vivo = false; };
  }, [codigos]);

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    const err = validarDatosCliente(form);
    setErrores(err);
    if (Object.keys(err).length) return;
    guardarDatosCliente(form);
    setGuardado(true);
  }

  function campo(k: keyof DatosCliente, etiqueta: string, extra: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={`c-${k}`} className="font-semibold text-sm">{etiqueta}</label>
        <input id={`c-${k}`} className={CAMPO} value={form[k]} aria-invalid={Boolean(errores[k])}
          aria-describedby={errores[k] ? `e-${k}` : undefined}
          onChange={(e) => { setForm({ ...form, [k]: e.target.value }); setGuardado(false); }} {...extra} />
        {errores[k] && <p id={`e-${k}`} className="text-sm text-alerta">{errores[k]}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
      <section className="tarjeta p-4 md:p-5 flex flex-col gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900">Mi cuenta</h1>
          <p className="text-[var(--texto-suave)]">
            Tus datos quedan guardados en este celular o computador, para no escribirlos en cada pedido.
            No necesitas clave. <Link href="/tienda/privacidad" className="font-semibold text-marca-700 hover:underline">Cómo usamos tus datos</Link>
          </p>
        </div>
        <form onSubmit={guardar} className="flex flex-col gap-3" noValidate>
          {campo('nombre', 'Nombre', { autoComplete: 'name', placeholder: 'Ej. Ana Pérez' })}
          {campo('celular', 'Celular', { autoComplete: 'tel', inputMode: 'tel', placeholder: 'Ej. 9 1234 5678' })}
          {campo('correo', 'Correo (opcional)', { autoComplete: 'email', inputMode: 'email', type: 'email', placeholder: 'Ej. ana@correo.cl' })}
          <button className="btn btn-primario btn-grande mt-1">Guardar mis datos</button>
          {guardado && <p role="status" className="text-sm font-semibold text-exito">Listo, quedaron guardados.</p>}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">Mis pedidos</h2>
        {pedidos.length === 0 ? (
          <div className="tarjeta p-4 text-[var(--texto-suave)]">
            Todavía no envías pedidos desde este celular. <Link href="/tienda/productos" className="font-semibold text-marca-700 hover:underline">Ver productos</Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pedidos.map((p) => <Pedido key={p.codigo ?? p.fecha} pedido={p} estado={p.codigo ? estados[p.codigo]?.estado : undefined} />)}
          </ul>
        )}
        {(pedidos.length > 0 || datos.nombre) && (
          <button type="button" className="btn btn-fantasma btn-chico self-start"
            onClick={() => { if (confirm('¿Borrar tus datos, tus pedidos, tus favoritos y el carrito de este celular?')) { borrarMisDatos(); borrarFavoritosYVistos(); setForm({ nombre: '', celular: '', correo: '' }); } }}>
            Borrar mis datos de este celular
          </button>
        )}
      </section>

      <div className="lg:col-span-2">
        <ProductosGuardados cual="favoritos" titulo="Mis favoritos" id="favoritos"
          vacio={<>Todavía no guardas favoritos. Toca el corazón de un producto para tenerlo a mano. <Link href="/tienda/productos" className="font-semibold text-marca-700 hover:underline">Ver productos</Link></>} />
      </div>
    </div>
  );
}

function Pedido({ pedido, estado }: { pedido: PedidoEnviado; estado?: EstadoPedidoWeb }) {
  const [repetido, setRepetido] = useState(false);
  const unidades = pedido.lineas.reduce((s, l) => s + l.cantidad, 0);
  const fecha = new Date(pedido.fecha).toLocaleString('es-CL', {
    timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return (
    <li className="tarjeta p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{pedido.numero ? `N° ${pedido.numero} · ` : ''}{fecha}</span>
        <span className="text-lg font-extrabold num">{formatCLP(pedido.total)}</span>
      </div>
      {pedido.codigo && (
        <p className="flex items-center gap-2 flex-wrap text-sm">
          {estado && <span className={`insignia ${estado === 'cancelado' ? 'insignia-alerta' : estado === 'listo' ? 'insignia-ok' : 'insignia-neutra'}`}>{NOMBRE_ESTADO_PEDIDO[estado]}</span>}
          <Link href={`/tienda/pedido/${pedido.codigo}`} className="font-semibold text-marca-700 hover:underline min-h-11 inline-flex items-center">Ver cómo va →</Link>
        </p>
      )}
      {!pedido.codigo && <p className="text-xs text-[var(--texto-suave)]">Enviado por WhatsApp</p>}
      {unidades > 0 && (
        <p className="text-sm text-[var(--texto-suave)] line-clamp-2">
          {unidades} {unidades === 1 ? 'producto' : 'productos'}: {pedido.lineas.map((l) => `${l.cantidad} × ${l.nombre}`).join(', ')}
        </p>
      )}
      {pedido.lineas.length > 0 && (
        <button type="button" className="btn btn-secundario btn-chico self-start"
          onClick={() => { pedido.lineas.forEach((l) => agregarAlCarrito(l, l.cantidad)); setRepetido(true); }}>
          {repetido ? 'Agregado al carrito ✓' : 'Volver a pedir'}
        </button>
      )}
    </li>
  );
}
