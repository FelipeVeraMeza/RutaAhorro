'use client';

import { useEffect, useState } from 'react';
import { toUserMessage } from '@rutaahorro/core';
import { supabase } from '@/lib/supabase/client';
import { DEMO_ACTIVO } from '@/lib/demo';

/**
 * RF-T57 · "Se muestra en la tienda online" en la ficha de un producto
 * (0040, `fn_publicar_en_tienda`). Se guarda al tocarlo, aparte del resto del
 * formulario. Sin 0040 en la base no aparece.
 */
export function PublicarEnTienda({ productoId }: { productoId: string }) {
  const [publicado, setPublicado] = useState<boolean | null>(DEMO_ACTIVO ? true : null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (DEMO_ACTIVO) return;
    let vivo = true;
    void supabase().from('products').select('publicado_tienda').eq('id', productoId).maybeSingle()
      .then(({ data, error }) => { if (vivo && !error && data) setPublicado(Boolean((data as { publicado_tienda: boolean }).publicado_tienda)); });
    return () => { vivo = false; };
  }, [productoId]);

  if (publicado == null) return null;

  async function cambiar(valor: boolean) {
    setGuardando(true);
    setMensaje(null);
    try {
      if (!DEMO_ACTIVO) {
        const { error } = await supabase().rpc('fn_publicar_en_tienda', { p_ids: [productoId], p_publicado: valor });
        if (error) throw error;
      }
      setPublicado(valor);
      setMensaje(valor ? 'Se muestra en la tienda (en hasta un minuto).' : 'Ya no se muestra en la tienda (en hasta un minuto).');
    } catch (e) {
      setMensaje(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--borde)] p-3">
      <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
        <input type="checkbox" checked={publicado} disabled={guardando} onChange={(e) => void cambiar(e.target.checked)}
          className="w-5 h-5 mt-0.5 accent-[var(--color-marca-500)]" />
        <span>
          <span className="text-sm font-semibold block">Se muestra en la tienda online</span>
          <span className="text-xs text-[var(--texto-suave)]">Desmárcalo para que los clientes no lo vean ni lo pidan. En el local se sigue vendiendo igual.</span>
        </span>
      </label>
      {mensaje && <p role="status" className="text-xs mt-1 text-[var(--texto-suave)]">{mensaje}</p>}
    </div>
  );
}
