# 09 — Plan de despliegue y entornos

---

## 1. Entornos

| Entorno | Frontend | Worker | Base de datos | Para qué |
|---|---|---|---|---|
| **Local** | `localhost:3000` | `localhost:8080` | Supabase local (Docker) o el proyecto `dev` | Desarrollo diario |
| **Preview** | URL automática de Vercel por PR | — | Proyecto Supabase `dev` | Revisar cada cambio antes de fusionar |
| **Producción** | Vercel (dominio definitivo) | Railway | Proyecto Supabase `amlvspbmnhtvzuqiteqe` | El local del cliente |

> **Recomendación fuerte:** crear un **segundo proyecto Supabase** para desarrollo
> y dejar `amlvspbmnhtvzuqiteqe` exclusivamente para producción. Probar la carga
> masiva o un ajuste de stock contra la base del cliente es la forma más rápida de
> perder su confianza. El proyecto extra en plan gratuito cuesta $0.
> Ver pregunta P-14 en [15](15-preguntas-abiertas.md).

---

## 2. Entorno local (localhost)

### 2.1 Requisitos
- Node.js 22 LTS · pnpm 9 · Git
- Docker Desktop (solo si se usa Supabase local)
- Supabase CLI: `npm i -g supabase`

### 2.2 Puesta en marcha

```bash
git clone https://github.com/FelipeVeraMeza/RutaAhorro.git
cd RutaAhorro
pnpm install

# Las variables ya están en .env.local (no se comitea).
# Si partes de cero: cp .env.example .env.local y completar.

# Aplicar migraciones a la base
supabase link --project-ref amlvspbmnhtvzuqiteqe   # o el proyecto dev
supabase db push

# Levantar web + worker en paralelo
pnpm dev
```

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Web en `:3000` y worker en `:8080` |
| `pnpm dev:web` | Solo el frontend |
| `pnpm dev:worker` | Solo el worker |
| `pnpm db:push` | Aplica migraciones |
| `pnpm db:types` | Regenera los tipos TypeScript desde el esquema |
| `pnpm test` | Pruebas unitarias |
| `pnpm test:e2e` | Playwright |
| `pnpm lint` | ESLint + verificación de tipos |

### 2.3 Cómo apunta el localhost al worker

El frontend decide a qué worker hablar mediante **una sola variable**:

```bash
# .env.local  (desarrollo)
NEXT_PUBLIC_WORKER_URL=http://localhost:8080

# Vercel  (producción)
NEXT_PUBLIC_WORKER_URL=https://rutaahorro-worker.up.railway.app
```

Así el mismo código corre en los dos lados sin condicionales. En local trabajas
contra tu worker; en producción, contra Railway. **Nunca** se escribe una URL de
worker directamente en el código.

### 2.4 Probar el escáner desde el celular

La cámara del navegador exige un contexto seguro. `http://localhost` está exento,
pero `http://192.168.1.x:3000` **no lo está**: si abres la app desde el celular
apuntando a la IP del PC, la cámara simplemente no aparece.

Para probar el escaneo en un dispositivo real durante el desarrollo:

```bash
# Túnel HTTPS temporal hacia el localhost
npx localtunnel --port 3000
# o
cloudflared tunnel --url http://localhost:3000
```

La URL `https://…` que entrega el túnel debe agregarse temporalmente a las
**Redirect URLs** de Supabase (ver §5) para que el inicio de sesión funcione.

---

## 3. Despliegue del frontend en Vercel

### 3.1 Configuración del proyecto

| Ajuste | Valor |
|---|---|
| Framework | Next.js |
| Root Directory | `apps/web` |
| Build Command | `pnpm build` |
| Install Command | `pnpm install` |
| Node.js Version | 22.x |
| Región | `iad1` (Washington) — la más cercana a `ca-central-1` |

> La región importa: cada consulta viaja entre Vercel y Supabase. Elegir una
> región lejana de Canadá agrega latencia a **cada** operación del POS.

### 3.2 Variables de entorno en Vercel

| Variable | Production | Preview | Ámbito |
|---|:--:|:--:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | Cliente |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | Cliente |
| `NEXT_PUBLIC_APP_URL` | ✅ | auto | Cliente |
| `NEXT_PUBLIC_WORKER_URL` | ✅ | ✅ | Cliente |
| `NEXT_PUBLIC_APP_ENV` | `production` | `preview` | Cliente |
| `WORKER_SHARED_SECRET` | ✅ | ✅ | **Servidor** |
| `SENTRY_DSN` | ✅ | — | Servidor |

> `SUPABASE_SERVICE_ROLE_KEY` **no se configura en Vercel.** No hay ninguna
> operación del frontend que la necesite; ponerla ahí solo amplía la superficie
> de exposición sin ganar nada.

### 3.3 Flujo de despliegue

```
push a rama          → Preview automático con URL propia
Pull Request         → Preview + CI (lint, tipos, pruebas, presupuesto de bundle)
merge a main         → Producción
producción con fallo → Instant Rollback desde el panel de Vercel
```

---

## 4. Despliegue del worker en Railway

### 4.1 Configuración

| Ajuste | Valor |
|---|---|
| Fuente | Repo GitHub `FelipeVeraMeza/RutaAhorro` |
| Root Directory | `apps/worker` |
| Build | `pnpm install && pnpm build` |
| Start | `node dist/server.js` |
| Healthcheck | `/health` |
| Región | `us-east` |
| Restart Policy | `ON_FAILURE`, máximo 10 reintentos |

`apps/worker/railway.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build":  { "builder": "NIXPACKS", "buildCommand": "pnpm install && pnpm build" },
  "deploy": {
    "startCommand": "node dist/server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### 4.2 Variables de entorno en Railway

| Variable | Notas |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo aquí.** El worker necesita omitir RLS para respaldar y consolidar entre tenants |
| `DATABASE_URL` | Conexión directa para `pg_dump` |
| `WORKER_SHARED_SECRET` | El mismo valor configurado en Vercel |
| `RESEND_API_KEY`, `ALERTS_EMAIL_TO` | Correos |
| `BACKUP_BUCKET`, `BACKUP_RETENTION_DAYS` | Respaldos |
| `TZ` | `America/Santiago` — **crítico**: sin esto los trabajos corren en UTC y el "resumen de las 22:00" llega a las 19:00 |
| `SENTRY_DSN` | Errores |

### 4.3 Dominio del worker

Railway entrega un dominio del tipo `rutaahorro-worker.up.railway.app`. Ese valor
es el que se carga en `NEXT_PUBLIC_WORKER_URL` en Vercel (§2.3).

> El worker **no** debe quedar abierto a internet sin control. Todo endpoint
> distinto de `/health` exige la cabecera `X-Worker-Secret`.

### 4.4 Orden de despliegue

Railway y Vercel se despliegan desde el mismo repositorio, pero el worker debe ir
primero: Vercel necesita conocer la URL del worker para inyectarla en el bundle
del cliente.

```
1. Desplegar worker en Railway  →  obtener su dominio público
2. Cargar ese dominio en NEXT_PUBLIC_WORKER_URL en Vercel
3. Desplegar el frontend en Vercel
4. Registrar la URL de Vercel en las Redirect URLs de Supabase (§5)
5. Verificar la lista de comprobación de §8
```

---

## 5. Configuración de Supabase (incluye las redirecciones)

### 5.1 Datos del proyecto

| Dato | Valor |
|---|---|
| Nombre | RutaAhorro |
| Ref | `amlvspbmnhtvzuqiteqe` |
| Región | `ca-central-1` (Canadá Central) |
| URL | `https://amlvspbmnhtvzuqiteqe.supabase.co` |

### 5.2 URLs de autenticación — *Authentication → URL Configuration*

Este es el punto que hace que los enlaces de correo (recuperar contraseña,
invitación a un usuario nuevo) lleguen al lugar correcto. **Si falta una URL, el
enlace del correo devuelve al usuario a una página en blanco.**

**Site URL** (destino por defecto):
```
https://<dominio-de-produccion>
```

**Redirect URLs** (lista blanca; hay que declarar las tres):
```
http://localhost:3000/**
https://<dominio-de-produccion>/**
https://*-felipeverameza.vercel.app/**
```

> El comodín `*-felipeverameza.vercel.app` cubre las URLs de preview, que cambian
> con cada rama. Sin él, no se puede probar el login en una preview.
> Al usar un túnel HTTPS para probar la cámara (§2.4), su URL se agrega aquí de
> forma temporal **y se retira después**.

### 5.3 Plantillas de correo
Traducir al español las plantillas de confirmación, recuperación e invitación, y
personalizarlas con el nombre del local. Un correo en inglés que dice "Confirm
your signup" hace dudar al usuario de si es legítimo.

### 5.4 Storage

| Bucket | Acceso | Contenido |
|---|---|---|
| `productos` | Público (lectura) | Imágenes de productos, máx. 2 MB |
| `respaldos` | **Privado** | Respaldos del worker |
| `reportes` | Privado, URLs firmadas con expiración | Excel/PDF generados |

### 5.5 Base de datos
- Aplicar migraciones con `supabase db push` — **nunca** editar el esquema desde
  el panel en producción (RNF-38).
- Verificar que los respaldos automáticos (PITR) estén activos según el plan.
- Confirmar que RLS está habilitado en el 100 % de las tablas antes de abrir el
  acceso al cliente.

---

## 6. Integración y entrega continua

`.github/workflows/ci.yml` — se ejecuta en cada PR:

| Paso | Falla el build si… |
|---|---|
| `pnpm lint` | Hay errores de ESLint |
| `pnpm typecheck` | Hay errores de tipos |
| `pnpm test` | Alguna prueba unitaria falla o la cobertura baja de 70 % |
| `pnpm test:e2e` | Falla venta, cierre de caja o recepción |
| Auditoría de secretos | Se detecta `sb_secret_` o `service_role` en el bundle del cliente |
| Verificación de RLS | Existe alguna tabla en `public` sin RLS |
| Presupuesto de bundle | La carga inicial supera 250 KB comprimidos |
| `npm audit` | Hay vulnerabilidad crítica |

Despliegue: `main` → producción en Vercel y Railway automáticamente.

---

## 7. Respaldo y recuperación

### Respaldo
| Qué | Cómo | Frecuencia | Retención |
|---|---|---|---|
| Base de datos completa | `pg_dump` desde el worker → bucket `respaldos` | Diaria 03:00 | 30 días |
| Respaldo del proveedor | Supabase automático | Según plan | Según plan |
| Exportación del cliente | CSV descargable desde la app | A demanda | — |

### Restauración — probada, no supuesta

```bash
# 1. Descargar el respaldo del bucket
supabase storage download respaldos/backup-2026-09-14.dump ./

# 2. Restaurar en un proyecto de PRUEBA (jamás directo a producción)
pg_restore --clean --if-exists -d "$DATABASE_URL_TEST" backup-2026-09-14.dump

# 3. Verificar totales de control
psql "$DATABASE_URL_TEST" -c "SELECT count(*), sum(total) FROM sales;"
```

> El procedimiento de restauración debe ejecutarse **completo al menos una vez
> antes de la puesta en producción** y luego una vez por trimestre. Un respaldo
> que nunca se restauró es una suposición, no un respaldo (RF-M9-04).

---

## 8. Lista de comprobación antes de producción

**Seguridad**
- [ ] RLS habilitado en el 100 % de las tablas — consulta de verificación ejecutada
- [ ] Ninguna llave secreta en el bundle del cliente (verificado en CI)
- [ ] `service_role` presente solo en Railway
- [ ] Redirect URLs de Supabase configuradas y sin URLs de túnel temporales
- [ ] Límites de tasa activos en autenticación

**Funcional**
- [ ] Todos los requerimientos `Must` implementados y probados
- [ ] Prueba de corte de red: 30 min offline con ventas reales, sincronizadas sin duplicados
- [ ] Escaneo probado en al menos 3 modelos de celular distintos
- [ ] Carga masiva probada con el catálogo real del cliente
- [ ] Ciclo completo de caja: abrir → vender → movimientos → cerrar con diferencia

**Operación**
- [ ] Respaldo ejecutado **y restaurado** exitosamente
- [ ] Trabajos programados corriendo en horario de Chile (`TZ` verificado)
- [ ] Sentry recibiendo errores de web y worker
- [ ] Monitor de uptime activo con alerta configurada
- [ ] Correo de resumen diario recibido correctamente

**Cliente**
- [ ] Catálogo cargado y valorizado
- [ ] Usuarios creados con sus roles
- [ ] Personal capacitado, acta firmada
- [ ] Documentación de `docs/` actualizada al sistema realmente entregado
- [ ] Manual de usuario entregado
- [ ] Canal y horario de soporte comunicados

---

## 9. Runbook de incidentes

| Síntoma | Primera verificación | Acción |
|---|---|---|
| La app no carga | Estado de Vercel | Rollback al despliegue anterior |
| Carga pero sin datos | Estado de Supabase | Si es caída del proveedor: el POS sigue vendiendo offline. **Avisar al local por WhatsApp que sigan vendiendo** |
| El escáner no abre la cámara | ¿HTTPS? ¿Permiso concedido? | Guiar a permitir la cámara; usar búsqueda manual mientras tanto |
| Ventas que no sincronizan | Indicador en la app, Sentry | Revisar el error de la venta específica; nunca vaciar la cola sin exportarla antes |
| Respaldo fallido | Alerta del worker | Ejecutar `POST /jobs/backup` manualmente e investigar |
| Stock que no cuadra | Reporte de `rebuild-stock-check` | Comparar kardex vs. saldo; el kardex manda; reconstruir |
| Caja descuadrada | Bitácora de auditoría de esa sesión | Revisar anulaciones y ajustes del turno |

**Regla ante cualquier incidente mayor:** lo primero es avisar al local que
**pueden seguir vendiendo offline**. La continuidad del negocio del cliente va
antes que el diagnóstico técnico.
