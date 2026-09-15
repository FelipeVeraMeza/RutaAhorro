# 07 — Arquitectura técnica

---

## 1. Vista general

Tres plataformas, cada una haciendo lo que hace bien:

```
┌──────────────────────────────────────────────────────────────────────┐
│  DISPOSITIVOS DEL LOCAL                                              │
│  Celular del cajero · Celular del bodeguero · Tablet · PC del dueño  │
│  ──────────────────────────────────────────────────────────────────  │
│  PWA instalada  ·  Service Worker  ·  IndexedDB (catálogo + cola)    │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ HTTPS
              ┌─────────────┴──────────────┐
              ▼                            ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│  VERCEL                  │   │  SUPABASE  (ca-central-1)            │
│  Next.js 15 App Router   │   │  ┌────────────────────────────────┐  │
│  · Interfaz y PWA        │──▶│  │ PostgreSQL + RLS               │  │
│  · Route handlers        │   │  │ Funciones transaccionales      │  │
│  · Caché en el borde     │   │  └────────────────────────────────┘  │
└──────────────────────────┘   │  Auth  ·  Storage  ·  Realtime       │
                               └───────────────┬──────────────────────┘
                                               │ service_role
                            ┌──────────────────┴───────────────────┐
                            │  RAILWAY                             │
                            │  Worker Node/TypeScript + cron       │
                            │  · Respaldo diario (pg_dump)         │
                            │  · Resumen diario por correo         │
                            │  · Alertas de stock y de caja        │
                            │  · Reportes pesados (Excel/PDF)      │
                            │  · Reconstrucción mensual de stock   │
                            └──────────────────────────────────────┘
```

### Por qué estas plataformas

| Plataforma | Qué resuelve | Por qué no otra |
|---|---|---|
| **Railway** | Entrega de la interfaz y, cuando se active el worker, los procesos largos y programados | Una sola plataforma para un monorepo de dos paquetes; HTTPS automático, que es requisito para la cámara |
| **Supabase** | Base de datos, autenticación, archivos, tiempo real — con RLS | Reemplaza un backend completo; la seguridad vive en la BD y no depende de que ningún endpoint la recuerde |

Ver [ADR-008](adr/ADR-008-railway-servicio-unico.md), que supera a ADR-003, para
las alternativas descartadas.

---

## 2. Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router) | 15.x |
| Lenguaje | TypeScript en modo estricto | 5.x |
| Estilos | Tailwind CSS | 4.x |
| Componentes | shadcn/ui (Radix UI) | última |
| Estado servidor | TanStack Query | 5.x |
| Estado local | Zustand (carrito, cola offline) | 5.x |
| Formularios | React Hook Form + Zod | |
| Base de datos | PostgreSQL | 15+ |
| Cliente de BD | `@supabase/supabase-js` + `@supabase/ssr` | 2.x |
| Persistencia offline | IndexedDB vía Dexie.js | 4.x |
| Service worker | Serwist (sucesor de next-pwa) | |
| Escaneo | `BarcodeDetector` nativa + `@zxing/browser` de respaldo | |
| Gráficos | Recharts | |
| Worker | Node 22 + TypeScript + `node-cron` | |
| Correo | Resend 🔶 | |
| Errores | Sentry | |
| Pruebas | Vitest (unitarias) + Playwright (E2E) | |

> Zod se usa **dos veces** sobre el mismo esquema: validación en el formulario y
> validación en el route handler. Nunca se confía en la validación del cliente.

---

## 3. Estructura del repositorio

```
RutaAhorro/
├── docs/                          # Esta documentación
├── supabase/
│   ├── migrations/                # Migraciones SQL versionadas
│   ├── functions/                 # Funciones PL/pgSQL
│   ├── policies/                  # Políticas RLS
│   └── seed.sql                   # Datos de desarrollo
├── apps/
│   ├── web/                       # Next.js → Railway
│   │   ├── app/
│   │   │   ├── (auth)/            # login, recuperar clave
│   │   │   ├── (app)/
│   │   │   │   ├── pos/           # Punto de venta
│   │   │   │   ├── productos/
│   │   │   │   ├── inventario/
│   │   │   │   ├── recepciones/
│   │   │   │   ├── caja/
│   │   │   │   ├── reportes/
│   │   │   │   └── admin/
│   │   │   └── api/               # Route handlers
│   │   ├── components/
│   │   │   ├── ui/                # shadcn/ui
│   │   │   ├── pos/               # Escáner, carrito, cobro
│   │   │   └── shared/
│   │   ├── lib/
│   │   │   ├── supabase/          # Clientes: navegador / servidor / admin
│   │   │   ├── offline/           # Dexie, cola de sincronización
│   │   │   ├── scanner/           # Abstracción del lector
│   │   │   └── format/            # CLP, fechas es-CL, RUT
│   │   └── public/                # manifest.json, íconos
│   └── worker/                    # Node → Railway
│       ├── src/jobs/              # backup, daily-summary, alerts, reports
│       └── src/server.ts          # Healthcheck + endpoints internos
├── packages/
│   ├── types/                     # Tipos generados desde el esquema
│   └── core/                      # Lógica pura compartida (totales, costo, arqueo)
└── .github/workflows/             # CI/CD
```

> `packages/core` contiene el cálculo de totales, descuentos, costo promedio y
> arqueo **como funciones puras sin dependencias**. Es el código que más importa
> que esté bien y el que se prueba al 100 %. Lo comparten la web y el worker.

---

## 4. Flujos críticos

### 4.1 Venta con conexión

```
Cajero escanea  →  BarcodeDetector devuelve el código
                →  búsqueda en IndexedDB (local, <50 ms)
                →  producto al carrito, sonido + vibración
                →  [Cobrar]
                →  POST /api/ventas  { client_uuid, items, pagos }
                →  RPC fn_register_sale()  ── transacción única ──
                   · verifica caja abierta
                   · verifica idempotencia
                   · asigna folio
                   · inserta venta + líneas + pagos
                   · inserta kardex + actualiza stock
                →  comprobante en pantalla
```

### 4.2 Venta sin conexión — el caso que define la arquitectura

```
Cajero escanea  →  búsqueda en IndexedDB (funciona igual: el catálogo está local)
                →  [Cobrar]
                →  se genera client_uuid en el dispositivo
                →  venta guardada en la cola de IndexedDB
                →  comprobante mostrado de inmediato  ← el cajero no espera nada
                →  indicador: "Sin conexión · 1 por sincronizar"

Al reconectar   →  Background Sync despierta el service worker
                →  envía la cola EN ORDEN, de a una
                →  el servidor deduplica por client_uuid
                →  la cola se vacía; el indicador vuelve a verde
```

**Decisiones que sostienen esto:**

| Problema | Decisión |
|---|---|
| El catálogo debe estar disponible sin red | Se replica completo a IndexedDB al iniciar sesión y se refresca de forma incremental |
| Dos ventas offline del mismo producto pueden sobrevender | Se acepta: se vende con el stock conocido y, al sincronizar, el stock real puede quedar negativo. **Se alerta, no se bloquea.** Un local no detiene la venta porque el sistema dude |
| Un reenvío podría duplicar la venta | `client_uuid` único por tenant (§3.5 de [06](06-modelo-datos.md)) |
| La hora de la venta debe ser la real | `sold_at` lo fija el dispositivo; `synced_at` lo fija el servidor |
| El precio pudo cambiar mientras estaba offline | Se cobra el precio que el dispositivo tenía y se **congela** en `sale_items.unit_price` |

> El stock negativo tras sincronizar no es un error del sistema: es información
> real sobre lo que pasó en el local. Ocultarlo sería peor.

### 4.3 Escaneo de códigos de barras

```
¿Existe window.BarcodeDetector?
├── Sí  (Chrome Android, Edge)  → API nativa: rápida y con bajo consumo
└── No  (Safari iOS, Firefox)   → @zxing/browser sobre el stream de video
```

Formatos soportados: EAN-13, EAN-8, UPC-A, UPC-E, Code128, Code39, ITF.

Detalles que deciden si el escaneo funciona en la práctica:
- **`facingMode: 'environment'`** y solicitud de enfoque continuo.
- **Antirrebote de 1.200 ms** por código: sin esto, un código en cuadro se lee
  quince veces por segundo.
- **Retroalimentación inmediata**: pitido corto + `navigator.vibrate(50)`. El
  cajero no debe mirar la pantalla para saber que leyó.
- **Requiere HTTPS.** En desarrollo local, `localhost` está exento; para probar
  desde el celular en la red del local hay que usar un túnel HTTPS (ver
  [09 §2](09-despliegue.md)).
- **Salida de emergencia siempre visible**: botón de búsqueda manual. Si la cámara
  falla (lente sucio, poca luz, código rayado), la venta debe poder seguir.

### 4.4 Autenticación y redirecciones

Supabase Auth maneja las sesiones con cookies httpOnly vía `@supabase/ssr`. El
middleware de Next.js refresca el token y protege las rutas.

Los **enlaces de correo** (recuperar contraseña, invitación de usuario) vuelven a
la URL configurada en Supabase. Por eso hay que declarar las tres URLs del
proyecto — es el punto donde se cruza "localhost" con el despliegue:

| Entorno | URL |
|---|---|
| Local | `http://localhost:3000/**` |
| Producción (Railway) | `https://<dominio>.up.railway.app/**` |

Procedimiento exacto en [09 §4.2](09-despliegue.md).

---

## 5. Los tres clientes de Supabase

Distinguirlos correctamente es el control de seguridad más importante del código:

| Cliente | Llave | Dónde corre | Respeta RLS |
|---|---|---|---|
| `createBrowserClient()` | `anon` / `publishable` | Navegador | **Sí** |
| `createServerClient()` | `anon` + cookie de sesión | Route handlers, componentes de servidor | **Sí**, como el usuario |
| `createAdminClient()` | `service_role` / `sb_secret` | **Solo** worker Railway | **No — omite RLS** |

Reglas no negociables:
1. El cliente admin vive en un archivo que **nunca** se importa desde código de navegador.
2. Ninguna variable con la llave secreta lleva el prefijo `NEXT_PUBLIC_`.
3. Un test en CI revisa el bundle compilado y falla si encuentra el patrón
   `sb_secret_` o un JWT con `"role":"service_role"` (RNF-25).

---

## 6. PWA y estrategia de caché

`manifest.json`: `display: standalone`, orientación libre, íconos 192/512,
color de tema, atajo directo al POS.

| Recurso | Estrategia |
|---|---|
| Esqueleto de la app (HTML/JS/CSS) | *Stale-while-revalidate* |
| Catálogo de productos | IndexedDB, refresco incremental por `updated_at` |
| Imágenes de productos | *Cache-first*, límite 50 MB con expulsión LRU |
| Ventas, caja, reportes | *Network-only* (nunca se cachean datos de dinero) |
| Cola de ventas offline | IndexedDB + Background Sync |

> Los reportes **nunca** se sirven desde caché. Un número de ventas desactualizado
> mostrado como si fuera actual destruye la confianza en todo el sistema.

---

## 7. Rendimiento

- Componentes de servidor por defecto; `"use client"` solo donde hay interacción.
- El POS carga en una ruta propia y liviana: no arrastra gráficos ni reportes.
- Recharts y la librería de Excel se cargan de forma diferida.
- Búsqueda del POS **100 % local** contra IndexedDB con índice por código y por
  nombre normalizado (sin tildes, minúsculas).
- Presupuesto de 250 KB comprimidos en la carga inicial, verificado en CI (RNF-06).

---

## 8. Observabilidad

| Qué | Herramienta |
|---|---|
| Errores de la aplicación | Sentry (web y worker) |
| Disponibilidad | Monitor externo de uptime cada 5 min |
| Rendimiento real de usuarios | Pendiente — Vercel Analytics ya no aplica; evaluar Sentry Performance |
| Salud de la base de datos | Panel de Supabase + alertas de consumo |
| Trabajos programados | El worker registra cada ejecución en una tabla `job_runs`; el resumen diario avisa si alguno falló |

**Alertas que despiertan a alguien:** respaldo fallido, worker caído, tasa de
error > 2 %, base de datos sobre 80 % de su cuota.
