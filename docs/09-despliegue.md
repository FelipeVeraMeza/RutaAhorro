# 09 — Plan de despliegue y entornos

> Plataforma definida en [ADR-008](adr/ADR-008-railway-servicio-unico.md), que
> supera a ADR-003 (Vercel + Railway). Todo corre en **un solo servicio de
> Railway**.

---

## 1. Entornos

| Entorno | Aplicación | Base de datos | Para qué |
|---|---|---|---|
| **Local** | `localhost:3000` | Supabase `dev`, o IndexedDB con `NEXT_PUBLIC_DEMO=true` | Desarrollo diario |
| **Producción** | Railway (un servicio) | Proyecto Supabase `amlvspbmnhtvzuqiteqe` | El local del cliente |

No hay entorno de preview. Se perdió al dejar Vercel: revisar un cambio antes de
fusionarlo vuelve a ser local ([ADR-008](adr/ADR-008-railway-servicio-unico.md)).

> **Recomendación fuerte:** crear un **segundo proyecto Supabase** para desarrollo
> y dejar `amlvspbmnhtvzuqiteqe` exclusivamente para producción. Probar la carga
> masiva o un ajuste de stock contra la base del cliente es la forma más rápida de
> perder su confianza. El proyecto extra en plan gratuito cuesta $0.
> Ver pregunta P-14 en [15](15-preguntas-abiertas.md).

---

## 2. Entorno local (localhost)

### 2.1 Requisitos
- Node.js 22 (fijado en `.node-version`) · npm 10+ · Git
- El repositorio usa **npm workspaces**, no pnpm. `npm install` desde la raíz.

### 2.2 Puesta en marcha

```bash
git clone https://github.com/FelipeVeraMeza/RutaAhorro.git
cd RutaAhorro
npm install

# Las variables van en .env.local en la RAÍZ del repo (no se comitea).
# Si partes de cero: cp .env.example .env.local y completar.

npm run dev        # web en :3000
```

Con `NEXT_PUBLIC_DEMO=true` la aplicación abre sin login contra IndexedDB, con
datos de ejemplo y un selector de rol. Sirve para recorrer la interfaz sin tocar
Supabase. **Nunca se configura en Railway.**

| Comando | Qué hace |
|---|---|
| `npm run dev` | Frontend en `:3000` |
| `npm run dev:worker` | Worker en `:8080` (no se levanta con `npm run dev`) |
| `npm run build:web` | Compila core + frontend — lo mismo que corre Railway |
| `npm run build` | Compila core + worker |
| `npm test` | Pruebas unitarias de `@rutaahorro/core` |
| `npm run typecheck` | Verificación de tipos en todos los paquetes |
| `npm run db:check` | Valida la sintaxis SQL de las migraciones |
| `npm run db:bundle` | Genera `supabase/bundle.sql` con las migraciones en orden |
| `npm run job -w @rutaahorro/worker` | Lista y ejecuta los trabajos programados |

### 2.3 Aplicar el esquema a Supabase

No existe `supabase/config.toml`, así que el proyecto **no** está enlazado al CLI
de Supabase y `supabase db push` no aplica. El procedimiento es:

```bash
npm run db:bundle          # concatena supabase/migrations/*.sql en orden
```

Pegar el contenido de `supabase/bundle.sql` en el **SQL Editor** de Supabase y
ejecutarlo. Después, `supabase/seed.sql` de la misma forma.

`bundle.sql` está en `.gitignore`: es un archivo generado, no una fuente. La
fuente son las migraciones numeradas.

### 2.4 Probar el escáner desde el celular

La cámara del navegador exige un contexto seguro. `http://localhost` está exento,
pero `http://192.168.1.x:3000` **no lo está**: si abres la app desde el celular
apuntando a la IP del PC, la cámara simplemente no aparece.

```bash
# Túnel HTTPS temporal hacia el localhost
npx localtunnel --port 3000
# o
cloudflared tunnel --url http://localhost:3000
```

La URL `https://…` que entrega el túnel debe agregarse temporalmente a las
**Redirect URLs** de Supabase (§4.2) y **retirarse después**.

---

## 3. Despliegue en Railway

### 3.1 El servicio

Un servicio, construido desde `main` del repositorio de GitHub.

| Ajuste | Valor |
|---|---|
| Source Repo | `FelipeVeraMeza/RutaAhorro`, rama `main` |
| **Root Directory** | `/` |
| Builder | Railpack (el default actual de Railway) |
| Custom Build Command | `npm ci --include=dev && npm run build:web` |
| Custom Start Command | `npm run start -w @rutaahorro/web` |
| Healthcheck Path | `/manifest.webmanifest` |
| Watch Paths | `/apps/web/**`, `/packages/core/**`, `/package.json`, `/package-lock.json` |
| Serverless | **OFF** |
| Restart Policy | `ON_FAILURE`, máximo 10 reintentos |

Tres cosas que no son evidentes y rompen el despliegue si se cambian:

**Root Directory tiene que ser `/`.** Apuntarlo a `apps/web` parece lo natural,
pero desde ahí `npm ci` no puede resolver `"@rutaahorro/core": "*"`: ese paquete
no está publicado en npm, vive en `packages/core` y solo existe para npm si el
install corre desde la raíz del workspace.

**El `--include=dev` del build no es decorativo.** Railway define
`NODE_ENV=production`, y con eso `npm ci` omite las devDependencies — o sea,
TypeScript, Tailwind y los `@types`. El `next build` muere ahí.

**Serverless apagado.** Con escalado a cero, la primera venta después de un rato
de inactividad espera a que el contenedor despierte. En una caja con un cliente
al frente, eso no se acepta.

El healthcheck apunta a `/manifest.webmanifest` y no a `/` a propósito: el
middleware excluye ese archivo, así que la verificación no depende de que
Supabase responda. Un healthcheck que falla porque se cayó un tercero reinicia
un contenedor que estaba sano.

> **Config as Code no está disponible.** Railway lo deprecó: los archivos
> existentes siguen leyéndose hasta el 2026-12-01, pero los servicios creados
> desde el 2026-08-28 no pueden activarlo. Por eso esta configuración vive en el
> panel, y este documento es su única copia. Si se cambia en el panel, se cambia
> acá.

La versión de Node la fija `.node-version` (22) en la raíz. Es deliberado que no
sea una variable del builder: `engines` dice `>=22` y deja la elección al
proveedor, y el nombre de la variable depende de cuál sea
(`NIXPACKS_NODE_VERSION` con Nixpacks, `RAILPACK_NODE_VERSION` con Railpack). El
archivo funciona con cualquiera, y además con nvm/fnm en local.

### 3.2 Variables de entorno

| Variable | Valor | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://amlvspbmnhtvzuqiteqe.supabase.co` | Viaja al navegador |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable | Viaja al navegador. Su seguridad depende 100 % de RLS |
| `SUPABASE_SECRET_KEY` | service_role / `sb_secret_` | **Secreta.** Solo servidor |
| `NEXT_PUBLIC_DEMO` | `false` | Jamás `true` en Railway |
| `NEXT_PUBLIC_APP_ENV` | `production` | |
| `NEXT_PUBLIC_APP_URL` | `https://<dominio>` | Se carga después de generar el dominio (§3.3) |
| `TZ` | `America/Santiago` | |

**Sobre `SUPABASE_SECRET_KEY` donde corre el frontend.** ADR-003 y la versión
anterior de este documento decían que la llave de servicio no debía estar ahí.
Es incorrecto para este código:
`apps/web/src/app/api/usuarios/invitar/route.ts` la necesita para
`auth.admin.inviteUserByEmail` — crear un usuario en Supabase Auth exige omitir
RLS. Es un route handler de servidor y la llave no entra al bundle del cliente.
Sin ella, invitar usuarios responde 500 con `ERROR_INTERNO`.

**No configurar `DATABASE_URL`.** No se usa en ninguna parte del código. Se pedía
para el `pg_dump` del worker, pero el respaldo hace export lógico vía supabase-js
(`apps/worker/src/jobs/backup.ts`). Es un secreto de más sin nada a cambio.

### 3.3 Dominio y orden de despliegue

Las variables `NEXT_PUBLIC_*` **se hornean en el bundle durante el build**.
Cambiarlas sin reconstruir no tiene ningún efecto, y el síntoma es silencioso:
el correo de invitación sale con un `redirectTo` vacío y el empleado aterriza en
una página en blanco. De ahí el orden:

```
1. Aplicar el esquema en Supabase (§2.3)   ← sin esto la app carga y toda consulta falla
2. Configurar el servicio y las variables, menos NEXT_PUBLIC_APP_URL
3. Deploy
4. Settings → Networking → Generate Domain
5. Cargar NEXT_PUBLIC_APP_URL con ese dominio y REDESPLEGAR
6. Registrar el dominio en Supabase (§4.2)
7. Recorrer la lista de comprobación de §7
```

### 3.4 El worker: por qué no está desplegado

El worker (`apps/worker`) compila, tiene sus siete trabajos escritos y no está
desplegado. La razón y el criterio para activarlo están en
[ADR-008](adr/ADR-008-railway-servicio-unico.md): hoy no lo invoca ningún archivo
del frontend, y un respaldo diario de una base sin datos productivos no vale
nada.

Mientras tanto, los trabajos se ejecutan a mano desde cualquier máquina con el
`.env.local` completo:

```bash
npm run job -w @rutaahorro/worker                 # lista los trabajos disponibles
npm run job -w @rutaahorro/worker backup-daily
```

| Trabajo | Horario previsto | Qué hace |
|---|---|---|
| `backup-daily` | 03:00 | Respaldo completo de la base |
| `cleanup-old-backups` | 04:30 | Elimina respaldos fuera del período de retención |
| `low-stock-check` | 08:00 | Alertas de productos bajo stock mínimo |
| `expiry-check` | 08:15 | Alertas de lotes vencidos y por vencer |
| `daily-summary` | 22:00 | Correo de resumen del día al administrador |
| `open-cash-check` | 23:30 | Avisa cajas que quedaron sin cerrar |
| `integrity-check` | domingos 04:00 | Reconstruye el stock desde el kardex y verifica lotes |

**Cuándo deja de ser aceptable:** antes de la primera venta real del cliente.
Desde ahí hay datos que perder. Para activarlo, un segundo servicio en el mismo
proyecto de Railway:

| Ajuste | Valor |
|---|---|
| Root Directory | `/` |
| Build | `npm ci --include=dev && npm run build` |
| Start | `node apps/worker/dist/server.js` |
| Healthcheck | `/health` |
| Serverless | **OFF** — el cron necesita el contenedor despierto |

Variables: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`WORKER_SHARED_SECRET`, `ENABLE_CRON=true`, `TZ=America/Santiago`,
`BACKUP_BUCKET`, `BACKUP_RETENTION_DAYS`, `PORT=8080`, y `RESEND_API_KEY` +
`ALERTS_EMAIL_TO` si se quieren los correos.

`TZ` es crítico: sin ella el contenedor corre en UTC y el resumen de las 22:00
llega a las 19:00. El arranque se hace con `node` directo y no con `npm run
start` para que el `SIGTERM` de Railway llegue al handler de apagado; con un npm
de por medio la señal no llega confiable y un trabajo puede quedar marcado como
`running` para siempre.

Todo endpoint distinto de `/health` exige la cabecera `X-Worker-Secret`.

---

## 4. Configuración de Supabase

### 4.1 Datos del proyecto

| Dato | Valor |
|---|---|
| Nombre | RutaAhorro |
| Ref | `amlvspbmnhtvzuqiteqe` |
| Región | `ca-central-1` (Canadá Central) |
| URL | `https://amlvspbmnhtvzuqiteqe.supabase.co` |

### 4.2 URLs de autenticación — *Authentication → URL Configuration*

Esto es lo que hace que los enlaces de correo (recuperar contraseña, invitación a
un usuario nuevo) lleguen al lugar correcto. **Si falta una URL, el enlace del
correo devuelve al usuario a una página en blanco.**

**Site URL:**
```
https://<dominio-de-railway>
```

**Redirect URLs:**
```
http://localhost:3000/**
https://<dominio-de-railway>/**
```

Ya no hay comodín de previews: no hay previews. Al usar un túnel HTTPS para
probar la cámara (§2.4), su URL se agrega aquí de forma temporal **y se retira
después**.

### 4.3 Plantillas de correo
Traducir al español las plantillas de confirmación, recuperación e invitación, y
personalizarlas con el nombre del local. Un correo en inglés que dice "Confirm
your signup" hace dudar al usuario de si es legítimo.

### 4.4 Storage

| Bucket | Acceso | Contenido |
|---|---|---|
| `productos` | Público (lectura) | Imágenes de productos, máx. 2 MB |
| `respaldos` | **Privado** | Respaldos del worker |
| `reportes` | Privado, URLs firmadas con expiración | Excel/PDF generados |

### 4.5 Base de datos
- Aplicar cambios de esquema como migración numerada en `supabase/migrations/` y
  volver a generar el bundle — **nunca** editar el esquema desde el panel en
  producción (RNF-38).
- Verificar que los respaldos automáticos que incluya el plan estén activos.
- Confirmar que RLS está habilitado en el 100 % de las tablas antes de abrir el
  acceso al cliente.

---

## 5. Integración continua

**Estado: pendiente.** `.github/workflows/` existe y está vacío. Hasta que haya
un workflow, cada una de estas verificaciones depende de que alguien la corra a
mano antes de fusionar:

| Verificación | Comando | Falla si… |
|---|---|---|
| Tipos | `npm run typecheck` | Hay errores de tipos |
| Pruebas | `npm test` | Alguna prueba unitaria falla |
| SQL | `npm run db:check` | Una migración tiene sintaxis inválida |
| Build de producción | `NEXT_PUBLIC_DEMO=false npm run build:web` | El build falla fuera de modo demo |

El build de producción se verifica con el modo demo apagado a propósito: en
desarrollo `NEXT_PUBLIC_DEMO=true` evita que se toque Supabase, así que un build
en verde en local no dice nada sobre el build que corre Railway.

Pendientes de automatizar, en orden de valor: auditoría de secretos (que
`sb_secret_` o `service_role` no aparezcan en el bundle del cliente),
verificación de que no exista tabla en `public` sin RLS, presupuesto de bundle
(250 KB comprimidos en la carga inicial), `npm audit` y pruebas e2e.

Despliegue: `main` → producción en Railway automáticamente.

---

## 6. Respaldo y recuperación

### Respaldo
| Qué | Cómo | Frecuencia | Retención |
|---|---|---|---|
| Base de datos completa | `backup-daily` → bucket `respaldos` | 03:00 **cuando el worker esté desplegado**; hoy, a mano | 30 días |
| Respaldo del proveedor | Supabase, según plan | Según plan | Según plan |
| Exportación del cliente | CSV descargable desde la app | A demanda | — |

> Mientras el worker no sea un servicio, la frecuencia real del respaldo es
> "cuando alguien se acuerde". Es aceptable con la base vacía y deja de serlo con
> la primera venta real ([ADR-008](adr/ADR-008-railway-servicio-unico.md)).

### Restauración — probada, no supuesta

El respaldo es un export lógico generado por `apps/worker/src/jobs/backup.ts`,
no un `pg_dump`. La restauración se hace sobre un proyecto Supabase **de
prueba**, nunca directo a producción, y se verifica con totales de control:

```sql
SELECT count(*), sum(total) FROM sales;
```

> El procedimiento de restauración debe ejecutarse **completo al menos una vez
> antes de la puesta en producción** y luego una vez por trimestre. Un respaldo
> que nunca se restauró es una suposición, no un respaldo (RF-M9-04).

---

## 7. Lista de comprobación antes de producción

**Seguridad**
- [ ] RLS habilitado en el 100 % de las tablas — consulta de verificación ejecutada
- [ ] Ninguna llave secreta en el bundle del cliente — hoy se verifica a mano (§5)
- [ ] `service_role` solo como variable de servidor en Railway, nunca con prefijo `NEXT_PUBLIC_`
- [ ] Redirect URLs de Supabase configuradas y sin URLs de túnel temporales
- [ ] `NEXT_PUBLIC_DEMO` en `false` — verificado en el despliegue, no solo en el panel
- [ ] Límites de tasa activos en autenticación

**Funcional**
- [ ] Todos los requerimientos `Must` implementados y probados
- [ ] Prueba de corte de red: 30 min offline con ventas reales, sincronizadas sin duplicados
- [ ] Casos de concurrencia CP-01 a CP-08 ejecutados ([16](16-plan-pruebas.md)) — hoy los
      requerimientos de concurrencia descansan en diseño, no en pruebas
- [ ] Escaneo probado en al menos 3 modelos de celular distintos
- [ ] Carga masiva probada con el catálogo real del cliente
- [ ] Ciclo completo de caja: abrir → vender → movimientos → cerrar con diferencia

**Operación**
- [ ] Worker desplegado como segundo servicio y `ENABLE_CRON=true` verificado
- [ ] Respaldo ejecutado **y restaurado** exitosamente
- [ ] Trabajos programados corriendo en horario de Chile (`TZ` verificado)
- [ ] Sentry recibiendo errores
- [ ] Monitor de uptime activo con alerta configurada
- [ ] Correo de resumen diario recibido correctamente

**Cliente**
- [ ] P-26 resuelta: el cliente sabe y acepta que no se usa Vercel
- [ ] Catálogo cargado y valorizado
- [ ] Usuarios creados con sus roles
- [ ] Personal capacitado, acta firmada
- [ ] Documentación de `docs/` actualizada al sistema realmente entregado
- [ ] Manual de usuario entregado
- [ ] Canal y horario de soporte comunicados

---

## 8. Runbook de incidentes

| Síntoma | Primera verificación | Acción |
|---|---|---|
| La app no carga | Estado del servicio en Railway y su último deploy | Redeploy de la versión anterior desde el historial de Deployments |
| Carga pero sin datos | Estado de Supabase | Si es caída del proveedor: el POS sigue vendiendo offline. **Avisar al local por WhatsApp que sigan vendiendo** |
| El escáner no abre la cámara | ¿HTTPS? ¿Permiso concedido? | Guiar a permitir la cámara; usar búsqueda manual mientras tanto |
| Ventas que no sincronizan | Indicador en la app, Sentry | Revisar el error de la venta específica; nunca vaciar la cola sin exportarla antes |
| No llegan los correos de invitación | ¿Está `SUPABASE_SECRET_KEY` en el servicio? ¿`NEXT_PUBLIC_APP_URL` apunta al dominio real? | Cargar la variable y **redesplegar** — las `NEXT_PUBLIC_*` solo cambian con un build nuevo |
| Respaldo fallido | Salida del trabajo | `npm run job -w @rutaahorro/worker backup-daily` y revisar el error |
| Stock que no cuadra | Salida de `integrity-check` | Comparar kardex vs. saldo; el kardex manda; reconstruir |
| Caja descuadrada | Bitácora de auditoría de esa sesión | Revisar anulaciones y ajustes del turno |

**Regla ante cualquier incidente mayor:** lo primero es avisar al local que
**pueden seguir vendiendo offline**. La continuidad del negocio del cliente va
antes que el diagnóstico técnico.
