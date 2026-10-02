'use client';

import { useState } from 'react';
import { toUserMessage } from '@rutaahorro/core';
import { Campo } from '@/components/Campo';
import { repoAutorizaciones } from '@/lib/datos/autorizaciones';

/**
 * El PIN con que John o María José autorizan descuentos en el celular del
 * vendedor (RQ-17, 0036). No se muestra nunca: solo se cambia.
 */
export function PinAutorizacion({ yo }: { yo: { id: string; nombre: string; tope: number } }) {
  const [pin, setPin] = useState('');
  const [otra, setOtra] = useState('');
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setEstado(null);
    if (!/^\d{4,6}$/.test(pin)) { setEstado({ tipo: 'error', texto: 'El PIN son 4 a 6 números' }); return; }
    if (pin !== otra) { setEstado({ tipo: 'error', texto: 'Los dos PIN no coinciden' }); return; }
    setGuardando(true);
    try {
      await repoAutorizaciones().guardarPin(pin, yo);
      setPin(''); setOtra('');
      setEstado({ tipo: 'ok', texto: 'PIN guardado. Con él autorizas descuentos en el celular de un vendedor.' });
    } catch (e) {
      setEstado({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="tarjeta p-4" aria-labelledby="t-pin">
      <h2 id="t-pin" className="font-semibold mb-1">PIN para autorizar descuentos</h2>
      <p className="text-xs text-[var(--texto-suave)] mb-3">
        Cuando un vendedor necesita hacer un descuento mayor al suyo, escribes este PIN en su
        celular. Autorizas hasta tu propio tope ({yo.tope} %). No lo compartas.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="PIN nuevo">
          {(p) => <input {...p} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6}
                         value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)] num" />}
        </Campo>
        <Campo etiqueta="Repítelo">
          {(p) => <input {...p} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6}
                         value={otra} onChange={(e) => setOtra(e.target.value.replace(/\D/g, ''))}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)] num" />}
        </Campo>
      </div>
      {estado && (
        <p role={estado.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm mt-2 ${estado.tipo === 'error' ? 'text-[var(--color-alerta)]' : 'text-marca-700'}`}>{estado.texto}</p>
      )}
      <button onClick={() => void guardar()} disabled={guardando} className="btn btn-primario mt-3">
        {guardando ? 'Guardando…' : 'Guardar PIN'}
      </button>
    </section>
  );
}
