'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toUserMessage, isValidRut, formatRut } from '@rutaahorro/core';
import { Campo } from '@/components/Campo';
import { useFormatoFecha } from '@/lib/formatoFecha';
import { repoFacturacion, type EstadoEmisionSii } from '@/lib/datos/facturacion';

/**
 * El emisor real: el robot que emite en el portal del SII (0026), solo para
 * el administrador. Apagado hasta que el cliente entregue su clave tributaria
 * y la del certificado digital (B-04, B-05). Las claves se guardan cifradas en
 * el servidor y no vuelven nunca a la pantalla.
 */
export function EmisorSii() {
  const { fechaHora } = useFormatoFecha();
  const [estado, setEstado] = useState<EstadoEmisionSii | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rutUsuario, setRutUsuario] = useState('');
  const [rutEmpresa, setRutEmpresa] = useState('');
  const [claveSii, setClaveSii] = useState('');
  const [claveCert, setClaveCert] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try { setEstado(await repoFacturacion().estadoSii()); setError(null); }
    catch (e) { setError(toUserMessage(e)); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    setError(null); setAviso(null);
    if (!isValidRut(rutUsuario)) { setError('El RUT de la persona que entra al SII no es válido'); return; }
    if (!isValidRut(rutEmpresa)) { setError('El RUT de la empresa emisora no es válido'); return; }
    if (claveSii.length < 4 || claveCert.length < 4) { setError('Faltan la clave tributaria o la del certificado'); return; }
    setGuardando(true);
    try {
      await repoFacturacion().guardarCredenciales({
        rut_usuario: formatRut(rutUsuario), rut_empresa: formatRut(rutEmpresa), clave_sii: claveSii, clave_certificado: claveCert,
      });
      setClaveSii(''); setClaveCert('');
      setAviso('Credenciales guardadas, cifradas. Antes de encender falta el ensayo con ellas (paso 3).');
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  async function activar(activa: boolean) {
    setError(null); setAviso(null);
    try { setEstado(await repoFacturacion().activarSii(activa)); }
    catch (e) { setError(toUserMessage(e)); }
  }

  async function borrar() {
    setError(null); setAviso(null);
    try { await repoFacturacion().borrarCredenciales(); setAviso('Credenciales borradas: la emisión real queda apagada.'); await cargar(); }
    catch (e) { setError(e instanceof Error ? e.message : toUserMessage(e)); }
  }

  const c = 'tap w-full px-3 rounded-xl border border-[var(--borde)] bg-white';
  return (
    <div className="space-y-4">
      <section className="tarjeta p-3 space-y-2">
        <h2 className="font-semibold">Estado</h2>
        {!estado ? <p className="text-sm text-[var(--texto-suave)]" aria-busy="true">Cargando…</p> : (
          <>
            <p className={`text-sm px-3 py-2 rounded-lg ${estado.activa ? 'bg-marca-100 text-marca-900' : 'bg-amber-50 text-amber-900'}`}>
              {estado.activa
                ? '🟢 Emitiendo en el SII: las facturas nuevas van a la cola del robot y reciben el folio del SII.'
                : '🟡 Apagado: las facturas se emiten simuladas (sin validez tributaria).'}
            </p>
            <p className="text-sm">
              Credenciales: {estado.credenciales
                ? <>guardadas · entra {estado.rutUsuario}, emite {estado.rutEmpresa}
                    {estado.actualizadoEn && <> · {fechaHora(estado.actualizadoEn)}</>}</>
                : 'no guardadas'}
            </p>
            {(estado.enCola > 0 || estado.conError > 0) && (
              <p className="text-sm">En cola: {estado.enCola} · con error: {estado.conError}</p>
            )}
            {/* 0028: lo que falta, en orden. Encender exige los tres. */}
            <ol data-pasos className="text-sm space-y-2 pt-1" aria-label="Para emitir en el SII">
              <Paso hecho={estado.emisor} titulo="1. Datos del emisor">
                {estado.emisor ? 'Razón social, giro y dirección listos.'
                  : <>Faltan: se cargan en <Link href="/configuracion" className="underline">Configuración</Link>.</>}
              </Paso>
              <Paso hecho={estado.credenciales} titulo="2. Credenciales del SII">
                {estado.credenciales ? 'Guardadas, cifradas.' : 'Faltan: clave tributaria, clave del certificado y RUT de la empresa (abajo).'}
              </Paso>
              <Paso hecho={estado.ensayoVigente} titulo="3. Ensayo en el portal, sin firmar">
                {estado.ensayoVigente && estado.ultimoEnsayo
                  ? <>Pasó el {fechaHora(estado.ultimoEnsayo.en)}: el SII reconoció a «{estado.ultimoEnsayo.razonSocialSii}» y
                      calculó el mismo total. No se emitió nada.</>
                  : estado.ultimoEnsayo && !estado.ultimoEnsayo.ok
                    ? <>El último ({fechaHora(estado.ultimoEnsayo.en)}) no pasó: {estado.ultimoEnsayo.error}</>
                    : <>Falta. Con las credenciales guardadas, el equipo técnico corre{' '}
                        <code className="text-xs">npm run ensayo-sii</code>: recorre el portal real y se detiene antes de firmar.
                        Cambiar las credenciales pide un ensayo nuevo.</>}
              </Paso>
            </ol>
            <p className="text-xs bg-amber-50 text-amber-900 px-3 py-2 rounded-lg">
              Con la emisión encendida, solo las facturas hechas aquí van al SII. La opción “Factura” del punto de venta sigue
              siendo simulada: por ahora, las facturas se hacen en esta pantalla.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => void activar(!estado.encendida)}
                      disabled={!estado.encendida && !(estado.emisor && estado.credenciales && estado.ensayoVigente)}
                      className="tap rounded-xl border border-[var(--borde)] text-sm font-semibold disabled:opacity-50">
                {estado.encendida ? 'Apagar' : 'Encender'}
              </button>
              {estado.credenciales && (
                <button onClick={() => void borrar()}
                        className="tap rounded-xl border border-[var(--color-alerta)] text-[var(--color-alerta)] text-sm font-semibold">
                  Borrar credenciales
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="tarjeta p-3 space-y-3">
        <h2 className="font-semibold">{estado?.credenciales ? 'Reemplazar credenciales' : 'Credenciales del SII'}</h2>
        <p className="text-xs text-[var(--texto-suave)]">
          El robot entra al portal de facturación gratuito del SII con la clave tributaria de una persona autorizada, elige
          la empresa y firma con la clave de su certificado digital. Las claves se cifran en el servidor y no se vuelven a
          mostrar. Los datos que salen impresos (razón social, giro, dirección) se configuran en{' '}
          <Link href="/configuracion" className="underline">Configuración</Link>.
        </p>
        <Campo etiqueta="RUT de quien entra al SII" obligatorio ayuda="La persona, no la empresa">
          {(p) => <input {...p} value={rutUsuario} onChange={(e) => setRutUsuario(e.target.value)} autoComplete="off" className={c} />}
        </Campo>
        <Campo etiqueta="Clave tributaria (SII)" obligatorio>
          {(p) => <input {...p} type="password" value={claveSii} onChange={(e) => setClaveSii(e.target.value)} autoComplete="new-password" className={c} />}
        </Campo>
        <Campo etiqueta="Clave del certificado digital" obligatorio ayuda="La que se escribe al firmar una factura en el portal">
          {(p) => <input {...p} type="password" value={claveCert} onChange={(e) => setClaveCert(e.target.value)} autoComplete="new-password" className={c} />}
        </Campo>
        <Campo etiqueta="RUT de la empresa que emite" obligatorio>
          {(p) => <input {...p} value={rutEmpresa} onChange={(e) => setRutEmpresa(e.target.value)} autoComplete="off" className={c} />}
        </Campo>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        {aviso && <p role="status" className="text-sm bg-marca-100 text-marca-900 px-3 py-2 rounded-lg">✓ {aviso}</p>}
        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar cifradas'}
        </button>
      </section>

      <p className="text-xs text-[var(--texto-suave)]">
        Pendiente conocido: una factura con impuesto adicional (IABA, ILA) todavía no se emite por el robot; queda con error
        y se emite a mano en el portal. Las notas de crédito de facturas reales, también en el portal por ahora.
      </p>
    </div>
  );
}

/** Un paso de la lista: la marca y el texto dicen lo mismo, el color no va solo (RNF-46). */
function Paso({ hecho, titulo, children }: { hecho: boolean; titulo: string; children: React.ReactNode }) {
  return (
    <li className={`rounded-lg px-3 py-2 ${hecho ? 'bg-marca-50 text-marca-900' : 'bg-gray-50 text-[var(--texto)]'}`}>
      <p className="font-medium">{hecho ? '✔' : '✖'} {titulo} · {hecho ? 'listo' : 'pendiente'}</p>
      <p className="text-xs mt-0.5">{children}</p>
    </li>
  );
}
