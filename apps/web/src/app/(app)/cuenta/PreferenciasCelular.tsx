'use client';

import { useEffect, useState } from 'react';
import {
  leerPreferencias, guardarPreferencias, PREFERENCIAS_POR_OMISION, type Preferencias,
} from '@/lib/preferencias';

const BLOQUEOS = [0, 2, 5, 10, 15, 30];

/** Letra grande (RNF-59) y bloqueo por inactividad (RF-M1-19), de este aparato. */
export function PreferenciasCelular() {
  const [pref, setPref] = useState<Preferencias>(PREFERENCIAS_POR_OMISION);
  const [guardado, setGuardado] = useState(false);
  useEffect(() => setPref(leerPreferencias()), []);

  function cambiar(p: Partial<Preferencias>) {
    const nuevo = { ...pref, ...p };
    setPref(nuevo);
    guardarPreferencias(nuevo);
    setGuardado(true);
  }

  return (
    <section className="tarjeta p-4" aria-labelledby="t-pref">
      <h2 id="t-pref" className="font-semibold">En este celular</h2>
      <p className="text-xs text-[var(--texto-suave)] mb-3">
        Se guarda en este aparato, no en tu cuenta: si otra persona usa este celular, lo ve igual.
      </p>

      <fieldset className="mb-4">
        <legend className="text-sm font-medium mb-1.5">Tamaño de la letra</legend>
        <div className="flex gap-2" role="radiogroup">
          {(['normal', 'grande'] as const).map((l) => (
            <label key={l} className={`btn ${pref.letra === l ? 'btn-primario' : 'btn-secundario'} cursor-pointer`}>
              <input type="radio" name="letra" value={l} className="sr-only"
                checked={pref.letra === l} onChange={() => cambiar({ letra: l })} />
              {l === 'normal' ? 'Normal' : 'Grande'}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm font-medium" htmlFor="bloqueo">Bloquear la pantalla si nadie la usa</label>
      <select id="bloqueo" className="tap mt-1.5 w-full max-w-xs rounded-xl border border-[var(--borde)] px-3 py-2"
        value={pref.bloqueoMin} onChange={(e) => cambiar({ bloqueoMin: Number(e.target.value) })}>
        {BLOQUEOS.map((m) => (
          <option key={m} value={m}>{m === 0 ? 'Nunca' : `Después de ${m} minutos`}</option>
        ))}
      </select>
      <p className="text-xs text-[var(--texto-suave)] mt-1.5">
        Útil si el celular queda en el mostrador: para volver a usarlo se pide tu contraseña.
        Una venta a medio cobrar no se pierde.
      </p>
      <p role="status" className="text-xs text-[var(--color-marca-600)] mt-2 min-h-4">
        {guardado ? 'Guardado en este celular.' : ''}
      </p>
    </section>
  );
}
