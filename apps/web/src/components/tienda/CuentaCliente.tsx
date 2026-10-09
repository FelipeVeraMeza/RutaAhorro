'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCLP, validarDatosCliente, type DatosCliente } from '@rutaahorro/core';
import { agregarAlCarrito } from '@/lib/tienda/carrito';
import { borrarMisDatos, guardarDatosCliente, useDatosCliente, usePedidos, type PedidoEnviado } from '@/lib/tienda/cliente';

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
            No necesitas clave.
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
            {pedidos.map((p) => <Pedido key={p.fecha} pedido={p} />)}
          </ul>
        )}
        {(pedidos.length > 0 || datos.nombre) && (
          <button type="button" className="btn btn-fantasma btn-chico self-start"
            onClick={() => { if (confirm('¿Borrar tus datos y tus pedidos de este celular?')) { borrarMisDatos(); setForm({ nombre: '', celular: '', correo: '' }); } }}>
            Borrar mis datos de este celular
          </button>
        )}
      </section>
    </div>
  );
}

function Pedido({ pedido }: { pedido: PedidoEnviado }) {
  const [repetido, setRepetido] = useState(false);
  const unidades = pedido.lineas.reduce((s, l) => s + l.cantidad, 0);
  const fecha = new Date(pedido.fecha).toLocaleString('es-CL', {
    timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return (
    <li className="tarjeta p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{fecha}</span>
        <span className="text-lg font-extrabold num">{formatCLP(pedido.total)}</span>
      </div>
      <p className="text-sm text-[var(--texto-suave)] line-clamp-2">
        {unidades} {unidades === 1 ? 'producto' : 'productos'}: {pedido.lineas.map((l) => `${l.cantidad} × ${l.nombre}`).join(', ')}
      </p>
      <button type="button" className="btn btn-secundario btn-chico self-start"
        onClick={() => { pedido.lineas.forEach((l) => agregarAlCarrito(l, l.cantidad)); setRepetido(true); }}>
        {repetido ? 'Agregado al carrito ✓' : 'Volver a pedir'}
      </button>
    </li>
  );
}
