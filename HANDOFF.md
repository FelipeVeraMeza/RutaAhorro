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

1. `docs/22-tareas-pendientes.md` — **el backlog operativo.** Qué falta, quién
   lo desbloquea y en qué orden. Empieza por acá.
2. `docs/19-cronograma.md` — el orden por fases. Fuente autorizada.
3. `docs/21-qa-pantallas.md` — la auditoría de las 11 pantallas, corregido y
   abierto.
4. `docs/17-inventario-alcance.md` — estado ítem por ítem. **Ojo:** los
   contadores por módulo están desactualizados y lo dice el propio documento.
5. `docs/README.md` — índice de los 22 documentos.

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
| `npm run db:admin` | Crea un usuario contra la base real y **verifica su perfil** |
| `npm run db:bundle` | Genera solo el esquema, sin el arranque |
| `npm run build:web` | Compila core + web |
| `npm run job -w @rutaahorro/worker` | Lista y ejecuta los trabajos programados |

Si tocas `packages/core`, recompílalo antes de compilar la web:
`npm run build -w @rutaahorro/core`. El typecheck de la web lee el `dist`.

---

## ESTADO AL 2026-09-16

**206 pruebas · typecheck limpio · SQL validado · build de producción verificado
con demo apagado · 11 rutas.**

### Funcionando

Base de datos completa (26 tablas, 24 funciones, RLS al 100 %). POS con escáner
y modo offline. Ciclo de caja con arqueo. Productos con alta transaccional,
edición, baja, categorías y códigos múltiples. Carga masiva CSV. Etiquetas
EAN-13 imprimibles. Usuarios con invitación por correo y roles. Proveedores y
recepción con lotes, vencimiento y aviso de variación de costo. Inventario con
ajustes, kardex y toma. Comprobante de venta con desglose de IVA.

**Las 11 pantallas están auditadas.** Nueve, línea por línea.

### Lo que se hizo el 2026-09-16

| Commit | Qué |
|---|---|
| `f1930b1` | Open redirect en el login, cantidades decimales y costo borrado al editar |
| `6eacb28` | Auditoría de las 4 pantallas que faltaban + `Modal` y `Campo` compartidos |
| `225d9b1` | `db:instalar` en un archivo y `db:admin` con verificación del perfil |
| `c30aa1f` | `docs/22`: backlog operativo consolidado |

Lo transversal del `6eacb28`: había **nueve diálogos** escritos a mano, ninguno
cerraba con Escape ni atrapaba el foco, y **trece `<label>` sin `htmlFor`** —se
ven como etiquetas y no lo son—. Ahora hay dos componentes compartidos,
`apps/web/src/components/Modal.tsx` y `Campo.tsx`, y los usan todas las
pantallas. **Úsalos para cualquier diálogo o campo nuevo.**

---

## LO PRIMERO QUE DEBERÍAS HACER

Preguntarme si ya apliqué el esquema en Supabase y desplegué en Railway.
**Hasta que eso pase, el sistema no existe para el cliente**: todo lo que se ha
visto corre contra IndexedDB.

```bash
npm run db:instalar
# pegar supabase/instalar.sql completo en Supabase > SQL Editor > Run
# antes, cambiar  v_nombre text := 'RutaAhorro';  por el nombre real del local
npm run db:admin -- --correo=dueno@almacen.cl --nombre="Nombre Apellido"
```

`instalar.sql` deja tablas, funciones, disparadores, RLS con políticas por rol,
vistas, y un tenant con una tienda. **Sin ningún producto**, a propósito.

`db:admin` existe porque el paso delicado es invisible: el perfil no lo crea el
panel de Supabase, lo crea el disparador `handle_new_user` leyendo
`raw_user_meta_data`. Si ese JSON no trae `tenant_id`, el usuario se crea igual,
entra al login igual, y queda sin perfil — y la app lo rechaza sin decir por qué.

---

## LO PENDIENTE, EN ORDEN

Detalle completo con IDs en `docs/22-tareas-pendientes.md`. Resumen:

### Bloqueado en Felipe o en el cliente, no en programar

- **B-01 a B-03** — aplicar el esquema, crear el admin, desplegar en Railway.
- **B-04, B-05** — **certificado digital** y **enrolamiento como emisor
  electrónico ante el SII**. Son trámites con plazos ajenos y son la ruta
  crítica del módulo tributario. Hay que empezarlos ya, en paralelo al
  desarrollo, no cuando el código esté listo.
- **B-07** — imprimir una etiqueta EAN-13 y escanearla con el POS. El patrón de
  módulos y el SVG están verificados; el papel contra el lector, no.

### Defectos abiertos, por daño

1. **T-02 · `fn_update_product` transaccional.** Hoy `repoSupabase.actualizar`
   borra todos los códigos de barra del producto y los reinserta. Si la
   inserción falla, el producto queda **sin ningún código**: deja de aparecer
   al escanear y nadie entiende por qué. Es el hallazgo A-4 en la edición y
   `fn_create_product` no lo cubre. **Es lo peor que hay abierto.**
2. **T-03 · verificar M4-16 (stock por lote).** Figura ✅ en el inventario de
   alcance y el código no lo respalda. Es el mismo patrón que ya produjo el
   hallazgo de RF-M3-08: un requerimiento cerrado sin evidencia.
3. **T-01 · usar `products.description`.** La columna existe en la base desde el
   primer día y **ninguna pantalla la lee ni la escribe**: no está en el
   formulario, ni en el `SELECT` del repositorio, ni en la ficha del POS.
4. **T-04** recuperar contraseña · **T-05** anular venta (`fn_void_sale` está
   probada y no la invoca ninguna pantalla) · **T-06** corregir un movimiento de
   caja.

### La deuda silenciosa

**T-40 · los casos CP-01 a CP-08 de `docs/16-plan-pruebas.md` nunca se han
ejecutado.** Siete requerimientos de concurrencia están marcados como hechos y
descansan en diseño, no en pruebas. Dos cajeros vendiendo el último producto al
mismo tiempo no se ha probado jamás. Es el riesgo más grande del proyecto.

---

## SOBRE LA BOLETA — NO CONFUNDIR DOS COSAS

**Identificar un producto al escanearlo ya funciona.** `product_barcodes` con
`unique (tenant_id, barcode)`, el escáner del POS y la búsqueda están completos.
No necesita QR ni nada nuevo. Lo único que falta es T-01, la descripción.

**La boleta electrónica es otra cosa, y el formato importa.** La representación
impresa **no lleva QR**: lleva el **timbre electrónico en PDF417**. Es requisito
del SII, no una preferencia de diseño. Y el timbre no se puede dibujar: contiene
la firma del documento con el **certificado digital del contribuyente** y
consume un folio de un **CAF** autorizado. Sin B-04 y B-05 no hay boleta válida
por mucho código que se escriba. Ver `docs/18-documentos-tributarios-sii.md` §2.

El generador de EAN-13 que escribí a mano en `core` **no sirve** para el timbre:
PDF417 es otro formato, con corrección de errores Reed-Solomon y varios modos de
compactación. Ahí probablemente convenga una biblioteca.

**Lo que sí se entrega hoy** es el comprobante interno de venta: detalle, neto,
IVA desglosado, total, imprimible en térmica de 58/80 mm, y dice
`NO ES DOCUMENTO TRIBUTARIO` en pantalla y en el papel. Eso no es un detalle: un
papel que se parece a una boleta y no lo es, es un problema para el cliente.

El simulador completo (F5, tareas T-20 a T-28) **se puede programar hoy**, sin
esperar ningún trámite.

---

## LO QUE NO SE PUEDE ROMPER

1. **Todo pasa por la capa de repositorio.** Nada de llamar a Supabase desde un
   componente. Es lo que permite que la app corra igual en demo (IndexedDB) y
   en producción.
2. **El kardex es inmutable** (ADR-006). Un error se corrige con un movimiento
   contrario, nunca editando ni borrando.
3. **Una caja cerrada no se modifica.**
4. **El dinero se guarda en enteros.** Nunca decimales, nunca float (RNF-32).
5. **`service_role` jamás llega al navegador.** Vive en el servidor: hoy el
   route handler de invitación de usuarios y el script `tools/crear-admin.mjs`.
6. **La seguridad vive en la base**, con RLS en el 100 % de las tablas. Ocultar
   un botón no es seguridad.
7. **Los precios incluyen IVA.** El IVA se extrae del total, nunca se suma
   encima. Y el neto sale por diferencia, para que `neto + IVA === total` sin
   descuadre de un peso.
8. **Un ADR no se edita.** Si una decisión cambia, se escribe uno nuevo que
   declara superado al anterior.
9. **Dinero con `validarMonto`, cantidades con `validarCantidad`.** Nunca
   `parseCLP` para una cantidad: borra todo lo que no sea dígito, así que "1,5"
   se convierte en 15. Y nunca `Number()` a secas sobre lo que escribe el
   usuario: `Number("1,")` es `NaN`. Los dos errores ya ocurrieron, en pantallas
   distintas.
10. **Diálogos con `<Modal>` y campos con `<Campo>`**, de
    `apps/web/src/components/`. No escribir un `role="dialog"` a mano: los nueve
    que había estaban todos mal.

---

## DECISIONES DEL CLIENTE PENDIENTES

No avanzan programando. Están en `docs/15-preguntas-abiertas.md`.

- **P-28 — ¿Tiene certificado digital y enrolamiento ante el SII?** Ruta
  crítica del módulo tributario.
- **P-27 — ¿Qué proveedor de DTE?** Condiciona todo el diseño de F6.
- **P-26 — El cliente había pedido Vercel + Railway** y se decidió solo
  Railway (ADR-008). Hay que decírselo.
- **P-13 — ¿Repositorio público o privado?** De esto depende si hay que rotar
  las llaves de Supabase.
- **P-08 — ¿Cómo lleva hoy el inventario?** Si hay un Excel, se migra.
- **Nombre del producto:** las maquetas dicen "SimplePyme", el repo dice
  "RutaAhorro". Lo correcto sería SimplePyme = producto, RutaAhorro = primer
  cliente.

**P-03 ya se respondió:** el cliente sí requiere boleta y factura electrónica
ante el SII. Eso era R-01, el mayor riesgo del proyecto, y dejó de ser riesgo
para ser alcance. Ni la propuesta comercial ni el plan de trabajo lo
contemplaban: **hay que revisar precio y plazo** (T-41).

---

## CONVENCIONES

- **Español de Chile**, incluidos los nombres de variables y funciones del
  dominio (`repoProductos`, `confirmarRecepcion`, `validarMonto`).
- **Errores en lenguaje del negocio**, nunca técnicos: "No hay stock suficiente
  de Coca-Cola 1.5L", jamás "constraint violation". Todo error que llegue al
  usuario pasa por `toUserMessage`.
- **Móvil primero.** El objetivo táctil mínimo es 44 px (RNF-16).
- **Color nunca solo:** todo estado va con color *y* texto (RNF-46).
- **Los comentarios explican el porqué, no el qué.** Si un comentario describe
  lo que el código ya dice, sobra.

---

## CÓMO QUIERO QUE TRABAJES

Como **jefe de proyecto y QA**, no como programador que ejecuta órdenes.

- **Verifica el estado real, no lo asumas.** Ya aparecieron tres requerimientos
  marcados como hechos que no funcionaban en producción, un plan de despliegue
  que describía otro proyecto, un contrato que prometía atomicidad que el código
  no daba, y un documento al cliente que ofrecía una función inexistente. Los
  documentos mienten; el código no.
- **Dime lo que no quiero oír.** Si algo está mal estimado, si una decisión mía
  contradice un pedido del cliente, o si un requerimiento "listo" no lo está.
- **No declares terminado lo que no probaste.** `npm test`, `npm run typecheck`
  y `NEXT_PUBLIC_DEMO=false npm run build:web` antes de decir que algo funciona.
- **Si encuentras un bug mientras haces otra cosa, dilo.** Aunque no sea lo que
  te pedí.
- Al terminar una tanda, deja registrado lo que hiciste: commit con el porqué
  en el mensaje, y el documento correspondiente actualizado.
