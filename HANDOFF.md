# Prompt de continuación — RutaAhorro

> Copia todo lo que sigue y pégalo como primer mensaje en la sesión nueva.
> Está escrito para que alguien que no vio nada del proyecto pueda continuarlo
> sin volver a preguntar lo básico.
>
> **Corte: 2026-09-19.**

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
| `npm test` | 300 pruebas de lógica de negocio |
| `npm run db:test` | 36 pruebas contra un **PostgreSQL real** en UTC, como Supabase: concurrencia, ataques por rol, zona horaria, instalador (~40 s, sin Docker) |
| `npm run db:aplicar` | Diagnostica la base real. Con `-- --aplicar` instala `instalar.sql` y **verifica** RLS, funciones expuestas y políticas. Necesita la contraseña real en `DATABASE_URL` |
| `npm run db:e2e` | **La primera venta real**, de punta a punta contra Supabase, como la hace la app: producto, recepción, caja, venta con vuelto, reenvío, anulación, cierre que cuadra. Más los ataques de seguridad contra la base real (T-46). Corre en un local aparte, "QA · pruebas internas" |
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

## ESTADO AL 2026-09-19

**300 pruebas de lógica · 36 contra PostgreSQL real · typecheck limpio · SQL
validado · build de producción con demo apagado · 13 rutas.**

### La base real está instalada y la primera venta se hizo — 2026-09-19

- **Esquema instalado** en Supabase (`amlvspbmnhtvzuqiteqe`) con
  `npm run db:aplicar -- --aplicar`, y verificado: RLS en todo, 17 funciones
  expuestas, anon sin acceso.
- **`npm run db:e2e`: 24/24 contra la base real.** Primera venta (folio 1,
  $3.000, vuelto $2.000, IVA $479), reenvío sin duplicar, anulación con stock
  devuelto, cierre de caja que cuadra, y todos los ataques rechazados salvo
  T-45 (un vendedor lee costos). Corre en un local aparte, **"QA · pruebas
  internas"**, que no se mezcla con el del cliente.
- **Administrador creado** en el local "RutaAhorro" (el correo de Felipe).
- **`NEXT_PUBLIC_DEMO=false`** en `.env.local`: la app ya lee la base real.
- **Puerto 3001 en local**: el 3000 lo ocupa otro proyecto de Felipe (VSV).
  **Para usar la app, compilada** (`npm run build:web`, después
  `cd apps/web && npx next start -p 3001`): en modo desarrollo cada pantalla
  se compila la primera vez que se abre y tardaba 5 a 12 s. Compilada, 0,8 a
  1,5 s. Lo que queda es distancia: el servidor en Chile hace ~4 consultas en
  fila a Supabase en Canadá (~250 ms c/u). En Railway (EE. UU.) serán ~20 ms
  c/u. **No cambiar la región de la base**: São Paulo mejora el local pero
  empeora producción, porque Railway no tiene región en Sudamérica. `NEXT_PUBLIC_APP_URL`
  apunta ahí porque las invitaciones de usuario arman el enlace con esa URL.
- **Pendiente B-09:** la contraseña de la base y la llave secreta pasaron por un
  chat para poder instalar. Rotarlas.

Lo siguiente es que Felipe entre, cargue productos reales y venda desde la
pantalla, y B-03 (desplegar en Railway).

### Recorridos en navegador, por requerimiento — 2026-09-19 (tarde)

Con la base real, cada módulo se prueba en Edge como lo usaría la persona. Los
scripts están en `tools/ui/` (usan el Edge instalado con `playwright-core`, sin
descargar navegadores) y corren contra `http://localhost:3001` y el local
"QA · pruebas internas":

```bash
cd apps/web && npx next start -p 3001      # la app compilada, en otra terminal
node tools/ui/m1-usuarios.mjs              # 20/20
node tools/ui/bodega-sala.mjs              # 7/7
node tools/ui/m5-vender.mjs                # 17/17
node tools/ui/m6-caja.mjs                  # 13/13
```

Encontraron diez defectos (G-1 a G-10 en `docs/21` §0e), casi todos en
requerimientos marcados ✅. Los peores: la búsqueda del POS nunca funcionó, un
empleado invitado no podía crear contraseña, cerrar sesión sacaba a todos los
dispositivos, y **se podía cobrar sin que la venta quedara registrada**.

**Bodega y sala** (pedido del cliente, M4-13): lo que llega del proveedor entra
a la bodega, "Reponer" pasa a la sala, la venta descuenta de la sala y el POS
avisa si la sala no alcanza. Migración 0014.

**Tablero de requerimientos:** https://claude.ai/artifact/Eme759S2ZbjZU4UJrQG6vP
— los 190 requerimientos con su evidencia real y la decisión de Felipe en cada
uno (se guardan en la colección `decisiones`; leerlas antes de priorizar).

### ¿Queda algo escrito a mano? — la respuesta honesta

- **Fecha y zona horaria: no.** Web y base leen `tenants.settings.timezone`.
  Queda un solo valor por omisión (`configuracionBase.ts` y
  `fn_tenant_timezone`), el mismo que la columna trae desde 0001.
- **IVA, tope de descuento, variación de costo, horas de caja: no**, desde el
  2026-09-17.
- **Sí queda:** el worker (`America/Santiago` en el resumen diario y el correo,
  T-47), y el nombre "RutaAhorro" como marca en el título, el menú y el login
  —eso espera la decisión de T-42 (¿SimplePyme o RutaAhorro?).
- **La maqueta es escrita a mano por definición.** Mientras `NEXT_PUBLIC_DEMO`
  sea `true`, los productos, usuarios y ventas de ejemplo son inventados.
  **Los productos que se carguen en demo no llegan a la base**: viven en el
  navegador, y desde el 2026-09-19 se borran solos al pasar a producción
  (antes quedaban mezclados con los reales).

### Lo que se hizo el 2026-09-19

Salió de lo que Felipe vio probando el POS en la maqueta. Detalle en
`docs/21` §0d:

- **Ventas mostraba "hoy" en UTC** (F-1): lo vendido después de las 20:00–21:00
  aparecía en el día siguiente. En producción, no solo en demo.
- **Un supervisor no podía anular en la noche una venta de esa noche** (F-2,
  migración 0013). El banco de pruebas lo tapaba porque corría en la hora de
  esta máquina; ahora corre en UTC como Supabase.
- **`America/Santiago` escrito a mano** en 8 lugares de la web y 4 vistas (F-3).
  Funciones de fecha nuevas en core (`fechas.ts`, con los dos cambios de
  horario de Chile probados).
- **Los productos de la maqueta sobrevivían en producción**, y un celular
  compartido entre locales mostraba el catálogo del anterior (F-4).
- **Una venta sin conexión quedaba en la caja de quien sincronizara**, no de
  quien la hizo (F-5).
- **La cámara se pegaba** (F-6): cámaras huérfanas cuando se cerraba mientras
  el navegador la entregaba, y lectores ZXing que se acumulaban. **Falta
  probarlo en un celular real** (T-49).
- **La maqueta descartaba las ventas** y "Vendido hoy" era un número fijo (F-7).
  **El stock del POS quedaba viejo** 10 minutos después de vender (F-8).

F-4 a F-8 viven en el navegador y **no tienen prueba automática** (T-48).

### Lo que se hizo el 2026-09-18

**Por primera vez se ejecutó el esquema.** Hasta ayer `db:check` solo lo
parseaba. `tools/pg-test/` levanta un PostgreSQL embebido con lo mínimo de
Supabase encima —incluidos los privilegios por omisión, que son los que hacen
que una política permisiva sea una puerta abierta— y ataca con la sesión de
cada rol. Lo que salió, en `docs/21` §0b y §0c:

- **Un cajero podía escribir su propio arqueo** (`update cash_sessions set
  expected_amount = …`), insertar egresos firmados por el supervisor, ventas en
  la caja de otro, y entradas falsas en la bitácora inmutable. Un supervisor
  podía cambiar el total de una venta. Bodega podía reabrir una toma aplicada.
  Nada de eso lo hace la aplicación: eran políticas de escritura sobre tablas
  que solo escriben las funciones. **0012** las quita.
- **T-40: cinco de los ocho casos de concurrencia fallaban**, más cinco
  carreras que el plan no tenía. La toma aplicada dos veces dejaba 4 donde el
  conteo decía 7. Una venta cobrada durante un cierre forzado quedaba fuera del
  arqueo. Todo corregido en 0012 y probado forzando el peor intercalado.
- **`instalar.sql` no se podía ejecutar dos veces**, aunque decía que sí, y
  "reinstalar" era el consejo para llevar los arreglos a una base vieja.
  Corregido y probado.
- **S-1 y S-2 quedaron verificados** ejecutando el ataque, no leyendo el SQL.

Queda abierto **T-45 / S-7**: cualquier rol puede leer `avg_cost` por la API.

### Funcionando

Base de datos completa (26 tablas, 26 funciones, RLS al 100 %). POS con escáner
y modo offline. Ciclo de caja con arqueo, cierre forzado y movimientos.
Productos con alta y edición transaccionales, baja, categorías, descripción y
códigos múltiples. Carga masiva desde **Excel o CSV**. Etiquetas EAN-13
imprimibles. Usuarios con invitación por correo y roles. Proveedores y
recepción con lotes, vencimiento y aviso de variación de costo. Inventario con
ajustes, kardex, toma y **lotes con baja de vencidos**. **Historial de ventas
con anulación.** **Seis reportes con exportación a Excel.** Comprobante de
venta con desglose de IVA.

### Lo que se hizo el 2026-09-17

**Lo más importante son dos agujeros de seguridad.** No los encontró revisar
pantallas —las dos pasadas anteriores no los vieron— los encontró revisar quién
puede llamar a qué. Están detallados en `docs/21` §0.

1. **Las funciones internas nunca estuvieron cerradas.** `0004` decía
   `revoke execute on function fn_post_movement from authenticated, anon` y un
   comentario al lado afirmaba que no se exponían. No cerraba nada: PostgreSQL
   le concede EXECUTE a `public` al crear una función, y eso no se quita
   revocándoselo a `authenticated`. `fn_post_movement` es `security definer`,
   recibe **el tenant como parámetro** y no comprueba ni rol ni tenant. Un
   vendedor podía, desde el navegador, escribir stock de productos de otro
   local y forjar movimientos en el kardex —que es inmutable por diseño—
   atribuidos a cualquier usuario, porque `p_user` también es parámetro.
2. **Un vendedor podía hacerse administrador.** La política dejaba a cada uno
   actualizar su propia fila de `profiles` para corregirse el nombre, pero RLS
   trabaja por fila y no por columna: en esa fila están `role` y
   `max_discount_pct`. `update profiles set role='admin' where id = miId`.

Las dos están corregidas (migraciones 0009 y 0011). Con ellas, trece guardias
de rol que no guardaban nada —`NULL not in (...)` vale NULL y un `if` con NULL
no entra— y el tope de descuento, que estaba escrito en tres lugares y no se
aplicaba en ninguno.

| Commit | Qué |
|---|---|
| `d72af07` | T-02: edición de producto atómica + cerrar las funciones internas |
| `432b994` | T-03 y T-07: lotes visibles en Inventario y baja de lote vencido |
| `cbc142e` | Carga masiva desde Excel (.xlsx), sin convertir a CSV |
| `d87bd3e` | T-44: auditar Inicio línea por línea |
| `c99b010` | T-44: auditar Usuarios · escalada de privilegios y tope de descuento |
| `91b29b7` | La configuración del local deja de estar escrita a mano |
| `9724f99` | Reportes: siete vistas que existían desde 0005 y no leía nadie |
| `27e7557` | T-05: historial de ventas y anulación |
| `b0f63d9` | T-08: cerrar la caja que otro dejó abierta |
| `005078e` | Documentación al día |
| `d8925bf` | T-01: usar la descripción del producto |

**Las 11 pantallas están auditadas línea por línea.** No queda ninguna parcial.
Dos rutas nuevas: `/reportes` y `/ventas`.

**Diez requerimientos pasaron de "hecho en la base, falta la pantalla" a
hecho.** Esa categoría bajó de 16 a 6 en `docs/17`.

### Tres cosas que figuraban cumplidas y no lo estaban

Vale la pena tenerlas presentes, porque las tres tienen la misma forma: **la
pieza existía, estaba bien escrita, y no estaba conectada con nada.**

- **M4-16 "Stock por lote · visible en pantalla Stock":** no estaba visible en
  ninguna parte. Las dos vistas existían y solo las leía el worker.
- **M1-14 "Ver quién está conectado":** `last_seen_at` no la escribía nadie.
  Todos aparecían como "Nunca ha entrado". **Lo tapaba el modo demo**, porque
  los datos de ejemplo traen la hora puesta.
- **M2-11 "Carga masiva desde Excel/CSV":** leía CSV y nada más.

Ese último punto del medio dejó una tarea, **T-15**: revisar qué otros campos
rellena la maqueta que en producción no escribe nadie. No hay razón para creer
que `last_seen_at` era el único.

---

## LO PRIMERO QUE DEBERÍAS HACER

Preguntarme si ya apliqué el esquema en Supabase y desplegué en Railway.
**Hasta que eso pase, el sistema no existe para el cliente**: todo lo que se ha
visto corre contra IndexedDB.

> **Ahora hay una razón más para hacerlo cuanto antes.** Las correcciones de
> seguridad del 2026-09-17 y 2026-09-18 viajan en el esquema. Si en algún
> momento se aplicó una versión anterior en alguna parte, esa base tiene las
> puertas abiertas: volver a pegar `instalar.sql` completo. Desde 2026-09-18 eso
> funciona (está probado en `tools/pg-test/instalacion.test.mjs`); antes, la
> segunda ejecución fallaba sin aplicar nada.

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

0. **T-45 · cualquier rol lee costos por la API** (S-7, CP-10). La pantalla no
   los pide, pero la base los entrega. Arreglarlo cambia cómo leen costos
   Reportes, el formulario de producto y `v_inventory_valued`.
1. **T-14 · `unit_price` llega del cliente sin compararlo con el catálogo.** Es
   lo que queda abierto del tope de descuento: se puede rodear vendiendo a
   precio 1 en vez de aplicando un descuento. Que el precio viaje es
   deliberado —una venta hecha sin conexión se sincroniza con el precio que
   tenía al venderse— pero eso abre un camino que el tope no cubre. Cerrarlo
   bien pide comparar contra `price_history` con la fecha de la venta. Desde
   0012 `price_history` ya no se puede escribir a mano, que era condición.
2. **T-15 · revisar el resto de los datos de demo.** ¿Qué otros campos rellena
   la maqueta que en producción no escribe nadie? `last_seen_at` hizo que un
   requerimiento figurara cumplido durante semanas.
3. **T-04** recuperar contraseña · **T-06** corregir un movimiento de caja.
4. **T-16 a T-19** — descuento por línea en el POS, pago mixto, pantalla de
   configuración del local e historial de precios. Las cuatro están en la base
   y no en la pantalla.

### La deuda silenciosa

**T-40 se cerró el 2026-09-18** (queda CP-06, que nunca se implementó). Lo que
sigue sin probarse contra el Supabase real es **T-46**: `tools/pg-test` es una
réplica cuidadosa, pero es una réplica. Cuando B-01 esté hecho, correr los
ataques de `seguridad.test.mjs` contra el proyecto real con supabase-js.

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
11. **Un guardia de rol se escribe en positivo.** `if rol not in (...)` deja
    pasar a quien no tiene perfil, porque `NULL not in (...)` vale NULL y un
    `if` con NULL no entra. Van con `coalesce(rol::text,'')`. Ya había trece
    mal escritos.
12. **Para cerrar una función de la base hay que revocarle a `public`**, no a
    `authenticated`. PostgreSQL le concede EXECUTE a `public` al crearla, y
    revocarle a otro rol no quita nada. Ese error dejó `fn_post_movement`
    abierta a cualquier usuario con sesión.
13. **Los valores del negocio se leen de `tenants.settings`**, con
    `lib/datos/configuracion.ts`. Nada de escribir el IVA, el umbral de
    variación de costo o el tope de descuento en el código.
14. **Una tabla que se escribe con una función no tiene política de escritura.**
    Supabase le concede ALL sobre cada tabla a `authenticated`: una política de
    INSERT o UPDATE es una puerta, no un detalle. Si una función `security
    definer` escribe la tabla, la función no necesita la política y nadie más
    debería tenerla. `db:test` lo verifica atacando.
15. **Leer, decidir y escribir se hace con la fila bloqueada.** `select … for
    update` antes de mirar el estado (`status`, `quantity`, `avg_cost`). Varias
    filas de stock se bloquean todas juntas con `fn_lock_stock`, ordenadas por
    producto, para que dos operaciones no se traben entre sí. Ocho funciones
    fallaban por esto.
16. **Una prueba que nunca se vio fallar no prueba nada.** Antes de dar por
    buena una prueba de un arreglo, correrla sin el arreglo.
17. **Un día es del local, no de UTC.** Nunca `'YYYY-MM-DDT00:00:00'` sin zona,
    nunca `iso.slice(0, 10)`, nunca `::date` sobre un `timestamptz` en SQL.
    Siempre `rangoDeDias`/`diaLocal` de core con la zona de la configuración, y
    en SQL `at time zone fn_tenant_timezone(tenant)`. Tres defectos salieron de
    esto.
18. **La base del navegador tiene dueño.** La comparten la maqueta, producción
    y cualquier local que entre en ese celular. Lo que se guarda ahí se marca
    (`asegurarDueno`) y lo que se envía al servidor lleva quién lo hizo.
19. **Con conexión, una venta no se da por hecha hasta que la base responde.**
    El comprobante se entrega después de la confirmación. Sin conexión se
    encola (ADR-005), pero nunca se le entrega al cliente un papel de una
    venta que la base ya rechazó.
20. **Un requerimiento no está hecho hasta que se recorrió en el navegador.**
    El documento 17 marcaba ✅ la búsqueda del POS, las invitaciones y el
    cierre forzado, y ninguno funcionaba. `tools/ui/` es la evidencia.

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
