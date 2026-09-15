# Prompt de continuación — SimplePyme / RutaAhorro

> Copia todo lo que sigue y pégalo como primer mensaje en la nueva sesión.
> Está escrito para que alguien que no vio nada de este proyecto pueda
> continuarlo sin volver a preguntar lo básico.

---

## CONTEXTO

Estoy construyendo un sistema de **inventario, ventas y caja** para comercios
pequeños en Chile. El primer cliente es un almacén llamado **RutaAhorro**.
La arquitectura es multi-tenant, así que el producto puede venderse a varios
locales con la misma infraestructura.

- **Repositorio:** https://github.com/FelipeVeraMeza/RutaAhorro (rama `main`)
- **Carpeta local:** `C:\Users\felip\OneDrive\Documentos\VS\RuaAhorro`
  (ojo: la carpeta se llama `RuaAhorro`, sin la "t")
- **Modelo de negocio:** suscripción de $59.990 CLP/mes, IVA incluido

**Lee primero `docs/17-inventario-alcance.md`**: tiene el estado real del
sistema ítem por ítem, auditado sobre el código. Y `docs/README.md` es el
índice de los 17 documentos.

---

## CÓMO LEVANTARLO

```bash
cd "C:\Users\felip\OneDrive\Documentos\VS\RuaAhorro"
npm install
npm run dev:web        # http://localhost:3000
```

El archivo `.env.local` de la raíz ya tiene las credenciales y **está ignorado
por git**. Next lo carga desde la raíz gracias a `apps/web/next.config.ts`.

**Modo demo activo** (`NEXT_PUBLIC_DEMO=true` en `.env.local`): la app entra sin
login, con datos de ejemplo en IndexedDB. Hay un banner amarillo arriba con un
selector de rol para ver cómo cambia la app según quién entra. Para apagarlo:
`NEXT_PUBLIC_DEMO=false` y reiniciar.

Comandos útiles:

| Comando | Qué hace |
|---|---|
| `npm run dev:web` | Frontend en :3000 |
| `npm run dev:worker` | Worker en :8080 |
| `npm test -w @rutaahorro/core` | 119 pruebas de lógica de negocio |
| `npm run db:check` | Valida la sintaxis SQL con el parser de PostgreSQL |
| `npm run db:bundle` | Genera `supabase/bundle.sql` para pegar en Supabase |
| `npm run build -w @rutaahorro/web` | Compila el frontend |

> Si tocas `packages/core`, hay que recompilarlo antes de compilar la web:
> `npm run build -w @rutaahorro/core`

---

## ARQUITECTURA

```
apps/web        Next.js 15 (App Router) + Tailwind 4 → Railway
apps/worker     Node + node-cron (respaldos, alertas, correos) → Railway
packages/core   Lógica pura y probada: dinero, RUT, EAN, carrito,
                costo promedio, arqueo, FEFO, importación CSV
supabase/       6 migraciones: 26 tablas, 23 funciones, 11 vistas, RLS
docs/           17 documentos + 7 ADR
tools/sql-check Validador de SQL con el parser real de PostgreSQL
```

**Base de datos:** Supabase, proyecto `amlvspbmnhtvzuqiteqe`, región
`ca-central-1`. **El esquema todavía NO está aplicado.**

### Decisiones que NO se deben romper

Están justificadas en `docs/adr/`. Son las reglas que sostienen el sistema:

1. **Multi-tenant con RLS** (ADR-004) — toda tabla lleva `tenant_id` y tiene
   política RLS. El `tenant_id` se deriva del token, **nunca** se acepta del
   cliente.
2. **Kardex inmutable** (ADR-006) — `inventory_movements` y `audit_log` no
   admiten UPDATE ni DELETE, ni siquiera para `admin`. Corregir = insertar el
   movimiento contrario.
3. **Modo offline en el POS** (ADR-005) — las ventas se encolan en IndexedDB
   con un `client_uuid` que da idempotencia. Se permite stock negativo y se
   alerta; **no se bloquea la venta**.
4. **FEFO por lote** (ADR-007) — `products.tracks_expiry` activa el control por
   lote. El cajero nunca elige el lote: sale primero el que vence antes.
5. **Dinero en enteros CLP.** Nunca punto flotante.
6. **Capa de repositorio** — las pantallas hablan con una interfaz
   (`lib/productos/`, `lib/datos/`), nunca con Supabase directo. Dos
   implementaciones: Supabase (producción) e IndexedDB (demo). Esto es lo que
   permite probar sin la base aplicada.
7. **La seguridad vive en PostgreSQL, no en la interfaz.** Ocultar un botón es
   comodidad visual; RLS es el control real.
8. **La documentación se actualiza en el mismo cambio que el código**
   (RNF-39). Si cambias una regla de negocio, actualiza su documento.

---

## ESTADO ACTUAL

**119 pruebas pasando · SQL validado · build OK · 10 rutas.**

### Terminado y funcionando

| Módulo | Estado |
|---|---|
| Base de datos completa | 26 tablas, 23 funciones, RLS en el 100 % |
| POS con escáner y modo offline | Cámara + ZXing de respaldo, cola idempotente |
| Ciclo de caja | Apertura, movimientos, cierre con arqueo y diferencia |
| Productos | Alta, edición, baja, categorías, códigos múltiples |
| Carga masiva CSV | Plantilla, vista previa, validación todo-o-nada |
| Usuarios | Invitación por correo, roles, estado conectado |
| Proveedores y recepción | Con lotes, vencimiento y aviso de variación de costo |
| Inventario | Ajustes con motivo, kardex, toma de inventario parcial |
| Worker | 7 trabajos: respaldo, resumen diario, alertas, integridad |

### Pendiente (en orden de prioridad)

1. **Aplicar el esquema en Supabase** — `npm run db:bundle`, pegar
   `supabase/bundle.sql` en el SQL Editor, después `supabase/seed.sql`.
   Las instrucciones para crear el primer admin están al final del seed.
   **Nada existe para el cliente hasta que esto pase.**
2. **Desplegar en Railway** — un solo servicio, Root Directory `/`, build
   `npm ci --include=dev && npm run build:web`, start
   `npm run start -w @rutaahorro/web`. Ver `docs/09-despliegue.md §3` para las
   variables y el orden exacto. El worker no se despliega todavía: ver
   `docs/adr/ADR-008-railway-servicio-unico.md`.
3. **El alcance creció: documentos tributarios.** P-03 se respondió el
   2026-09-15 y el cliente sí requiere **boleta y factura electrónica con
   vinculación al SII**. Ver `docs/18-documentos-tributarios-sii.md` y
   `docs/adr/ADR-009-dte-simulador-primero.md`.

**El orden de trabajo completo, por estado y con dependencias, está en
`docs/19-cronograma.md`.** Resumido: F1 cerrar el POS (comprobante con IVA,
anular venta, descuento, pago mixto) → F2 reportes → F3 alertas →
F4 QA de concurrencia → F5 DTE simulado → F6 DTE real.

Dos advertencias que no hay que perder de vista:

- Los 7 requerimientos de concurrencia marcados como hechos **descansan en
  diseño, no en pruebas**. CP-01 a CP-08 siguen pendientes.
- Editar el mismo producto en simultáneo pierde datos (RF-M10-03): el segundo
  que guarda sobrescribe al primero sin avisar.

Cuando `/reportes` y `/alertas` existan, agregarlos a
`apps/web/src/lib/navegacion.ts` (hay un comentario marcando el lugar).

---

## DECISIONES PENDIENTES DEL CLIENTE

Llevan abiertas desde el inicio y **no avanzan programando**. Están en
`docs/15-preguntas-abiertas.md`.

- **P-03 — RESPONDIDA el 2026-09-15: sí requiere emisión ante el SII.** Deja
  de ser riesgo y pasa a ser alcance. Abre P-27 a P-31, y las dos que están en
  la ruta crítica son:
- **P-28 — ¿El cliente tiene certificado digital y enrolamiento como emisor
  electrónico?** Sin esos dos trámites no se emite un solo documento válido, y
  no dependen del desarrollo. **Empiezan hoy.**
- **P-27 — ¿Qué proveedor de DTE?** Condiciona todo el diseño de F6.
- **P-13 — ¿El repositorio será público o privado?** De esto depende si hay
  que rotar las llaves de Supabase.
- **P-08 — ¿Cómo lleva hoy el inventario?** Si hay un Excel, se migra y se
  ahorra buena parte de la carga inicial.
- **P-26 — El cliente había pedido Vercel + Railway** y se decidió solo
  Railway ([ADR-008](docs/adr/ADR-008-railway-servicio-unico.md)). Hay que
  decírselo.
- **Nombre del producto.** Las maquetas dicen "SimplePyme" y el repo dice
  "RutaAhorro". Lo correcto sería: SimplePyme = producto, RutaAhorro = primer
  cliente. Afecta logo, correos y dominio.

---

## CONVENCIONES

- **Todo en español de Chile**, incluidos nombres de variables y funciones en
  el código nuevo del dominio (`repoProductos`, `confirmarRecepcion`).
- **Mensajes de error en lenguaje del negocio**, nunca técnicos: "No hay stock
  suficiente de Coca-Cola 1.5L", jamás "constraint violation". La traducción
  está en `packages/core/src/errors.ts`.
- **Móvil primero.** Objetivos táctiles de 44 px mínimo, acciones principales en
  el tercio inferior. En escritorio hay barra lateral; en celular, navegación
  inferior. No es el escritorio encogido.
- **El estado nunca se comunica solo por color** — siempre color + texto o
  icono (RNF-46).
- **Montos** con `formatCLP()` de `@rutaahorro/core`, sin decimales.
- Commits en español, explicando **por qué**, no solo qué.

---

## LO QUE ME GUSTARÍA QUE HICIERAS

Trabaja como jefe de proyecto y QA, no solo como programador:

- Antes de construir, **verifica el estado real** en el código en vez de
  asumirlo.
- **Escribe las pruebas antes que la interfaz** cuando haya lógica de negocio.
  Ya encontraron un bug grave así: `leerNumero("mil pesos")` devolvía 0 en vez
  de error, y habría cargado productos a $0.
- **Dime cuando algo sea mala idea**, aunque yo lo haya pedido.
- Si encuentras un hueco, **déjalo documentado** en vez de esconderlo.
- Verifica lo que entregas: compila, corre las pruebas, prueba las rutas.

Empieza diciéndome qué encontraste al revisar el estado actual y qué propones
hacer primero.
