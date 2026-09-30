# Prompt de continuación — RutaAhorro

> Copia todo lo que sigue y pégalo como primer mensaje en la sesión nueva.
> Está escrito para que alguien que no vio nada del proyecto pueda continuarlo
> sin volver a preguntar lo básico.
>
> **Corte: 2026-09-30.**

---

## CÓMO SEGUIR — corte 2026-09-30 (2ª ronda), léelo antes que todo

**2026-09-30 (2ª ronda) · Versión 0.3.0: visual profesional, requerimientos
pendientes y robustez.** Pedido: "seguir avanzando en todo, teniendo en cuenta
los requerimientos funcionales, no funcionales y técnicos; mejorar el
entendimiento, los botones y lo visual". Se priorizó con la matriz (docs/24).
**Sin migraciones nuevas.**

**Visual y entendimiento**
- **Contraste (RNF-44):** el blanco sobre el verde de TODOS los botones
  principales daba 3,46:1 (bajo AA) y el gris suave 4,44:1. Verde
  `#157a4c` (5,36:1) y gris `#5b6577`. Foco visible con teclado (RNF-45).
- **Íconos SVG propios** (`components/Icono.tsx`) en vez de emoji en el menú,
  "Más", escáner, exportar: los emoji se ven distinto en cada celular y no
  toman el color del ítem activo.
- **Encabezado común** (`components/Encabezado.tsx`) en las 17 pantallas:
  título, para qué sirve, "volver" de 44 px y acciones. "Más" muestra una
  frase de ayuda por sección (`ayuda` en `lib/navegacion.ts`). Estado vacío
  común. Botones `btn-primario/secundario/peligro/fantasma` en globals.css.
- Ojo: `globals.css` pone TODO `<button>` en 16 px (sin capa) y eso le gana a
  `text-sm`/`text-xs` de Tailwind en botones. Es a propósito (iOS), no bajarlo.
- Botones renombrados (recorridos ya ajustados): "+ Producto" → "Nuevo
  producto", "+ Cliente" → "Nuevo cliente", "+ Combo" → "Nuevo combo",
  "+ Crear cuenta" → "Crear cuenta", "+ Recepción" → "Recibir mercadería".

**Requerimientos que pasan a hechos (con prueba o recorrido que los cita)**
- RF-M7-10 gráfico 30 días (Inicio y Reportes) · RF-M7-11 comparación con el
  período anterior · RF-M3-11 **Compras → Qué comprar** (WhatsApp, copiar,
  Excel) · RF-M2-15 **Duplicar** producto · RF-M5-04/RF-M2-04 **código
  desconocido → crear el producto** con el código puesto (admin/supervisor en
  Vender; también bodega en Consultar precio) · RF-M9-03/RNF-48
  **Configuración → Mis datos** (JSON con todas las tablas del local, sin
  claves del SII) · RF-M9-09 **Novedades** y versión+commit al pie del menú ·
  RF-M1-07 **salir con ventas sin enviar avisa**.
- Inicio del jefe: primeros pasos (RNF-18) mientras el local se arma, gráfico
  y accesos rápidos. Lógica en core: `tendencia.ts`, `compras.ts` (10 pruebas).

**Técnico**
- **Service worker** (`public/sw.js`, solo en producción): Vender y Consultar
  precio abren sin internet si se abrieron antes (RNF-08/13/01). Solo guarda
  GET del mismo sitio; nunca /api/; pantallas red-primero; no guarda
  redirecciones; al salir se borran. La Caja no se guarda (montos viejos).
- **Errores (RNF-40):** `error.tsx`, `global-error.tsx`, `not-found.tsx` en
  castellano, y todo error del navegador va a `/api/errores` → queda en los
  logs de Railway como `[error-navegador]` con usuario, rol y local.
- **Diálogos en portal** (`Modal` → `document.body`): dentro de la cabecera
  (sticky z-30) la barra inferior tapaba sus botones. Lo encontró el recorrido.
- **bwip-js diferido** (timbre PDF417): se carga al mostrar un documento.
  **RNF-06 cumplido:** Vender bajó de 495 a 249 kB de JS inicial y Ventas de
  485 a 243 kB (límite 250). Mantenerlo: nada pesado en importación fija.

**Verificado:** core 417 (+10) · typecheck · build de producción · recorridos
en demo: `demo-ronda2.mjs` **15/15**, `demo-flujo.mjs` 18/18,
`demo-datos.mjs` 11/11, `demo-roles.mjs` (152: 19 pantallas × 4 roles × 2 anchos, sin errores ni
desbordes) · `sin-red.mjs` **5/5** contra la app compilada: Vender abre y
busca sin red (control: con el service worker bloqueado, 0/5). **No se corrió contra
Supabase ni Railway.**

**No regenerar docs/24 fuera del computador de Felipe:** `tools/matriz.mjs`
lee `tools/ui/.resultado-*.json`, que no están en el repositorio; corrido acá
bajaría los ✅ de los recorridos. Felipe: `node tools/matriz.mjs` después de
correr los recorridos. docs/17 ya dice ✅ en lo nuevo.

**Pendiente, en orden:** lo del corte anterior (llave `SUPABASE_SECRET_KEY` en
Railway, `db:cuentas`, recorridos contra Railway) · cerrar en la base que bodega
no cambie el precio · RF-M5-08/10 descuentos y pago mixto (la base acepta
varios pagos, pero con tarjeta toda la venta sale como voucher: **preguntar
al contador** antes de ofrecerlo).

---

## CÓMO SEGUIR — corte 2026-09-30 (1ª ronda)

**2026-09-30 · Auditoría completa por rol (jefe, QA, vendedor) y lo que salió.**
Pedido: "mejorar la página como jefe, QA y vendedor; el ingreso y el manejo de
información; que se pueda iniciar sesión con una cuenta de vendedor y otras;
buscar errores en flujos, botones e información; decidir y subir". Se recorrió
todo en el navegador (modo demo, 360 y 1280 px, los 4 roles) antes de tocar
nada. **Sin migraciones nuevas**: nada que aplicar en Supabase.

**Ingreso y cuentas**
- **Crear cuenta con contraseña temporal** (Usuarios → "+ Crear cuenta"): no
  pasa por el correo, que en Railway lleva a localhost. El admin ve el correo y
  la clave para dictarlos; al primer ingreso la persona elige una suya
  (`app_metadata.debe_cambiar_clave`, solo el servidor lo escribe → `/clave`).
  Invitar por correo sigue como segunda opción. Rutas: `/api/usuarios/crear`,
  `/api/usuarios/clave` (admin, mismo local), `/api/cuenta/clave` (la propia).
- **"Nueva contraseña"** por empleado en Usuarios, y **"Cambiar mi
  contraseña"** (🔑 en el celular, abajo en la lateral).
- **`npm run db:cuentas -- --dominio=rutaahorro.cl`** crea o repara una cuenta
  por rol (supervisor@, vendedor@, bodega@ del dominio; `--roles`, `--clave`,
  `--tenant`, `--cambiar-al-entrar`). Si ya existe, le pone la clave y corrige
  el perfil: sirve para "no puedo entrar con el vendedor".
- **Cada rol entra a su pantalla**: admin/supervisor al Inicio, vendedor al
  POS, bodega a Inventario (antes todos al POS, bodega incluida).
- Cuenta en Auth **sin perfil**: antes, bucle infinito de redirecciones; ahora
  dice "no está vinculada a ningún local" con botón Salir.
- **Modo demo con ingreso de verdad**: `/login` con cuentas de ejemplo
  (`admin@demo.cl`, `supervisor@demo.cl`, `vendedor@demo.cl`,
  `bodega@demo.cl`, clave `demo1234`), "Salir" funciona, y las cuentas que se
  crean en Usuarios también entran.

**Permisos (defectos reales, vistos en el recorrido)**
- **Bodega abría /pos y /caja** (vendía y veía la plata) y **el Inicio con
  "Vendido hoy" se abría para vendedor y bodega**. Producción incluida.
- En el demo, Ofertas, Combos, Etiquetas, Clientes y Facturación **no
  revisaban el rol** y daban props de admin. Ahora todas las páginas usan
  `exigirRol` (`lib/permisos.ts`) y quien no puede entrar vuelve a SU inicio.
- **Vendedor: "Mis ventas"** (matriz doc 02 ✅, la RLS ya lo limitaba), sin
  anular ni devolver.
- "Quitar/Desactivar producto" solo admin (matriz); bodega edita productos
  **sin tocar el precio**. ⚠️ Esto último es solo pantalla: `fn_update_product`
  deja a bodega cambiar el precio. Cerrarlo en la base es una migración (pendiente).
- Desactivar/reactivar ya no dice "listo" si la base no tocó la fila.

**Información**
- **Ventas sumaba solo las 50 cargadas** (un día bueno salía corto) y no
  restaba devoluciones (no cuadraba con el Inicio). Ahora el resumen sale de
  `v_sales_daily`, hay **"Cobrado por medio de pago"** y "Ver 50 más antiguas".
- **Caja**: desglose por medio de pago (efectivo/débito/crédito/transferencia;
  `fn_cash_session_summary` ya lo traía) y el historial dice "faltaron $2.000"
  / "sobraron" en vez de "-$2.000".
- **"Hydration failed" en cada pantalla con hora**: Node y el navegador
  escriben "a. m." con espacios distintos; React redibujaba la Caja entera.
  Horas en 24 h (`hourCycle: 'h23'`).
- El error genérico decía **"Ya fuimos notificados"**: nadie es notificado.
  Ahora es honesto, y un corte de red dice "No hay conexión con el servidor".
- Faltaba favicon (404 en cada pantalla).

**Ingreso de datos**
- Producto: un **código escrito sin tocar "Agregar" se perdía** al guardar
  (ahora se guarda, o avisa si es de otro); aviso de **nombre repetido**; aviso
  si un perecible con stock queda sin fecha; el recién creado se ve aunque
  hubiera filtros; el precio se formatea ($1.590) al salir del campo.
- **Recepción**: la barra "Confirmar recepción" **quedaba tapada** por la
  navegación del celular (pendiente desde el 27-09, medido con
  `elementFromPoint`); la fecha mínima de vencimiento usaba UTC (después de las
  20-21 h no se podía elegir hoy); la recepción a medio cargar **se guarda en
  la pestaña** y se recupera; botón "Vaciar" con confirmación.
- Inventario en 360 px: el nombre salía como "Aceite vege…" (botones debajo
  ahora); "Mover todo" al reponer; enlaces "← Productos" de 16 px a 44 px.
- **Caja del demo funciona** (abrir, ingresos/egresos, cerrar, y el POS pide
  abrirla si se cerró), en una cookie (`lib/demo/caja.ts`).

**Verificado:** 407 lógica (+1: error de red) · typecheck de los 3 paquetes ·
`db:check` · build de producción con demo apagado · worker 6/6 con Chromium ·
recorridos nuevos en demo: `tools/ui/demo-roles.mjs` (72 combinaciones rol ×
pantalla, sin errores ni desbordes), `demo-flujo.mjs` **18/18** (ingreso real
del vendedor → venta → Mis ventas → caja → cierre → POS pide abrir → reabrir →
salir → bodega → admin crea cuenta → la cuenta nueva entra),
`demo-datos.mjs` **11/11**. **No se corrió contra Supabase ni Railway** (esta
sesión no tiene credenciales): `db:test` no se repitió porque el SQL no cambió.

**Para Felipe, en orden:**
1. En Railway, que exista **`SUPABASE_SECRET_KEY`** en la web (crear cuentas y
   poner claves temporales la usan; sin ella responden "falta la llave").
2. Crear las cuentas de prueba: `npm run db:cuentas -- --dominio=<tu dominio>`
   y entrar con `vendedor@<dominio>` en Railway. O desde Usuarios → "+ Crear cuenta".
3. Recorridos contra Railway con el código nuevo: `m1-usuarios.mjs` (arma la
   invitación por API, no por el botón, así que no cambia), `movil.mjs`,
   `m6-caja.mjs`, `flujo-completo.mjs`. Falta un recorrido de "+ Crear cuenta"
   contra Supabase real (en demo pasa, `demo-flujo.mjs`).
4. Sigue pendiente lo del 29-09 (Site URL de Supabase, `SII_CLAVE_CIFRADO`,
   decisión de la factura del POS).

---

## CÓMO SEGUIR — corte 2026-09-29

**2026-09-29 (4º corte) · La factura real queda LISTA PARA ENCHUFAR, y un
defecto de navegación que solo se veía en Railway.** Pedido de Felipe:
"primero facturas; no tengo RUT, clave ni certificado, pero dejemos todo
listo; la boleta automática después de vender en efectivo o transferencia
queda para un paso siguiente". Lo hecho:
- **Ensayo del robot** (`ensayarEnPortal`, `npm run ensayo-sii -w
  @rutaahorro/worker -- --ver`): todo el recorrido en el portal REAL con las
  credenciales guardadas, y se detiene antes de firmar. Confirma los supuestos
  (2ª línea, campos de totales) sin emitir nada. Pasos del día en que lleguen
  las credenciales: docs/09 §3.4.
- **0028 (aplicada, 37 funciones):** `sii_ensayos`; encender exige un ensayo
  exitoso posterior a las credenciales vigentes; **guardar credenciales apaga
  la emisión** (disparador en la base). Emisor SII muestra "1. Datos del emisor
  · 2. Credenciales · 3. Ensayo" con ✔/✖ y texto; "Encender" solo con los tres.
  Avisa que la factura del POS sigue simulada.
- **Robot:** si el SII no completa la razón social del receptor (RUT no
  reconocido), no firma; lo que el SII puso queda en `job_runs`. 6/6 contra el
  portal simulado (vistos fallar antes).
- **Defecto de navegación (visto en Railway, reproducido en local, visto
  fallar):** tocar "Caja" y enseguida "Vender" con red lenta dejaba la URL en
  /pos con la Caja dibujada, y "Vender" ya no respondía. Es la precarga de los
  `<Link>` del menú chocando con la navegación en curso (Next 15.5.25; la
  15.5.26 tampoco lo arregla). Menú inferior, "Más" y barra lateral sin
  precarga. `flujo-completo.mjs` paso 5 retrasa 1,5 s la Caja para forzarlo, y
  ahora guarda captura y texto de la pantalla cuando un paso se corta.
- `ofertas.mjs` editaba "el primer producto" tras 1,5 s fijos: a veces otro.
  Ahora toca el de la fila buscada.
- m1, m5 y m6 tenían la URL fija en localhost: **nunca se habían corrido contra
  Railway**. Ahora aceptan `RA_BASE`.
- Verificado en local: 406 lógica · 6 robot · db:test 157 (+1 T-45) · m1
  20/20, m5 24/24, m6 13/13, documento 19/19, documentos 19/19, ofertas 20/20,
  ofertas-masivas 21/21, clientes 14/14, combos 10/10, bodega-sala,
  flujo-completo 54/54, facturacion 35/35, móvil todo.
- **Contra Railway con d07847f:** flujo-completo 54/54 (el paso 5, que antes se
  pegaba), combos 10/10, ofertas 20/20, facturacion 35/35, móvil todo. Con
  a8f7dbe ya habían pasado m5, m6, documento, documentos, ofertas-masivas,
  clientes y bodega-sala. m1 espera la configuración de Supabase (abajo).

**TAREA DE FELIPE, urgente (no es código):** en Railway los enlaces de
**invitar empleado** y **recuperar contraseña** llevan a `localhost:3000`
(m1 14/16 contra Railway): Supabase ignora la dirección que pide la app porque
el dominio no está autorizado. Supabase → Authentication → URL Configuration:
**Site URL** = `https://rutaahorroweb-production.up.railway.app`; en **Redirect
URLs** agregar `https://rutaahorroweb-production.up.railway.app/**` (dejar
`http://localhost:3001/**`). Verificar `NEXT_PUBLIC_APP_URL` en Railway. Después
`RA_BASE=… node tools/ui/m1-usuarios.mjs` debe dar 16/16. Y cargar
**`SII_CLAVE_CIFRADO`** en la web de Railway antes de que el cliente guarde sus
credenciales (sin ella, guardar responde 500).

**Decisión pendiente de Felipe:** con la emisión real encendida, "Factura" en
el POS sigue simulada: ¿el POS manda a Facturación, o encola la factura?

**2026-09-29 (3er corte) · Parte 2 Facturación: RECORRIDA, APLICADA EN
SUPABASE Y SUBIDA.** Se cerró la lista del 2º corte (abajo). 0026 y **0027**
aplicadas (37 funciones expuestas, RLS completo). Estado verificado: 406
pruebas de lógica · 4 del robot · db:test 156 (+1 T-45) con reinstalación ·
recorridos en local: m1 20/20, m5 24/24, m6 13/13, documento-venta 19/19,
documentos 19/19, ofertas 20/20, ofertas-masivas 21/21, clientes 14/14,
combos 10/10, bodega-sala, flujo-completo 54/54, **facturacion 32/32**, móvil
(todas, con `/facturacion`) · build de producción limpio.

Lo que destapó el recorrido y las pruebas (todo visto fallar antes de arreglar):
- **Defecto de diseño de 0026, grave para el robot: el IVA de la factura.**
  0026 calculaba la factura como una boleta (IVA extraído del total). En un
  DTE 33 el IVA es `round(neto × 19 %)` con neto entero, y el portal lo calcula
  así: **1 de cada 6 totales no existe en una factura** ($22 → $21 o $23; medido
  en 2 millones). El robot se habría negado a firmar esas facturas para siempre.
  **0027** (`fn_desglose_factura`): el neto sale de la suma, el IVA del neto; el
  total puede quedar $1 sobre o bajo la suma de las líneas y la pantalla lo avisa
  ("Ajuste IVA", y en la confirmación). `ivaDeNeto` y `ajuste` en core;
  `planFacturaPortal` exige que el IVA sea el que calculará el portal.
- **Robot: `__name is not defined`.** Con `tsx` (`npm run dev`/`job`), esbuild
  envuelve funciones con nombre dentro de `page.evaluate` y el robot se caía al
  elegir empresa y al leer totales. Arreglado; comentario en `portal.ts`.
- **Carrera del RUT** (misma familia que la del POS): en Nueva factura y en
  Recibidas, un RUT escrito antes de que bajara la lista de clientes/proveedores
  no se reconocía nunca. Ahora se busca de nuevo al llegar (solo completa lo vacío).
- **Pedido de Felipe (29-09):** con el RUT de un cliente guardado aparece
  altiro la tarjeta "Se factura a" (razón social, RUT, giro, dirección) y los
  campos quedan plegados detrás de "Corregir datos"; se abren solos si falta
  algo que el SII exige.
- Inicio: "Ver todos" medía 16 px (solo aparece con muchas alertas). 44 px.
- `documento-venta` esperaba 3 s fijos a `/ventas`; ahora espera la lista.
- Edge no arranca bajo puppeteer ("Code: 0"); la prueba del robot usa Chrome.

**Robot del SII:** URL configurables solo por opción (`portal: {sii, misii}`),
nunca por variable de entorno. `apps/worker/test/portal.test.ts` contra un
portal simulado (4/4, entra en `npm test`): emite con dos líneas, folio y PDF;
**no firma** si el total no cuadra (visto fallar quitando esa comparación);
error después de firmar = "puede estar emitida"; empresa ausente = se detiene.
**Supuestos hasta el portal real** (VSV nunca los usó): el botón de la 2ª línea
y los `name` de los totales. Felipe pegó la pantalla real del portal (29-09):
confirma que muestra "Monto Neto", "IVA 19 %", "Total", "% Desc." por línea,
"Descuento Global", "Tipo de Compra" y datos de transporte, pero **no los
`name`**. La primera emisión real: una línea, mirando.

**Pendiente, en orden:**
1. Recorridos contra Railway con el código nuevo (movil.mjs solo).
2. **Decisión de Felipe:** con la emisión real encendida, **la factura del POS
   sigue saliendo simulada** (`fn_emitir_dte_venta` no pasa por la cola). O el
   POS deja de ofrecer factura y manda a Facturación, o la encola. Además usa
   el IVA extraído (el problema de 0027).
3. **Precaución del robot:** el SII completa razón social, dirección y giro
   desde su registro al validar el RUT (VSV lo lee, `portal.ts` no). Leerlos y
   no firmar si el SII no reconoció el RUT; guardar lo que el SII puso.
4. Nota de crédito parcial: su IVA se extrae (no `round(neto × 19 %)`). Da igual
   mientras sea simulada; importa cuando el robot emita notas.
5. Campos del portal que la factura manual no tiene: tipo de compra (hoy "Del
   giro" implícito), descuento global, referencias (OC, guía), transporte.
   Preguntar al cliente cuáles usa antes de agregarlos.
6. Exportar el resumen a Excel: sin recorrido.
7. Worker en Railway con Chromium: documentado (docs/09 §3.4), **no probado**.

**2026-09-28 (noche, 2º corte) · [CERRADO en el 3er corte] Parte 2 Facturación: CÓDIGO HECHO, SIN
RECORRIDO, SIN APLICAR, SIN SUBIR.** Dos commits locales encima de `c6e002c`
(ese sí está en Railway): (1) arreglo de la carrera del carrito del POS,
(2) facturación. **No hacer push hasta cerrar la lista de abajo**: la web
nueva pide tablas que Supabase todavía no tiene.

Qué hay y qué está probado:
- **Carrera del carrito (defecto real, visto en Railway):** si el cajero
  agregaba un producto mientras el POS terminaba de bajar el catálogo, ese
  cambio no se guardaba nunca. Ahora el carrito se restaura apenas se monta el
  POS. `flujo-completo.mjs` tiene el paso "Carrera" que la fuerza (demora la
  2ª consulta de ofertas 12 s): **visto fallar sin el arreglo (53/54) y pasar
  con él (54/54)**. Falta repetir m5, documento-venta y clientes, que tocan el POS.
- **Contra Railway con `c6e002c`:** `ofertas.mjs` **20/20** (las 4 fallas del
  27-09 quedaron corregidas en producción), `ofertas-masivas` 21/21.
  `flujo-completo` 41/44 por la carrera de arriba. `movil.mjs` dio 403 en
  `/auth/v1/user`: **lo causé yo** (un diagnóstico le cambió la clave al cajero
  mientras corría); repetirlo solo.
- **Migración 0026 `facturacion.sql`** (no aplicada): `facturas`,
  `factura_lineas`, `factura_notas_credito`, `facturas_recibidas`,
  `sii_credenciales` (sin política ni privilegios), vistas
  `v_ventas_mensuales` y `v_compras_mensuales`, 8 funciones expuestas (ya
  agregadas a las dos listas) y 3 solo para `service_role` (la cola del robot).
  La unicidad de folios de `dte_documentos` pasa a ser por ambiente (el SII
  numera sus folios reales desde 1). `facturacion.test.mjs` **15/15**; db:test
  completo **155 (+1 T-45)**; reinstalación OK.
- **Decisiones de Felipe (28-09):** la línea de catálogo descuenta stock (sala,
  kardex, FEFO; la nota de crédito vuelve a los mismos lotes); la línea libre
  no. Emisión real = robot del portal del SII, no proveedor de DTE.
- **core:** `facturacion.ts` (`resumenFactura`, `planFacturaPortal`: neto por
  línea con 6 decimales para el portal) y `cifrado.ts` (AES-256-GCM con
  WebCrypto, formato `v1:iv:dato`). 403 pruebas de lógica.
- **Robot:** copia **intacta** del modelo en `apps/worker/src/sii/modelo-vsv/`
  (con README de qué cambió y por qué), adaptación en `apps/worker/src/sii/portal.ts`
  (varias líneas, compara el total del portal con el de la base **antes de
  firmar**, y todo error después de "Firmar" avisa que puede estar emitida) y
  cola en `jobs/facturas-sii.ts` (cada minuto, una a la vez, apagada sin
  `SII_CLAVE_CIFRADO` + `CHROME_PATH` + el interruptor del local).
  `puppeteer-core` agregado al worker. **Nunca corrió contra el SII** (B-04, B-05).
- **Web:** `/facturacion` (admin y supervisor, en "Más"): Emitidas (ver, nota
  de crédito, reintentar/descartar, usar como base), Nueva (cliente por RUT o
  nombre desde Clientes, líneas de catálogo o libres, precios con IVA o netos,
  borrador en la pestaña, barra de totales sobre la navegación del celular,
  medida en 60 px), Recibidas (proveedor por RUT, se crea si no existe),
  Resumen mensual (IVA débito − crédito, exporta a Excel), Emisor SII (admin).
  Rutas del servidor `/api/facturacion/credenciales` (cifra con
  `SII_CLAVE_CIFRADO`) y `/api/facturacion/pdf`. Build de producción limpio.

**Falta, en este orden:**
1. `tools/ui/facturacion.mjs` a 360 px: emitir con una línea de catálogo y una
   libre, autocompletar el receptor desde un cliente existente, ver el stock
   bajar, nota de crédito parcial, registrar una recibida con proveedor por
   RUT, resumen del mes, y que "Emitir factura" no lo tape la barra inferior
   (`elementFromPoint`). Agregar `/facturacion` a `RUTAS.admin` de `movil.mjs`.
2. Una prueba del robot contra un **portal simulado local** (HTML con los
   mismos `name` del SII) para ejercitar `portal.ts` sin credenciales: hoy
   solo compila. Para eso las URL del portal tienen que poder cambiarse.
3. Aplicar 0026: `npm run db:instalar` y `npm run db:aplicar -- --aplicar`
   (verificar 37 funciones expuestas).
4. Todas las pruebas y recorridos en local, `node tools/matriz.mjs`, docs
   (docs/09 §3.4: variables `SII_CLAVE_CIFRADO` en web y worker, `CHROME_PATH`
   y Chromium en el worker; docs/23 y 24), commit y push. Después, los
   recorridos contra Railway.

**2026-09-28 (noche) · Parte 1 TERMINADA: el flujo de producto a caja, recorrido
y en producción.** `tools/ui/flujo-completo.mjs` (53/53) lo hace entero a 360 px:
crear un pan perecible con 20 en sala, 5 en bodega y su vencimiento → editarlo
(stock, quién, historial, edición simultánea, "Ajustar stock") → consultador
"Agregar a la venta" → escribir 12 panes y 0,35 kg de queso → salir y volver sin
perder la venta → cobrar con boleta → stock, lote FEFO → cierre con faltante.

- **POS:** la cantidad se escribe (entera; hasta 3 decimales solo para kg,
  gramo, litro y ml, `validarCantidadVenta` en core). El carrito y el cliente
  se guardan en `sessionStorage` con dueño (regla 18). Las líneas del carrito
  se refrescan cuando llega el catálogo: **antes, una línea agregada mientras
  bajaba el catálogo se quedaba sin la oferta para siempre** — era la causa de
  las 4 fallas de `ofertas.mjs` en Railway, no solo el tiempo fijo del
  recorrido. El consultador también refresca el producto que muestra.
- **Consultador:** "Agregar a la venta" con cantidad (admin, supervisor,
  vendedor; bodega no).
- **Migración 0025 (aplicada en Supabase):** el producto recién creado dice
  quién lo creó (antes "sin registro" hasta la primera edición), y la vista
  `products_public` trae `updated_by`. **Defecto grave de b62fd32 que nunca
  llegó a producción:** la lista de productos sin costos (vendedor, bodega y
  los selectores de Configuración, Ofertas, Combos y Clientes) respondía 400.
  0017 ahora borra la vista antes de recrearla (regla 22).
- **0024 aplicada en Supabase.** `railway.json` alineado con docs/09.
- Coma decimal en cantidades (`formatCantidad`): comprobante, lista, formulario.
- `ofertas-masivas.mjs` contra Railway: 21/21; el corte del 27-09 no se repitió.
- Pendiente anotado, no hecho: la base acepta 1,5 de un producto por unidad
  (solo la pantalla lo impide). Cerrarlo es tocar `fn_register_sale` entero.

**Sigue: Parte 2, Facturación.** Felipe confirmó el 28-09: la factura manual
**descuenta stock** en las líneas de catálogo, y la emisión real va por **el
robot del portal del SII** copiado de VSV-Contadores (no un proveedor de DTE).
Pidió copiar el archivo del robot dentro de este repositorio y construir desde
esa copia.

**Despliegue:** la app está en Railway, en **https://rutaahorroweb-production.up.railway.app**
(lo desplegó Felipe el 27-09 desde `main`). Los recorridos corren contra ella con
`RA_BASE=https://rutaahorroweb-production.up.railway.app node tools/ui/<x>.mjs`. El 27-09
pasaron todos contra Railway salvo `ofertas.mjs` (4 fallas: el POS cobró $6.000 en vez de
$4.200 y el consultador no mostró la oferta) y `ofertas-masivas.mjs` (se cortó sin
resultado). Sospecha no confirmada: los recorridos esperan 2,5 s fijos a que el celular
baje el catálogo y por internet tarda más. **Hay que confirmarlo**; hasta entonces, las
ofertas en Railway no están verificadas. Ojo: `railway.json` del repo no coincide con
docs/09 (build sin `npm ci --include=dev`, healthcheck `/login`); alinearlo.

**Pedido de Felipe del 28-09, en curso (dos partes):**

**Parte 1 · el flujo completo, de crear un producto al cierre de caja, "perfecto".**
Se recorrió en el navegador a 360 px con `tools/ui/explorar-flujo.mjs` (capturas en
`tools/ui/.capturas/flujo`): funciona de punta a punta (crear con 20 en sala → vender 3 →
stock 17 → boleta → caja espera $750 → cierre pide explicación si no cuadra). Hallazgos:

| # | Hallazgo | Estado |
|---|---|---|
| 1 | "¿Cuántos tienes hoy?" quedaba al fondo del formulario en el celular; Felipe no encontraba dónde poner la cantidad | **Código hecho, sin recorrido**: el formulario ahora va Nombre → Precio/Costo → Unidad → ¿Cuántos tienes hoy? → Perecible → Código de barras → "Más datos (opcional)" plegado → Ofertas plegado |
| 2 | Tras crear, sin aviso y el producto quedaba perdido en la lista | **Código hecho, sin recorrido**: aviso "✓ X creado: 20 a la vista…" y la lista filtra al recién creado |
| 3 | Editar no decía cuánto stock hay ni cómo cambiarlo | **Código hecho, sin recorrido**: "Stock ahora" + botones "Ajustar stock" (`/inventario?ajustar=<id>` abre el ajuste directo) e "Ingresar mercadería" |
| 3b | 0020 en pantalla: "última modificación por", historial de precios, aviso de edición simultánea | **Código hecho, sin recorrido**: `fn_update_product` recibe `p_expected_updated_at` (string tal cual), el formulario muestra quién/cuándo y el historial, y ante PRODUCTO_CAMBIO_MIENTRAS_EDITABAS ofrece "Recargar el producto" |
| 4 | POS: para 20 panes hay que tocar "+" 19 veces; un producto por kilo no admite 0,35 | **Pendiente**: tocar el número y escribir la cantidad (decimales solo si la unidad es kg/gramo/litro/ml; CartLine necesita `unidad`) |
| 5 | Consultador: Felipe quiere "descontar directamente" desde ahí | **Pendiente**: botón "Agregar a la venta" con cantidad → `sessionStorage` 'pos:agregar' → /pos lo agrega. **Hallazgo relacionado sin arreglar: el carrito del POS vive solo en memoria; si el cajero sale a otra pantalla a mitad de una venta, la pierde.** Persistirlo en sessionStorage |
| 6 | Un perecible creado con stock no tenía fecha: esas unidades quedaban "sin lote" y fuera de las alertas | **Base hecha y probada** (migración **0024**, `stock-inicial.test.mjs` 4/4, vistas fallar sin ella; reinstalación OK). El formulario pregunta "¿Cuándo vence lo que tienes?". **0024 NO está aplicada en Supabase**: aplicarla antes de subir a GitHub (Railway despliega `main`) |
| 7 | Botones de la cabecera de Productos solo con íconos en el celular | **Código hecho, sin recorrido**: ahora dicen Etiquetas / Ofertas / Importar |

Falta: recorrer todo lo anterior en el navegador (móvil incluido), convertir
`explorar-flujo.mjs` en un recorrido con comprobaciones (`flujo-completo.mjs`), correr
todas las pruebas, aplicar 0024, commit y push.

**Parte 2 · módulo de Facturación aparte** (todavía no empezado). Lo que pidió Felipe:
emitir una factura manual y editable usando el catálogo de productos (la boleta sigue
saliendo del POS), autocompletar receptor desde Clientes (0022) y datos de proveedores,
e historial de facturas, compras y ventas en el mismo módulo. **Modelo a seguir:**
`C:\Users\felip\OneDrive\Documentos\VS\VSV-Contadores\src\components\facturacion\scripts\factura_manual.mjs`
(robot Puppeteer que entra al portal de facturación gratuito del SII con la clave del
contribuyente, llena el formulario, firma con la clave del certificado, lee el folio,
baja el PDF y guarda en `documentos_emitidos`; ver también `modals/dte/FacturaElectronicaModal.jsx`,
`tabs/DocumentosDTE.jsx`, `scripts/subir_facturas_recibidas.mjs`, `utils/montos.js`).
Decisiones tomadas (Felipe puede cambiarlas): (a) la factura manual **descuenta stock**
si la línea es un producto del catálogo; una línea libre (servicio, flete) no;
(b) la emisión real será ese robot adaptado, corriendo en el servidor (worker), con la
clave del SII y del certificado guardadas cifradas; mientras el cliente no las entregue,
el módulo funciona en **modo simulado** como la boleta (0019 ya tiene folios, XML,
timbre y notas de crédito simuladas). Es el "EmisorDTE real" de T-22/T-31, y evita
contratar un proveedor de DTE (B-06).

**Estado verificado al cortar** (todo en verde): 380 pruebas de lógica · 131
contra PostgreSQL (+1 pendiente conocida, T-45) · `db:e2e` 26/26 · recorridos
m5 23/23, documento-venta 19/19, documentos 19/19, ofertas 20/20,
ofertas-masivas 21/21, clientes 14/14, combos 10/10, m1 20/20, m6 13/13,
bodega-sala, móvil (todas las pantallas) · build de producción limpio.
**Migraciones 0021, 0022 y 0023 aplicadas en Supabase** (29 funciones expuestas).

**2026-09-27 (tarde) · 0023: combos** (RQ-45). «2 bebidas + 1 pan por $3.000»
se aplica solo en el POS. El ahorro viaja como descuento de las líneas del
combo, y la base calcula por su cuenta cuánto corresponde
(`fn_ahorro_combos`, idéntico a `calcularCombos` de core). Ese monto no cuenta
contra el tope del rol; lo que se descuente de más, sí. No se suma a ofertas
ni a precio de cliente, y se apaga con el interruptor.
**Defecto encontrado y corregido:** el POS mandaba como `p_discount_total`
(descuento a la venta completa) el total de descuentos del carrito,
incluidos los de línea, que la base ya recibe en cada línea: los restaba dos
veces. No se veía porque ninguna línea tenía descuento. Ahora va 0 hasta que
exista RQ-16.

**Pendiente de la primera sesión, sin tocar:** terminar 0020 en la pantalla
(aviso de edición simultánea, "última modificación por", historial de
precios) y el recorrido `tools/ui/m2-productos.mjs`. Después, el orden de
abajo sin lo ya hecho: RQ-15/16/17 descuentos con autorización + RQ-22 pago
mixto → RQ-24 caja compartida → RQ-03 cajas y packs → RQ-35 devolución a
proveedor → T-55 → T-45 → RNF medibles.

**2026-09-27 (tarde) · 0022 aplicada en Supabase: clientes y precio por
cliente** (RQ-07, RQ-20, RQ-21). Decisión de Felipe: % general por cliente +
precios especiales por producto; se cobra el más barato entre oferta, % y
especial, **sin sumarse**, y el interruptor de ofertas no los apaga. El
cliente viaja en `p_document.cliente_id` (misma firma, cola sin conexión
intacta) y queda en `sales.cliente_id`. `/clientes` para admin y
supervisor; el cajero lo elige en el POS (lista replicada al celular) y la
venta siguiente parte sin cliente. La factura guarda al receptor y el cobro
lo autocompleta por RUT. **Riesgo que hay que decirle al cliente:** un cajero
puede elegir al mayorista para cualquiera. Queda registrado en la venta, pero
no se le pide autorización (eso sería RQ-17). Pruebas: 369 lógica · 124
PostgreSQL · db:e2e 26/26 · recorridos clientes 14/14, m5 23/23, documento
19/19, ofertas-masivas 21/21, móvil OK. **Sigue: combos (0023).**

**2026-09-27 (tarde) · 0021 aplicada en Supabase: ofertas a muchos productos,
por porcentaje, e interruptor del local** (RQ-42, RQ-43, RQ-44 en `docs/23`).
Pedido de Felipe sobre lo que 0018 no cubría. `/productos/ofertas` (admin y
supervisor) aplica "desde N, X % menos" o "a $P c/u" a los productos elegidos,
con vista previa y los que se saltan; Configuración tiene "Rigen las ofertas y
promociones". Apagadas, el catálogo del celular llega sin ofertas y la base no
acepta el precio de oferta, salvo lo vendido sin conexión antes de apagarlas
(`ofertas_pausadas_desde`) y 15 min de gracia. Pruebas: 364 lógica · 115
PostgreSQL (+1 T-45) · db:e2e 26/26 · recorridos `ofertas-masivas` 21/21,
`ofertas` 20/20, móvil sin problemas. **Siguen, en este orden: RQ-20/21/07
clientes y precio por cliente (0022), y combos entre productos (0023).**
**Ojo, sin arreglar:** la barra "Confirmar" de Recepción es `fixed bottom-0 z-30`,
y en el celular la barra de navegación (`z-40`) la tapa. Hay que medirlo con
`elementFromPoint` como en `ofertas-masivas.mjs`.

**Estado verificado al cortar** (todo en verde, nada a medio aplicar):
359 pruebas de lógica · 104 contra PostgreSQL (+1 pendiente conocida, T-45) ·
`db:e2e` 26/26 contra Supabase · recorridos en navegador documentos 19/19,
ofertas 20/20, M5 23/23, M1 20/20, M6 13/13, documento 19/19, bodega-sala y
móvil (todas las pantallas a 360 y 1280 px) · build de producción limpio.
**Migraciones 0017 a 0020 aplicadas en Supabase.**

**Lo que quedó a medio camino (seguro, no rompe nada):** 0020 ya está en la
base —`products.updated_by` y `fn_update_product(…, p_expected_updated_at)`
que avisa si otro editó el producto (RF-M10-03, prueba CP-06)— pero **la
pantalla todavía no lo usa**. Siguiente paso: que `repoSupabase.actualizar`
mande `p_expected_updated_at: producto.actualizadoEn` (el string tal cual
viene de la base, sin pasar por `Date`, o se pierden los microsegundos), que el
formulario muestre "Última modificación: <nombre>, <fecha>" y el historial de
precios (T-19, `price_history`), y que ante `PRODUCTO_CAMBIO_MIENTRAS_EDITABAS`
ofrezca recargar. Después, un recorrido `tools/ui/m2-productos.mjs`.

**La matriz de requerimientos** (`docs/24`, se regenera con
`node tools/matriz.mjs`) es la fuente para decir qué está hecho: ✅ solo si una
prueba o recorrido lo cita y pasa. Al corte: RF ✅ 62 de 134 · ⚠️ 39 marcados hechos
sin prueba · 33 incompletos o sin hacer; RNF ✅ 4 de 56. **El trabajo que sigue
es T-52**: recorridos de M2 Productos, M3 Proveedores, M4 Inventario y M7
Reportes, que van a convertir ⚠️ en ✅ o destapar defectos (ya destapó uno: la
búsqueda de Productos solo buscaba por nombre).

**Orden sugerido después:** RQ-15/16/17 descuentos con autorización de John o
María José + RQ-22 pago mixto (T-16, T-17) → RQ-24 caja compartida (cuando el
cliente responda la pregunta 1) → RQ-20/21 clientes y precio por cliente →
RQ-03 cajas y packs → RQ-35 devolución a proveedor → T-55 productos desde la
factura → T-45 costos → RNF medibles (rendimiento, accesibilidad, seguridad).

**Preguntas para el cliente:** `docs/cliente/preguntas-2026-09-28.md` (17,
escritas para John y María José).

**Pendiente de Felipe, no de código:** B-03 desplegar en Railway · T-50 SMTP
propio · B-09 rotar llaves · **cambiar la clave `admin123`, que quedó en el
grupo de WhatsApp** · antes de mostrarle el sistema al cliente,
`npm run db:limpiar -- --si-borrar-todo` y `npm run db:admin`.

**Cómo levantar para probar:** `npm run build:web`, luego
`cd apps/web && npx next start -p 3001`; los recorridos son `node tools/ui/*.mjs`.

---

## LO ÚLTIMO QUE PASÓ — léelo primero

**2026-09-27 · boletas, facturas y notas de crédito simuladas, y devoluciones
— migración 0019, aplicada en Supabase.**

- Cada venta en efectivo o transferencia emite su **boleta electrónica (39)**,
  y la factura su **factura electrónica (33)**, en la misma transacción que la
  venta, con folio correlativo por tipo. Con tarjeta no: el documento es el
  voucher de la máquina.
- El ticket es el documento: nombre, folio, RUT del emisor y **timbre PDF417
  que se lee con un lector** (el recorrido lo decodifica). Dice
  **SIMULADA · SIN VALIDEZ TRIBUTARIA**, porque lo es.
- **Devoluciones parciales o totales** desde Ventas, con **nota de crédito
  (61)** que referencia el documento. Una venta con boleta ya no se anula.
- XML del DTE descargable desde Ventas (`packages/core/src/dte.ts`).
- **Esto no emite ante el SII.** Falta el certificado (B-04), el enrolamiento
  (B-05), los CAF (T-30), el emisor real (T-31) y la certificación (T-32).
- `db:check` ya no se caía con archivos grandes; `<Modal>` apilado (X-2).

Pruebas: **359 de lógica · 102 contra PostgreSQL (+2 pendientes) · db:e2e
26/26 · recorridos documentos 19/19, ofertas 20/20, M5 23/23, M1 20/20, M6
13/13, documento 19/19, bodega-sala, móvil sin problemas.**

---

**2026-09-26 (noche) · ofertas, impuestos y configuración — migración 0018,
aplicada en Supabase.**

- **Ofertas por cantidad** («1 por $2.000 y si llevas 3, los 3 a $1.400») y
  promociones con fechas. El POS recalcula la línea al cambiar la cantidad.
- **T-14 cerrada:** la base compara el precio que llega con el que
  corresponde; cobrar menos es un descuento y pasa por el tope del rol.
- **Impuestos adicionales editables** (IABA, ILA) en `/configuracion`, y
  asignación a muchos productos a la vez. La venta congela la tasa.
- **`/configuracion`** (T-18): la operación del local sin entrar a Supabase.
- **S-8:** el administrador de un local podía reactivar su propia suscripción
  escribiendo `tenants` a mano. Cerrado.
- "Jo" es **María José** (grupo de WhatsApp). **La clave `admin123` quedó
  escrita en ese grupo: cambiarla antes de que el local venda.**

Pruebas: **345 de lógica · 85 contra PostgreSQL (+2 pendientes) · db:e2e
24/24 · recorridos ofertas 20/20, M5 23/23, M1 20/20, M6 13/13, documento
19/19, bodega-sala, móvil (14 pantallas del admin) sin problemas.**

Regla nueva, la 22: **`create or replace view` no puede quitar columnas.** Si
una migración posterior le agrega columnas a una vista, la que la define
primero tiene que borrarla antes (`drop view if exists`), o reinstalar falla.

---

**2026-09-26 · el cuestionario del cliente.** Respondió las preguntas 1–42
(del documento del 15-09). Están traducidas a **41 requerimientos (RQ-01 a
RQ-41)** en `docs/23-requerimientos-cuestionario.md`, con estado real, los
supuestos para las preguntas sin respuesta y **siete preguntas que hay que
volver a hacerle** (§3). La más urgente: **¿John y Jo venden del mismo cajón?**
Hoy la caja es por persona; si comparten cajón, los arqueos no van a cuadrar
nunca (RQ-24).

Hecho y probado ese día (migración **0017**, ya aplicada en Supabase):

- **RQ-14 · vender sin stock** (respuesta 13), como parámetro del local
  `vender_sin_stock`. De paso, un defecto: una venta **sin internet** de un
  vendedor con el stock del celular viejo quedaba en error para siempre al
  sincronizar. Ahora viaja forzada y deja la alerta.
- **Productos no cargaba para un vendedor** (400 de la base, celular y
  computador): la vista `products_public` no tenía las columnas de 0006. Y al
  arreglarla apareció la regla 21 en versión vista: `create or replace view`
  con menos columnas falla al reinstalar. 0004 ahora la borra antes.
- **RQ-13 · lector de códigos físico:** el Enter del lector se ignoraba.
- **RQ-25 · "Lo habitual: $20.000"** al abrir caja.
- **`db:test` se colgaba** al terminar (PostgreSQL embebido que no se apagaba
  en Windows). Ahora apaga con `pg_ctl`.
- **`tools/ui/movil.mjs`**: todas las pantallas a 360 px y 1280 px, por rol.
  Mide desbordes y botones bajo 44 px y deja capturas en `tools/ui/.capturas/`.

Estado: **318 pruebas de lógica · 69 contra PostgreSQL (+2 pendientes
conocidas) · `db:e2e` 24/24 · recorridos M1 20/20, bodega-sala, M5 23/23, M6
13/13, documento 19/19, móvil sin problemas · build de producción limpio.**

Lo que sigue, en orden (detalle en `docs/23` §4): la caja compartida cuando el
cliente responda, descuentos con autorización de John/Jo en el mostrador y pago
mixto, precio por mayor junto con T-14, devoluciones parciales con nota de
crédito.

---

### Antes · 2026-09-20

**2026-09-20.** El cliente dejó una lista de diez puntos en una reunión. **Seis
están hechos y probados en el navegador contra Supabase**; cuatro quedan, en el orden que eligió Felipe. El detalle punto por punto está en
`docs/21-qa-pantallas.md` §0f, y acá abajo en "La lista del cliente" y "A dónde
va cada unidad".

| Hecho | Falta |
|---|---|
| 4, 6, 9 (mitad), 10 · qué documento corresponde a cada venta, y la barra del celular | **T-57** · descuentos por cantidad (punto 8), junto con T-14 |
| 5 · el consultador de precios (`/precio`) | **T-55** · crear productos desde la factura del proveedor (punto 3) |
| 1 y 2 · a dónde va cada unidad al ingresar un producto | **T-56** · notas de crédito (punto 7) |
| | **T-52** · seguir el recorrido por requerimiento |

**La lista del cliente, textual**, para que no se pierda en la traducción:

> 1. El ingresar producto a sala de ventas sale producto incial no sale especifico
> 2. Agregar buen que se agrega cuando se crea un producto
> 3. Agregar productos llegados de una factura
> 4. Boletas solo con transferencia y efectivo cuando es con tarjeta es con maquina
> 5. Consultador de precio
> 6. Si es pago con tarjeta se debe entregar un boucher pero si es transferencia
>    o efectivo se entrega boleta y ticket
> 7. Notas de crédito para ventas en caso de un supuesto
> 8. Ver descuentos por unidades ejemplo 1 a 1000 y desde 3 a 700
> 9. Queda por predeterminado por boleta pero puedo hacer una factura y además
>    se debe tener rut clave y firma
> 10. Prioridad boletas y facturas y desplazamiento de iconos en celular no veo
>     esas iconos en el celu veo solo hasta inventario

Felipe aclaró el 1 y el 2: **«no sale a dónde va cada producto cuando lo
ingreso»** y **«que se entienda cuánta cantidad agrego en punto de venta y
cuántos hay en bodega, y mejorar qué es cada cosa, más simple»**. Eran el mismo
problema y quedaron resueltos en 0016.

Del punto 9, «rut clave y firma» **no** es la firma del cliente en un papel: es
el **certificado digital** (un `.pfx` con su clave) con el que se firma el DTE.
Eso es B-04 y hoy no existe.

**Tres cosas que hay que tener presentes antes de tocar nada:**

1. **Migraciones 0015 a 0020 ya están aplicadas en el Supabase real**
   (0019 y 0020 el 2026-09-27). Las dos le cambian la firma a una función. **Código nuevo con
   base vieja significa que ninguna venta se registra.** Si levantas esto en
   otra máquina, la base ya está al día; si vuelves a instalar, usa
   `npm run db:instalar` y pega `supabase/instalar.sql` completo.
2. **La base ya NO está limpia.** Los recorridos de QA volvieron a crear el
   local "QA · pruebas internas" con productos y ventas de prueba. Antes de una
   demostración: `npm run db:limpiar -- --si-borrar-todo` y después
   `npm run db:admin`.
3. **Esto todavía no emite boletas ni facturas ante el SII.** Sabe qué
   documento corresponde a cada venta y guarda el receptor validado; el timbre
   necesita el certificado digital y folios CAF, que son trámites (B-04, B-05).
   El papel sigue diciendo `NO ES DOCUMENTO TRIBUTARIO`.

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
| `npm test` | 318 pruebas de lógica de negocio |
| `npm run db:test` | 66 pruebas contra un **PostgreSQL real** en UTC, como Supabase: concurrencia, ataques por rol, zona horaria, instalador (~40 s, sin Docker) |
| `npm run db:aplicar` | Diagnostica la base real. Con `-- --aplicar` instala `instalar.sql` y **verifica** RLS, funciones expuestas y políticas. Necesita la contraseña real en `DATABASE_URL` |
| `npm run db:limpiar` | Respalda y dice qué borraría. Con `-- --si-borrar-todo` deja la base **de cero** y reinstala: es lo que hay que correr antes de mostrarle el sistema al cliente, porque los recorridos de QA dejan datos |
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

## ESTADO AL 2026-09-20

**318 pruebas de lógica · 66 contra PostgreSQL real · typecheck limpio · SQL
validado · build de producción con demo apagado · 14 rutas.**

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

### La base está limpia y lista para mostrar — 2026-09-19, última acción

`npm run db:limpiar -- --si-borrar-todo` dejó la base de cero y la reinstaló.
Hoy tiene **un local (RutaAhorro), una tienda, un usuario y nada más**: cero
productos, ventas, cajas y movimientos. El respaldo de lo anterior (244 filas y
7 usuarios) quedó en la carpeta del usuario, `respaldo-rutaahorro-2026-09-19`.

| | |
|---|---|
| Entrar | http://localhost:3001 (el 3000 lo ocupa otro proyecto de Felipe) |
| Usuario | `admin@gmail.com` con `admin123` — **cambiar antes de que la use el cliente** |
| Levantar | `npm run build:web`, después `cd apps/web && npx next start -p 3001` |

> **⚠ Al 2026-09-20 la base YA NO está limpia.** Los recorridos de esta sesión
> volvieron a crear el local "QA · pruebas internas" con productos, ventas
> (boleta, voucher y factura) y cajas de prueba. Está aislado por RLS y el
> cliente no lo ve, pero **antes de una demostración hay que correr
> `npm run db:limpiar -- --si-borrar-todo` y después `npm run db:admin`**.
> Ojo: `db:limpiar` reinstala `instalar.sql`, así que se lleva 0015 y 0016
> puestas. Lo correcto a futuro es un proyecto de Supabase aparte para QA:
> es **T-51**.

### A dónde va cada unidad — 2026-09-20, puntos 1 y 2 del cliente

Los dos puntos eran el mismo problema por dos lados. En palabras de Felipe:
«no sale a dónde va cada producto cuando lo ingreso» y «que se entienda cuánta
cantidad agrego en punto de venta y cuántos hay en bodega, más simple».

Desde 0014 el local tiene dos lugares y el sistema los lleva bien, pero **no
decía a cuál entra lo que se ingresa**. El formulario pedía "Stock inicial" a
secas y todo caía en la bodega, porque así lo decide `fn_ubicacion_por_tipo`.
Quien cargaba el catálogo creía dejarlo listo para vender, iba al POS y la sala
estaba en cero.

- **Migración 0016.** `fn_create_product` recibe cuánto queda a la vista y
  cuánto en bodega, y deja **un movimiento por lugar**, cada uno diciendo a
  cuál entró. Omitir el parámetro nuevo es lo de antes: todo a la bodega.
- **El formulario pregunta "¿Cuántos tienes hoy?"** con dos casillas —"En la
  sala de ventas (a la vista, listo para vender)" y "En la bodega (guardado, no
  se vende todavía)"— y el total abajo.
- **El kardex dice a dónde fue cada movimiento.** Un traspaso son dos filas y
  las dos decían "Traspaso" a secas; ahora dicen "sale de la bodega" y "entra a
  la sala de ventas".
- **La lista de stock habla en castellano:** "A la vista 4 · guardado en bodega
  6 · hay que reponer", en vez de "Sala 4 · Bodega 6 · reponer".

**Un defecto de la maqueta que salió de paso** (la pregunta de T-15): al crear
un producto en demo, el stock inicial quedaba **todo en la sala**, y en
producción **todo en la bodega**. La maqueta enseñaba lo contrario de lo que
pasa. Ahora reparte igual.

Probado: 6 pruebas nuevas contra PostgreSQL real (vistas fallar antes del
arreglo, regla 16) y **12/12 en el navegador** con 0016 aplicada en Supabase
(`node tools/ui/bodega-sala.mjs`), sin errores de JavaScript.

### La lista del cliente — reunión 2026-09-19 (noche)

Diez puntos de la reunión. **No son defectos de una pantalla: son alcance
nuevo**, y tres cambian cómo se cobra. La traducción a requerimiento, punto por
punto, está en `docs/21` §0f; las tareas nuevas son **T-53 a T-57**.

**Hechos: 4, 5, 6 y 10.**

- **Migración 0015 · el documento de cada venta.** Efectivo o transferencia →
  **boleta**. Tarjeta → **voucher**, porque el documento lo emite la máquina.
  **Factura** → siempre elección explícita del cajero, con cualquier medio de
  pago, y exige RUT válido y razón social. La regla la aplica
  `fn_register_sale`, no la pantalla: una venta también llega desde la cola sin
  conexión. Que la tarjeta emita el documento es su terminal y no una ley, así
  que vive en `tenants.settings.tarjeta_emite_documento`.
- **`/precio` · el consultador.** Lee el catálogo replicado del POS, así que
  responde **sin internet**, y no tiene carrito: hasta hoy, para ver un precio
  había que agregar el producto a la venta en curso y después vaciarla.
- **La barra inferior del celular llegaba hasta Inventario y ahí terminaba la
  app.** Proveedores, Ventas, Reportes y Usuarios no tenían ningún camino en el
  teléfono. Ahora el quinto lugar es "Más".

> **Esto no emite boletas ni facturas ante el SII, y 0015 no cambia eso.**
> Emitir necesita el certificado digital y folios CAF (B-04, B-05): trámites.
> Lo que hay es el sistema sabiendo **qué documento corresponde**, con el
> receptor validado. El papel sigue diciendo `NO ES DOCUMENTO TRIBUTARIO`.
> El punto 9 del cliente —«RUT, clave y firma»— son dos pedidos: elegir el
> documento (hecho) y el certificado digital con su clave (B-04).

> **⚠ La app y la base se actualizan juntas.** 0015 le cambia la firma a
> `fn_register_sale`. Código nuevo con base vieja: **ninguna venta se
> registra**. Aplicarla con `npm run db:instalar` y pegar
> `supabase/instalar.sql`, o `npm run db:aplicar -- --aplicar`.

**Recorrido en el navegador: 19/19, sin errores de JavaScript**
(`node tools/ui/documento-venta.mjs`, 2026-09-20, con 0015 aplicada en
Supabase). Cobro con efectivo, con tarjeta y con factura; el RUT malo avisa y
bloquea; el ticket lleva al receptor; Ventas muestra los tres documentos; el
consultador responde; y el menú "Más" del celular lleva a Proveedores, Ventas,
Reportes y Usuarios.

### Recorridos en navegador, por requerimiento — 2026-09-19 (tarde)

Con la base real, cada módulo se prueba en Edge como lo usaría la persona. Los
scripts están en `tools/ui/` (usan el Edge instalado con `playwright-core`, sin
descargar navegadores) y corren contra `http://localhost:3001` y el local
"QA · pruebas internas":

```bash
cd apps/web && npx next start -p 3001      # la app compilada, en otra terminal
node tools/ui/m1-usuarios.mjs              # 20/20
node tools/ui/bodega-sala.mjs              # 12/12
node tools/ui/m5-vender.mjs                # 17/17
node tools/ui/m6-caja.mjs                  # 13/13
node tools/ui/documento-venta.mjs          # 19/19  (RA_BASE=http://localhost:3005 si el 3001 está ocupado)
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

### Lo que queda de la lista del cliente, en el orden que eligió Felipe

1. **T-57 · descuentos por cantidad** (punto 8: «1 a $1.000, desde 3 a $700»).
   Tabla de tramos por producto, el POS recalculando la línea al cambiar la
   cantidad, y `fn_register_sale` validando el precio contra el tramo. **Hacerla
   junto con T-14**: hoy la base acepta el `unit_price` que manda el cliente sin
   compararlo con nada, y los tramos son justamente la tabla contra la cual
   comparar. Separadas, T-57 agranda el agujero de T-14.
2. **T-55 · crear productos desde la factura del proveedor** (punto 3). Hoy hay
   que salir a Productos, crear el producto y volver a empezar la recepción.
   Con una factura de 30 líneas nuevas es inviable.
3. **T-56 · notas de crédito** (punto 7). `fn_void_sale` ya anula y devuelve el
   stock; falta el documento que respalda la devolución, con su correlativo.
   Igual que la boleta: **registrarla se puede hoy, emitirla ante el SII no**
   (B-04, B-05).
4. **T-52 · seguir el recorrido por requerimiento** en Productos, Proveedores,
   Inventario, Reportes y Ventas. Es donde han salido todos los defectos.

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
22. **`create or replace view` no puede quitar columnas.** Si una migración
    posterior le agrega columnas, la migración que la crea primero tiene que
    hacer `drop view if exists` antes, o reinstalar falla con "cannot drop
    columns from view" (0017, `products_public`).
21. **Agregarle un parámetro a una función de la base crea una SOBRECARGA, no
    un reemplazo.** `create or replace` con un argumento más deja las dos
    firmas conviviendo, y entonces cualquier `grant execute on function
    public.fn_x` sin lista de argumentos falla con *function name is not
    unique* — que es como `instalar.sql` deja de ser idempotente sin que nadie
    lo note. Hay que borrar la firma vieja donde se define la nueva, **y**
    pre-borrar la nueva donde se define la vieja, para que reinstalar funcione.
    Ya pasó tres veces: `fn_adjust_stock` (0014), `fn_register_sale` (0015) y
    `fn_create_product` (0016). Lo encuentra `db:test`, no leer el SQL.

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
