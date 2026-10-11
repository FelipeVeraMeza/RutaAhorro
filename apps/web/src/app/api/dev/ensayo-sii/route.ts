import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isValidRut, esCorreoValido, formatRut } from '@rutaahorro/core';

/**
 * POST /api/dev/ensayo-sii — SOLO EN DESARROLLO (npm run dev).
 *
 * Felipe, 2026-10-11: "quiero ver qué hace". Al confirmar una venta con
 * factura en localhost, abre el robot del SII con esa venta (ventana a la
 * vista), llega hasta la vista previa del documento, la deja 90 s y sale. NO
 * firma ni emite: es `npm run ensayo-sii -- --desde-env` con las claves de
 * .env.local (SII_RUT, SII_CLAVE, SII_RUT_EMPRESA).
 *
 * En producción no existe: responde 404. Y solo atiende pedidos desde la
 * misma máquina.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  const host = new URL(request.url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return new Response(null, { status: 404 });

  const b = (await request.json().catch(() => null)) as {
    receptor?: { rut?: string; correo?: string; formaPago?: string };
    lineas?: Array<{ nombre: string; cantidad: number; precio: number }>;
  } | null;
  const rut = b?.receptor?.rut ?? '';
  if (!isValidRut(rut)) return Response.json({ error: 'RUT inválido' }, { status: 400 });
  const lineas = (b?.lineas ?? []).filter((l) => l && l.nombre && l.cantidad > 0 && l.precio > 0);
  if (lineas.length === 0 || lineas.length > 60) return Response.json({ error: 'Sin líneas' }, { status: 400 });
  const forma = ['contado', 'credito', 'sin_costo'].includes(b?.receptor?.formaPago ?? '') ? b!.receptor!.formaPago! : 'contado';

  const raiz = path.resolve(process.cwd(), '..', '..');
  const worker = path.join(raiz, 'apps', 'worker');
  const tsx = path.join(raiz, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const carpeta = path.join(raiz, 'tmp', `ensayo-caja-${sello}`);
  fs.mkdirSync(carpeta, { recursive: true });

  // Sin shell: cada argumento viaja tal cual, nada de lo que escribió el cajero se interpreta.
  // El nombre no puede llevar ";" (separa líneas) ni saltos.
  const texto = lineas.map((l) => `${String(l.nombre).replace(/[;\r\n]/g, ',').slice(0, 80)}:${l.cantidad}:${Math.round(l.precio)}`).join(';');
  const args = [tsx, '--env-file=../../.env.local', 'src/ensayo-sii.ts', '--desde-env', '--ver', '--pausa=90',
    `--receptor=${formatRut(rut)}`, `--forma-pago=${forma}`, `--lineas=${texto}`, `--capturas=${carpeta}`];
  if (esCorreoValido(b?.receptor?.correo)) args.push(`--contacto=${b!.receptor!.correo}`);
  if (process.env.SII_TELEFONO) args.push(`--telefono=${process.env.SII_TELEFONO}`);

  const log = fs.openSync(path.join(carpeta, 'robot.log'), 'w');
  const hijo = spawn(process.execPath, args, { cwd: worker, stdio: ['ignore', log, log], detached: true, windowsHide: false });
  hijo.unref();
  return Response.json({ ok: true, carpeta });
}
