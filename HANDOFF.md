# Prompt de continuación — RutaAhorro

> Copia todo lo que sigue y pégalo como primer mensaje en la sesión nueva.
> Está escrito para que alguien que no vio nada del proyecto pueda continuarlo
> sin volver a preguntar lo básico.
>
> **Corte: 2026-09-16.**

---

## CONTEXTO

Estoy construyendo un sistema de **inventario, ventas y caja** para comercios
pequeños en Chile. El primer cliente es un almacén llamado **RutaAhorro**.
La arquitectura es multi-tenant, así que el producto puede venderse a varios
locales con la misma infraestructura.

- **Repositorio:** https://github.com/FelipeVeraMeza/RutaAhorro (rama `main`)
- **Carpeta local:** `C:\Users\felip\OneDrive\Documentos\VS\RuaAhorro`
  (la carpeta se llama `RuaAhorro`, sin la "t")
- **Modelo de negocio:** suscripción de $59.990 CLP/mes, IVA incluido

**Lee primero, en este orden:**

1. `docs/19-cronograma.md` — qué sigue y en qué orden. Es la fuente autorizada.
2. `docs/21-qa-pantallas.md` — hallazgos de la auditoría, corregidos y pendientes.
3. `docs/17-inventario-alcance.md` — estado ítem por ítem. **Ojo:** los
   contadores por módulo están desactualizados y lo dice el propio documento.
4. `docs/README.md` — índice de los 21 documentos.

---

## CÓMO LEVANTARLO

```bash
cd "C:\Users\felip\OneDrive\Documentos\VS\RuaAhorro"
npm install
npm run dev        # http://localhost:3000
```

`.env.local` está en la raíz, ignorado por git, y Next lo carga desde ahí
gracias a `apps/web/next.config.ts`.

**Modo demo activo** (`NEXT_PUBLIC_DEMO=true`): la app entra sin login con
datos de ejemplo en IndexedDB y un banner amarillo con selector de rol.

> **Cuidado con esto:** en modo demo el build siempre pasa. Antes de dar por
> bueno cualquier cambio, compilar como lo hace producción:
> `NEXT_PUBLIC_DEMO=false npm run build:web`

| Comando | Qué hace |
|---|---|
| `npm run dev` | Frontend en :3000 |
| `npm run dev:worker` | Worker en :8080 (no se levanta con `npm run dev`) |
| `npm test` | 206 pruebas de lógica de negocio |
| `npm run typecheck` | Tipos en los tres paquetes |
| `npm run db:check` | Valida el SQL con el parser de PostgreSQL |
| `npm run db:instalar` | Genera `supabase/instalar.sql`: esquema + arranque, un solo archivo |
| `npm run db:admin` | Crea un usuario contra la base real y verifica su perfil |
| `npm run db:bundle` | Genera solo el esquema, sin el arranque |
| `npm run build:web` | Compila core + web |
| `npm run job -w @rutaahorro/worker` | Lista y ejecuta los trabajos programados |

Si tocas `packages/core`, recompílalo antes de compilar la web:
`npm run build -w @rutaahorro/core`. El typecheck de la web lee el `dist`.

---

## ESTADO AL 2026-09-16

**206 pruebas · SQL validado · build de producción verificado con demo apagado · 11 rutas.**

Las 11 pantallas están auditadas (`docs/21`). Nueve, línea por línea.

### Funcionando

Base de datos completa (26 tablas, 23 funciones, RLS al 100 %). POS con
escáner y modo offline. Ciclo de caja con arqueo. Productos con alta, edición,
baja, categorías y códigos múltiples. Carga masiva CSV. Usuarios con
invitación por correo y roles. Proveedores y recepción con lotes, vencimiento
y aviso de variación de costo. Inventario con ajustes, kardex y toma.
Comprobante de venta con desglose de IVA.

### Lo que se hizo hoy

| Commit | Qué |
|---|---|
| `02a37ce` | El worker respeta el `PORT` de Railway |
| `ce7d584` | Fuera los `railway.json`; Node fijado con `.node-version` |
| `80efb0c` | ADR-008: todo en Railway, un solo servicio. 15 documentos alineados |
| `a48c4c9` | P-03 respondida: entra el módulo tributario. Docs 18, 19, 20, ADR-009 |
| `0072026` | Comprobante de venta con neto e IVA (RF-M5-14) |
| `6dcb602`, `1ba0132` | Documento funcional para el cliente |
| `9882d1f` | Tres bugs de recepción + `seed-produccion.sql` |
| `87a8096` | Informe de auditoría de pantallas |
| `b338b45` | Validación de montos y revisión previa a la toma |

---

## LO PENDIENTE, EN ORDEN

### 1 · Poner en producción — bloqueado en Felipe, no en programar

1. **Esquema en Supabase:** `npm run db:instalar` → pegar
   `supabase/instalar.sql` completo en el SQL Editor. Es un solo archivo:
   esquema más tenant y tienda, sin productos. Antes de ejecutarlo, cambiar
   `v_nombre text := 'RutaAhorro';` por el nombre real del local.
   Después, el primer administrador:
   `npm run db:admin -- --correo=... --nombre="..."`.
2. **Railway**, un solo servicio: Root Directory `/`, build
   `npm ci --include=dev && npm run build:web`, start
   `npm run start -w @rutaahorro/web`, healthcheck `/manifest.webmanifest`,
   Serverless OFF, y la variable `PORT=8080` (sin ella, `next start` se va al
   3000 y Railway apunta al 8080: 502).
3. Dominio ya generado: `https://rutaahorroweb-production.up.railway.app`.
   Cargarlo en `NEXT_PUBLIC_APP_URL` y **redesplegar**: las `NEXT_PUBLIC_*` se
   hornean en el build.
4. Supabase → Authentication → URL Configuration: Site URL y
   `https://<dominio>/**` en Redirect URLs.

Detalle completo en `docs/09-despliegue.md §3`.

### 2 · Seguir el cronograma

`docs/19-cronograma.md`. Resumido:

- **F1 · Cerrar el POS** — anular venta (`fn_void_sale` está probada y **no la
  invoca ninguna pantalla**), descuento por línea, pago mixto.
- **F2 · Reportes** — existen 11 vistas en la base y la app usa 3.
- **F3 · Alertas y configuración** — la tabla `alerts` se llena sola y no hay
  dónde verla.
- **F4 · QA de concurrencia** — CP-01 a CP-08 de `docs/16-plan-pruebas.md`.
- **F5 · DTE simulado** — `docs/18` y `ADR-009`.
- **F6 · DTE real** — depende de trámites del cliente.

### 3 · Hallazgos abiertos de la auditoría

`docs/21-qa-pantallas.md`. Las 11 pantallas ya están auditadas. Lo abierto,
por gravedad:

- **F-3:** `repoSupabase.actualizar` borra todos los códigos de barra del
  producto y los reinserta, sin transacción. Si la inserción falla —porque
  otro producto tomó ese código— el producto queda **sin ningún código**, que
  es justo el que no aparecerá al escanear. Es A-4 en la edición, y
  `fn_create_product` no lo cubre: corresponde una `fn_update_product`.
- **M-7:** M4-16 (stock por lote) figura ✅ en el inventario de alcance y el
  código no lo respalda. **Hay que verificarlo.** Es exactamente el patrón que
  ya produjo el hallazgo de RF-M3-08: un requerimiento cerrado sin evidencia.
- **L-5:** recuperar contraseña (RF-M1-05) no existe. Hoy el dueño entra al
  panel de Supabase cada vez que un vendedor olvida su clave.
- **M-1:** un movimiento de caja mal ingresado no se puede corregir. Ahora al
  menos se advierte antes de registrarlo.

---

## LO QUE NO SE PUEDE ROMPER

1. **Todo pasa por la capa de repositorio.** Nada de llamar a Supabase desde un
   componente. Es lo que permite que la app corra igual en demo (IndexedDB) y
   en producción.
2. **El kardex es inmutable** (ADR-006). Un error se corrige con un movimiento
   contrario, nunca editando ni borrando.
3. **Una caja cerrada no se modifica.**
4. **El dinero se guarda en enteros.** Nunca decimales, nunca float (RNF-32).
5. **`service_role` jamás llega al navegador.** Vive en el servidor: el único
   uso legítimo hoy es el route handler de invitación de usuarios.
6. **La seguridad vive en la base**, con RLS en el 100 % de las tablas. Ocultar
   un botón no es seguridad.
7. **Los precios incluyen IVA.** El IVA se extrae del total, nunca se suma
   encima. Y el neto sale por diferencia, para que `neto + IVA === total` sin
   descuadre de un peso.
8. **Un ADR no se edita.** Si una decisión cambia, se escribe uno nuevo que
   declara superado al anterior.
9. **Los campos de dinero usan `validarMonto`, no `parseCLP`.** `parseCLP`
   interpreta y acepta el signo menos; validar es otra cosa.

---

## DECISIONES DEL CLIENTE PENDIENTES

No avanzan programando. Están en `docs/15-preguntas-abiertas.md`.

- **P-28 — ¿Tiene certificado digital y enrolamiento como emisor electrónico
  ante el SII?** Es la ruta crítica del módulo tributario. Los trámites tienen
  que empezar ya, en paralelo al desarrollo.
- **P-27 — ¿Qué proveedor de DTE?** Condiciona todo el diseño de F6.
- **P-26 — El cliente había pedido Vercel + Railway** y se decidió solo
  Railway (ADR-008). Hay que decírselo.
- **P-13 — ¿Repositorio público o privado?** De esto depende si hay que rotar
  las llaves de Supabase.
- **P-08 — ¿Cómo lleva hoy el inventario?** Si hay un Excel, se migra.
- **Nombre del producto:** las maquetas dicen "SimplePyme", el repo dice
  "RutaAhorro". Lo correcto sería SimplePyme = producto, RutaAhorro = primer
  cliente.

**P-03 se respondió hoy:** el cliente sí requiere boleta y factura electrónica
ante el SII. Eso era R-01, el mayor riesgo del proyecto, y dejó de ser riesgo
para ser alcance. Ni la propuesta comercial ni el plan de trabajo lo
contemplaban: hay que revisar precio y plazo.

---

## CONVENCIONES

- **Español de Chile**, incluidos los nombres de variables y funciones del
  dominio (`repoProductos`, `confirmarRecepcion`, `validarMonto`).
- **Errores en lenguaje del negocio**, nunca técnicos: "No hay stock suficiente
  de Coca-Cola 1.5L", jamás "constraint violation".
- **Móvil primero.** El objetivo táctil mínimo es 44 px (RNF-16).
- **Color nunca solo:** todo estado va con color *y* texto (RNF-46).
- **Los comentarios explican el porqué, no el qué.** Si un comentario describe
  lo que el código ya dice, sobra.

---

## CÓMO QUIERO QUE TRABAJES

Como **jefe de proyecto y QA**, no como programador que ejecuta órdenes.

- **Verifica el estado real, no lo asumas.** Hoy aparecieron tres
  requerimientos marcados como hechos que no funcionaban en producción, y un
  plan de despliegue que describía otro proyecto. Los documentos mienten;
  el código no.
- **Dime lo que no quiero oír.** Si algo está mal estimado, si una decisión mía
  contradice un pedido del cliente, o si un requerimiento "listo" no lo está.
- **No declares terminado lo que no probaste.** Pruebas, typecheck y build de
  producción con `NEXT_PUBLIC_DEMO=false` antes de decir que algo funciona.
- **Si encuentras un bug mientras haces otra cosa, dilo.** Aunque no sea lo que
  te pedí.
- Al terminar una tanda, deja registrado lo que hiciste: commit con el porqué
  en el mensaje, y el documento correspondiente actualizado.

---

## LO PRIMERO QUE DEBERÍAS HACER

Preguntarme si ya apliqué el esquema en Supabase y desplegué en Railway.
**Hasta que eso pase, el sistema no existe para el cliente**: todo lo que se ha
visto corre contra IndexedDB.

Y una advertencia que no hay que perder de vista: **los siete requerimientos de
concurrencia marcados como hechos descansan en diseño, no en pruebas.** Los
casos CP-01 a CP-08 siguen pendientes. Es el riesgo silencioso más grande que
tiene el proyecto.
