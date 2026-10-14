'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatCLP, LIMITES_PEDIDO_WEB, validarPedidoWeb, type CarritoCalculado, type DatosCliente,
} from '@rutaahorro/core';
import { vaciarCarrito, type ProductoAlDia } from '@/lib/tienda/carrito';
import { anotarPedido, guardarDatosCliente, useDatosCliente } from '@/lib/tienda/cliente';

const CAMPO = 'w-full min-h-12 px-3 rounded-xl border border-[var(--borde)] bg-[var(--superficie)] focus:outline-2 focus:outline-marca-500';
/** El identificador del intento: el mismo en un reintento, así un corte de red no duplica el pedido (RNF-T48). */
const CLAVE_INTENTO = 'tienda:intento-pedido';

/** Se reusa solo para el MISMO carrito: si el cliente cambió algo, es otro pedido. */
function intento(firma: string): string {
  try {
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE_INTENTO) ?? 'null') as { firma: string; id: string } | null;
    if (guardado?.firma === firma) return guardado.id;
    const nuevo = { firma, id: crypto.randomUUID() };
    sessionStorage.setItem(CLAVE_INTENTO, JSON.stringify(nuevo));
    return nuevo.id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * RF-T45 a RF-T48 · Confirmar el pedido en la tienda (docs/33): retiro en el
 * local, con nombre y celular obligatorios y una nota. Queda en el sistema con
 * su número; el local lo ve en "Pedidos web" y el cliente sigue su estado con
 * el enlace.
 */
export function ConfirmarPedido({ carrito, direccion, pedidoMinimo, notaInicial, onNota, onPonerAlDia }: {
  carrito: CarritoCalculado;
  direccion: string | null;
  pedidoMinimo: number;
  notaInicial: string;
  onNota: (n: string) => void;
  /** Cuando el servidor dice que algo cambió: volver a leer los precios del carrito. */
  onPonerAlDia: (productos?: ProductoAlDia[]) => void;
}) {
  const router = useRouter();
  const { valor: guardados, listo } = useDatosCliente();
  const [datos, setDatos] = useState<DatosCliente>(guardados);
  const [nota, setNota] = useState(notaInicial);
  const [recordar, setRecordar] = useState(true);
  const [errores, setErrores] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const trampa = useRef<HTMLInputElement>(null);
  const faltaMinimo = Math.max(0, pedidoMinimo - carrito.total);

  useEffect(() => { if (listo) setDatos(guardados); }, [listo, guardados]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enCurso.current) return;
    const pedido = { cliente: datos, lineas: carrito.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad })), nota };
    const problemas = validarPedidoWeb(pedido);
    if (faltaMinimo > 0) problemas.push(`Te faltan ${formatCLP(faltaMinimo)} para el pedido mínimo de ${formatCLP(pedidoMinimo)}.`);
    setErrores(problemas);
    if (problemas.length) return;
    enCurso.current = true;
    setEnviando(true);
    try {
      const r = await fetch('/api/tienda/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_uuid: intento(JSON.stringify([pedido.lineas, datos, nota])), cliente: datos, nota, total_visto: carrito.total,
          lineas: pedido.lineas, empresa: trampa.current?.value ?? '',
        }),
      });
      const c = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrores([c?.error?.message ?? 'No se pudo hacer el pedido. Intenta de nuevo.']);
        if (r.status === 409) onPonerAlDia();
        return;
      }
      try { sessionStorage.removeItem(CLAVE_INTENTO); } catch { /* sin almacenamiento */ }
      if (recordar) guardarDatosCliente(datos);
      anotarPedido({ fecha: new Date().toISOString(), lineas: carrito.lineas.map(({ id, nombre, precio, tramos, cantidad }) => ({ id, nombre, precio, tramos, cantidad })), total: c.total, numero: c.numero, codigo: c.codigo });
      vaciarCarrito();
      onNota('');
      router.push(`/tienda/pedido/${c.codigo}?nuevo=1`);
    } catch {
      setErrores(['Sin conexión. Revisa internet y vuelve a tocar "Hacer pedido": no se va a duplicar.']);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  const campo = (k: keyof DatosCliente, etiqueta: string, extra: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="flex flex-col gap-1">
      <span className="font-semibold text-sm">{etiqueta}</span>
      <input className={CAMPO} value={datos[k]} onChange={(e) => setDatos({ ...datos, [k]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3" noValidate aria-labelledby="t-confirmar">
      <h2 id="t-confirmar" className="text-lg font-extrabold">Confirmar pedido</h2>
      <p className="text-sm rounded-xl bg-[var(--fondo)] p-3">
        <strong>Retiro en el local</strong>{direccion ? `: ${direccion}` : ''}. Pagas al retirar. Te avisamos al celular cuando esté listo.
      </p>
      {campo('nombre', 'Tu nombre', { autoComplete: 'name', required: true, maxLength: LIMITES_PEDIDO_WEB.nombre, placeholder: 'Ej. Ana Pérez' })}
      {campo('celular', 'Celular', { autoComplete: 'tel', inputMode: 'tel', required: true, maxLength: 20, placeholder: 'Ej. 9 1234 5678' })}
      {campo('correo', 'Correo (opcional)', { autoComplete: 'email', inputMode: 'email', type: 'email', maxLength: 120 })}
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-sm">Nota para el local (opcional)</span>
        <textarea className={`${CAMPO} py-2 min-h-20`} value={nota} maxLength={LIMITES_PEDIDO_WEB.nota}
          placeholder="Ej. pan bien tostado, retiro después de las 18:00"
          onChange={(e) => { setNota(e.target.value); onNota(e.target.value); }} />
        <span className="text-xs text-[var(--texto-suave)] self-end num">{nota.length}/{LIMITES_PEDIDO_WEB.nota}</span>
      </label>
      {/* Para robots: una persona no ve ni llena este campo. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label>Empresa <input ref={trampa} name="empresa" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className="flex items-center gap-2.5 min-h-11 text-sm cursor-pointer">
        <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} className="size-5 accent-[var(--color-marca-500)]" />
        Guardar mis datos en este celular para el próximo pedido
      </label>
      {errores.length > 0 && (
        <ul role="alert" className="text-sm rounded-xl bg-[#fef2f2] text-alerta p-3 flex flex-col gap-1">
          {errores.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {faltaMinimo > 0 && !errores.length && (
        <p className="text-sm rounded-xl bg-acento-50 p-3">Pedido mínimo {formatCLP(pedidoMinimo)}: te faltan <strong className="num">{formatCLP(faltaMinimo)}</strong>.</p>
      )}
      <button className="btn btn-acento btn-grande" disabled={enviando} aria-busy={enviando}>
        {enviando ? 'Enviando…' : `Hacer pedido · ${formatCLP(carrito.total)}`}
      </button>
      <p className="text-xs text-[var(--texto-suave)]">
        Al pedir, el local recibe tu nombre y celular para preparar y entregar el pedido.{' '}
        <Link href="/tienda/privacidad" className="underline">Cómo usamos tus datos</Link>
      </p>
    </form>
  );
}
