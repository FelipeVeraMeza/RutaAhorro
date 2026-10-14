'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  DIAS_SEMANA, NOMBRE_DIA, enlaceWhatsApp, formatCLP, parsearTramos, toUserMessage, validarMonto, type DiaSemana,
} from '@rutaahorro/core';
import { guardarConfiguracion, type ConfiguracionLocal } from '@/lib/datos/configuracion';
import { Campo } from '@/components/Campo';

/**
 * Configuración → Tienda online (docs/33, 0041): recibir pedidos, el WhatsApp
 * de la tienda, el horario de atención, un aviso y el pedido mínimo.
 */
export function TiendaOnline({ config, onGuardado, onError }: {
  config: ConfiguracionLocal;
  onGuardado: (c: ConfiguracionLocal, texto: string) => void;
  onError: (texto: string) => void;
}) {
  const t = config.tienda;
  const [pedidos, setPedidos] = useState(t.pedidos);
  const [whatsapp, setWhatsapp] = useState(t.whatsapp);
  const [mensaje, setMensaje] = useState(t.mensaje);
  const [minimo, setMinimo] = useState(t.pedidoMinimo ? String(t.pedidoMinimo) : '');
  const [horario, setHorario] = useState<Record<DiaSemana, string>>(
    Object.fromEntries(DIAS_SEMANA.map((d) => [d, t.horario[d] ?? ''])) as Record<DiaSemana, string>);
  const [guardando, setGuardando] = useState(false);

  const vMinimo = validarMonto(minimo, { etiqueta: 'pedido mínimo', permiteVacio: true, maximo: 1_000_000 });
  const diasMalos = DIAS_SEMANA.filter((d) => parsearTramos(horario[d]) == null);
  const whatsappMalo = whatsapp.trim() !== '' && !enlaceWhatsApp(whatsapp, '');
  const puede = !guardando && vMinimo.valido && !diasMalos.length && !whatsappMalo && mensaje.length <= 200;

  async function guardar() {
    if (!puede) return;
    setGuardando(true);
    try {
      const c = await guardarConfiguracion({
        tienda_pedidos: pedidos,
        tienda_whatsapp: whatsapp.trim(),
        tienda_mensaje: mensaje.trim(),
        tienda_pedido_minimo: vMinimo.valor,
        tienda_horario: horario,
      });
      onGuardado(c, pedidos
        ? 'Tienda guardada. Los pedidos llegan a "Pedidos web" (los cambios se ven en la tienda en hasta un minuto).'
        : 'Tienda guardada (los cambios se ven en la tienda en hasta un minuto).');
    } catch (e) {
      onError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section aria-labelledby="t-tienda" className="space-y-4">
      <h2 id="t-tienda" className="sr-only">Tienda online</h2>

      <label className="tarjeta p-4 flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={pedidos} onChange={(e) => setPedidos(e.target.checked)}
          className="w-5 h-5 mt-0.5 accent-[var(--color-marca-500)]" />
        <span>
          <span className="font-semibold block">Recibir pedidos en la tienda</span>
          <span className="text-sm text-[var(--texto-suave)]">
            El cliente confirma su pedido para retirar y pagar en el local. Llegan a{' '}
            <Link href="/pedidos-web" className="underline">Pedidos web</Link>: revísalos durante el día.
            Apagado, la tienda solo deja enviar el carrito por WhatsApp.
          </span>
        </span>
      </label>

      <div className="tarjeta p-4 space-y-3">
        <Campo etiqueta="WhatsApp de la tienda" ayuda="Para consultas y para enviar el carrito. Vacío: el teléfono de la sucursal."
               error={whatsappMalo ? 'Escribe un número chileno, ej. +56 9 1234 5678' : null}>
          {(p) => <input {...p} inputMode="tel" value={whatsapp} maxLength={20} onChange={(e) => setWhatsapp(e.target.value)}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
        </Campo>
        <Campo etiqueta="Pedido mínimo" ayuda="Vacío o 0: sin mínimo." error={minimo !== '' && !vMinimo.valido ? vMinimo.error : null}>
          {(p) => <input {...p} inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value)}
                         className="tap w-40 px-3 rounded-lg border border-[var(--borde)] num text-right" />}
        </Campo>
        {vMinimo.valido && vMinimo.valor > 0 && <p className="-mt-2 text-sm text-[var(--texto-suave)] num">Mínimo {formatCLP(vMinimo.valor)}.</p>}
        <Campo etiqueta="Aviso arriba de la tienda" ayuda={`Ej. "Cerrado el 18 por feriado". Vacío: sin aviso. ${mensaje.length}/200`}>
          {(p) => <input {...p} value={mensaje} maxLength={200} onChange={(e) => setMensaje(e.target.value)}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
        </Campo>
      </div>

      <fieldset className="tarjeta p-4 space-y-2">
        <legend className="font-semibold px-1">Horario de atención</legend>
        <p className="text-sm text-[var(--texto-suave)]">Como lo escribirías: «09:00-21:00» o «9-14, 16-21». Vacío: ese día no abre.</p>
        {DIAS_SEMANA.map((d) => (
          <label key={d} className="flex items-center gap-3">
            <span className="w-24 capitalize text-sm">{NOMBRE_DIA[d]}</span>
            <input value={horario[d]} maxLength={40} placeholder="Cerrado" aria-invalid={diasMalos.includes(d)}
              onChange={(e) => setHorario({ ...horario, [d]: e.target.value })}
              className={`tap flex-1 px-3 rounded-lg border num ${diasMalos.includes(d) ? 'border-[var(--color-alerta)]' : 'border-[var(--borde)]'}`} />
          </label>
        ))}
        {diasMalos.length > 0 && (
          <p role="alert" className="text-sm text-[var(--color-alerta)]">
            No se entiende el horario del {diasMalos.map((d) => NOMBRE_DIA[d]).join(', ')}. Ej.: 09:00-14:00, 16:00-21:00.
          </p>
        )}
      </fieldset>

      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={!puede} onClick={() => void guardar()} className="btn btn-primario">
          {guardando ? 'Guardando…' : 'Guardar tienda'}
        </button>
        <a href="/tienda" target="_blank" rel="noopener noreferrer" className="btn btn-secundario">Ver la tienda</a>
      </div>
    </section>
  );
}
