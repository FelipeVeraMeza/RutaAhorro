# 30 — Tienda online

> **Estado (2026-10-09):** etapa 1 (catálogo) y el carrito de la etapa 2 hechos
> y probados en local, sin subir. El diseño sigue la maqueta que trajo Felipe
> (titular, buscador, categorías con ícono, tarjetas con "Agregar al carrito").
> Sin fotos todavía: cada producto muestra el ícono de su categoría o, si no
> tiene, el que calza con su nombre (`lib/tienda/iconos.ts`).
>
> Pedido del cliente (2026-10-07): «ventas online, tarjeta, transferencia,
> productos, catálogo… cotízanos con y sin envíos». Hasta ahora era FA-5 en
> [01](01-vision-alcance.md) ("e-commerce, no fue solicitado, v2.0"): ahora lo
> está.

---

## 1. La idea en una línea

La tienda vende **los mismos productos, con los mismos precios y el mismo
stock** que el mostrador, porque es la **misma aplicación** con la misma base.
No hay un segundo catálogo que mantener ni stock que cuadrar entre dos sistemas.

```
tutienda.cl              → tienda pública (catálogo, carrito, pago)
sistema.tutienda.cl      → el sistema de siempre (POS, inventario, caja)
         └──── los dos llegan al MISMO servicio de Railway ────┘
                              │
                   Supabase: mismos productos, stock, ventas
```

## 2. Etapas

Cada etapa se puede publicar sola y deja algo útil.

| Etapa | Qué hace | Estado |
|---|---|---|
| **1. Catálogo** | Ver productos, precios, ofertas y disponibilidad; buscar; categorías; consultar por WhatsApp | ✅ hecha |
| **2. Carrito y pedido** | Armar el carrito, dejar los datos y encargar para **retiro en el local**; el local lo ve en "Pedidos web" | carrito ✅ · pedido por hacer |
| **3. Pago online** | Tarjeta (débito/crédito) y transferencia con la pasarela; el pedido se paga antes de prepararse | por hacer |
| **4. Envíos** *(opcional, cotizado aparte)* | Dirección, tarifa por comuna, estados de despacho | por hacer |
| **5. Mejoras** | Fotos desde Productos, qué productos se publican, boleta del pedido, SEO | por hacer |

---

## 3. Qué debe hacer el sistema

Numeración propia: **RT-** (requerimiento de tienda).

### Etapa 1 — Catálogo ✅

| N° | Requerimiento | Cómo quedó |
|---|---|---|
| RT-01 | Cualquiera ve el catálogo sin crear cuenta ni iniciar sesión | `/tienda`, el middleware la deja pasar |
| RT-02 | Todos los productos activos, **también los sin precio** (Felipe, 2026-10-09): esos dicen "Consultar precio", nunca "$0", y su WhatsApp pregunta el precio | `precioTienda` (core) |
| RT-03 | Nunca se muestra el costo, el margen ni la cantidad exacta en stock | La consulta elige columnas; al navegador llega `ProductoTienda` y nada más |
| RT-04 | "Disponible" / "Agotado". Si el local vende sin stock (`vender_sin_stock`), nada sale agotado | Lo agotado va al final de la lista |
| RT-05 | Las ofertas que rigen hoy, en palabras: "Desde 3: $1.400 c/u", "Oferta: $1.800" | `ofertasVisibles` (core), respeta el interruptor de ofertas del local |
| RT-06 | Búsqueda sin tildes y por palabras en cualquier orden | `filtrarCatalogo` (core) |
| RT-07 | Filtro por categoría | Botones arriba de la lista (no aparecen si el local no tiene categorías) |
| RT-08 | Páginas de 48 productos | |
| RT-09 | Ficha de cada producto con su propia dirección (para compartirla) | `/tienda/p/<id>`, con título y descripción para Google y WhatsApp |
| RT-10 | Botón "Consultar por WhatsApp" con el producto ya escrito | Solo si la sucursal tiene un celular chileno anotado |
| RT-11 | Un precio nuevo se ve en la tienda en menos de 1 minuto | Caché de 60 s en el servidor |
| RT-12 | La tienda no instala el modo sin conexión del POS ni muestra avisos del sistema | `RegistrarSW` no corre en la tienda |
| RT-13 | En el dominio de la tienda no se llega a ninguna pantalla del sistema | El middleware reescribe todo a `/tienda` |

### Etapa 2 — Carrito y pedido (retiro en el local)

| N° | Requerimiento |
|---|---|
| RT-20 | ✅ Agregar, quitar y cambiar cantidades; el carrito sobrevive a cerrar la pestaña (en el navegador). `lib/tienda/carrito.ts`, `/tienda/carrito` |
| RT-21 | ✅ El carrito aplica las mismas ofertas por cantidad que la caja (`calcularCarrito` → `precioPorCantidad`, core) |
| RT-21b | ✅ Mientras no exista el pedido, el carrito se envía por WhatsApp con el detalle y el total (`mensajePedido`, core). Sin celular de la sucursal, dice que se compre en el local |
| RT-21c | ✅ Pestañas como la maqueta: **Inicio** (`/tienda`: titular, ofertas de hoy, "Te puede interesar" que cambia cada día), **Productos** (`/tienda/productos`: todo, con búsqueda, categorías y páginas), **Ofertas** (`/tienda/ofertas`), **Mi cuenta** (`/tienda/cuenta`) y el carrito. Arriba en el computador; en el celular, una barra abajo |
| RT-21d | ✅ "Mi cuenta" sin clave: nombre, celular y correo guardados en el navegador del cliente (`lib/tienda/cliente.ts`); el pedido por WhatsApp dice quién pide, y queda en "Mis pedidos" con "Volver a pedir". Nada sale del navegador hasta que el cliente envía el pedido |
| RT-22 | Checkout: nombre, celular, correo; RUT opcional (para factura) |
| RT-23 | **El servidor recalcula precios y total.** Nunca se usa el precio que manda el navegador |
| RT-24 | Se crea un `pedido_web` con número correlativo y estado `pendiente` |
| RT-25 | Pantalla "Pedidos web" en el sistema (admin, supervisor, vendedor): lista, detalle, estados `pendiente → preparando → listo → entregado` y `anulado` |
| RT-26 | Al entregar, el pedido se registra como **venta** con `fn_register_sale` (kardex, caja, reportes y documento tributario igual que una venta del mostrador), con canal `web` |
| RT-27 | Aviso al local cuando entra un pedido (en la pantalla y por correo) |
| RT-28 | Correo al cliente: pedido recibido y pedido listo para retirar |
| RT-29 | Límite de pedidos por celular/IP para que nadie llene la lista con pedidos falsos |

### Revisión pestaña por pestaña (2026-10-09) ✅

| Pestaña | Mejora |
|---|---|
| Todas | La descripción "Código anterior: 3020002" que dejó la planilla no se muestra (`descripcionPublica`). Esqueleto de carga al cambiar de pestaña (`tienda/loading.tsx`) |
| Todas | **Rubros automáticos:** el catálogo real no tiene categorías, así que cada producto se agrupa por su nombre (Lácteos, Abarrotes, Snacks y dulces, Bebidas, Carnes y congelados, Frutas y verduras, Panadería, Limpieza y aseo; `rubroPorNombre`). Si el producto tiene categoría en el sistema, manda la categoría. Es una adivinanza por palabras: cargar categorías de verdad la reemplaza sola |
| Inicio | Botones de rubro, etiqueta "-17%" en las ofertas |
| Productos | "Ordenar por" nombre, menor o mayor precio (los sin precio van al final). Búsqueda sin resultados: consejo, "Ver todos" y 4 sugeridos |
| Ofertas | Recuadro que explica que se aplican solas en el carrito; también se ordena |
| Ficha | Ruta Productos › rubro, imagen más chica (en el celular el botón se ve sin bajar), recuadro "Ofertas de hoy" con cuánto se ahorra, "Compartir", "También te puede interesar" (mismo rubro), datos para Google (schema.org Product) y para la vista previa de WhatsApp. Sin precio y sin WhatsApp: "Pregunta el precio en el local" |
| Carrito | Se pone al día al abrirlo con `/api/tienda/productos` (precio nuevo, agotado o retirado: avisa y corrige), "Lleva 1 más y paga $500 c/u" (un toque lo aplica), "Ahorras $X con ofertas", "Quitar" por producto, "Vaciar" pregunta antes |
| Google | `robots.txt` (en el dominio del sistema solo `/tienda`; el resto del sistema no se indexa) y `sitemap.xml` con todas las fichas (RT-53) |

### Segunda maqueta: catálogo con barra lateral (2026-10-09) ✅

Inicio y Productos comparten `VistaCatalogo`: titular y buscador en una fila, franja de categorías con ícono, barra lateral con **Categorías**, **Precio** (mín./máx.) y **Marca**, y el panel "N productos encontrados" con "Ordenar por: Más relevantes" (lo que se puede comprar primero y, entre eso, lo en oferta). En el celular la barra va detrás del botón "Filtros". Todos los filtros viven en la dirección (`?categoria=&min=&max=&marca=&marca=`).

La **marca** no existe como columna: `marcaPorNombre` reconoce una lista de marcas en el nombre (Soprole 42, Nestlé 20, McKay 18, Watts 17… en el catálogo real). Una marca fuera de la lista no aparece en el filtro.

### Código de barras → ficha automática (evaluado, sin hacer)

Prueba del 2026-10-09 con 38 códigos del catálogo real contra **Open Food Facts** (base pública y gratuita): encontró **6 de 38 (16 %)**, los 6 con nombre, marca, tamaño y foto. Faltan casi todos los productos chilenos o de nicho (Watts, McKay, Gatorade, Oreo de acá). Extrapolado: ~90 de 568 productos con código. Las fotos de Open Food Facts son CC BY-SA: usarlas exige citar la fuente.

### Etapa 3 — Pago online

| N° | Requerimiento |
|---|---|
| RT-30 | Pago con tarjeta de débito y crédito por la pasarela (recomendada: **Flow**, que también trae transferencias) |
| RT-31 | Transferencia automática por la pasarela, **o** transferencia manual: se muestran los datos bancarios y el local marca "pago recibido" |
| RT-32 | El pedido pasa a `pagado` **solo** con el aviso firmado de la pasarela (webhook a `/api/tienda/pago`), nunca porque el navegador vuelva a la página de "gracias" |
| RT-33 | El aviso de pago se puede recibir dos veces sin duplicar nada (idempotente por id de transacción) |
| RT-34 | Pedido sin pagar en 30 minutos → `vencido`, y se libera lo reservado |
| RT-35 | Al pagar se **reserva** el stock; si en el intertanto se agotó, el local ve la alerta antes de prepararlo |
| RT-36 | En la caja, el pago online entra como su propio medio de pago (no ensucia el arqueo del efectivo) |
| RT-37 | Devolución/anulación de un pedido pagado: queda registrada; el reembolso se hace en el panel de la pasarela |
| RT-38 | La cuenta de la pasarela es **del local** (su RUT y su cuenta bancaria). El sistema solo guarda las llaves, cifradas como las del SII |

### Etapa 4 — Envíos (opcional)

| N° | Requerimiento |
|---|---|
| RT-40 | El cliente elige retiro en el local o despacho |
| RT-41 | Tarifas por comuna que el admin edita; comunas fuera de la tabla = sin despacho |
| RT-42 | Monto mínimo para despacho y despacho gratis desde $X (configurables) |
| RT-43 | Dirección con comuna, número, depto. y referencia |
| RT-44 | Estados `en camino` y `entregado`; correo al cliente en cada cambio |
| RT-45 | *(Extra)* Integración con un courier (Starken, Chilexpress, Blue Express): cotización y etiqueta automáticas |

### Etapa 5 — Mejoras

| N° | Requerimiento |
|---|---|
| RT-50 | Subir la foto del producto desde Productos (Supabase Storage); la columna `image_url` ya existe |
| RT-51 | Marcar qué productos se publican en la tienda (ej. no publicar cigarrillos ni alcohol, que tienen restricciones para venta a distancia) |
| RT-52 | Boleta electrónica del pedido online (con lo de 0037) |
| RT-53 | ✅ `sitemap.xml` y `robots.txt` (la tienda indexable; el sistema no) |
| RT-54 | Ícono, nombre y colores propios de la tienda al compartir el enlace |

---

## 3 bis. Requerimientos de la tienda: estado al 2026-10-09

> **Superado por [31 — 120 requerimientos y su estado](31-tienda-requerimientos.md)**, que numera RF-T01…RF-T60 y RNF-T01…RNF-T60 con su evidencia. Esta tabla queda como historia de la primera revisión.

Resumen consolidado de todo lo anterior. ✅ hecho y probado · ◐ parcial · ⏳ por hacer.

### Funcionales (RT)

| N° | Requerimiento | Estado |
|---|---|---|
| **Catálogo** | | |
| RT-01 | Ver el catálogo sin cuenta ni sesión | ✅ |
| RT-02 | Mostrar todos los productos activos; los sin precio dicen "Consultar precio" | ✅ |
| RT-03 | No mostrar costo, margen ni cantidad exacta en stock | ✅ |
| RT-04 | Disponible / Agotado (si el local vende sin stock, nada sale agotado) | ✅ |
| RT-05 | Ofertas del día en palabras y etiqueta "Oferta" | ✅ |
| RT-06 | Búsqueda sin tildes y por palabras en cualquier orden | ✅ |
| RT-07 | Categorías; sin categorías cargadas, rubros automáticos por el nombre | ✅ |
| RT-08 | Páginas de 48 productos | ✅ |
| RT-55 | Filtros de precio (mín./máx.) y marca; ordenar por relevancia, nombre o precio | ✅ |
| RT-56 | Búsqueda sin resultados: consejo y productos sugeridos | ✅ |
| RT-09 | Ficha de cada producto con dirección propia para compartir | ✅ |
| RT-57 | Ficha: ofertas explicadas (cuánto se ahorra), "Compartir", productos relacionados | ✅ |
| RT-10 | "Consultar por WhatsApp" desde la ficha | ◐ listo, pero la sucursal no tiene celular anotado |
| RT-11 | Un cambio de precio se ve en la tienda en menos de 1 minuto | ✅ |
| RT-58 | Pestañas Inicio · Productos · Ofertas · Mi cuenta · Carrito (abajo en el celular) | ✅ |
| RT-12 | La tienda no instala el modo sin conexión del POS ni sus avisos | ✅ |
| RT-13 | En el dominio propio de la tienda no se llega al sistema | ✅ (sin dominio todavía) |
| **Carrito y pedido** | | |
| RT-20 | Carrito que sobrevive a cerrar la pestaña | ✅ |
| RT-21 | El carrito aplica las mismas ofertas por cantidad que la caja | ✅ |
| RT-59 | Carrito al día con los precios de ahora; "Lleva N más y paga $X"; "Ahorras $X"; quitar y vaciar | ✅ |
| RT-21b | Enviar el pedido por WhatsApp con detalle, total y datos del cliente | ◐ listo, falta el celular de la sucursal |
| RT-21d | "Mi cuenta" sin clave: datos del cliente y "Mis pedidos" en su navegador, "Volver a pedir" | ✅ |
| RT-22 a RT-29 | Checkout con datos, pedido guardado en el sistema, pantalla "Pedidos web", pasar a venta, correos, límite anti-abuso | ⏳ etapa 2 |
| RT-30 a RT-38 | Pago con tarjeta y transferencia (pasarela), confirmación por aviso firmado, reservas | ⏳ etapa 3 |
| RT-40 a RT-45 | Envíos: retiro o despacho, tarifas por comuna, estados | ⏳ etapa 4 (opcional) |
| **Fotos y contenido** | | |
| RT-50 | Sacar o elegir la foto del producto desde Productos → Foto | ✅ |
| RT-60 | Al crear un producto escaneado, buscar su nombre, marca, tamaño y foto por el código (Open Food Facts) | ✅ |
| RT-61 | Completar de una vez las fotos que existan por código (`npm run db:fotos`) | ✅ |
| RT-62 | Descripciones sin datos internos ("Código anterior: …") | ✅ |
| RT-51 | Elegir qué productos se publican (alcohol, cigarrillos) | ⏳ |
| RT-52 | Boleta electrónica del pedido online | ⏳ con la etapa 2 |
| RT-53 | Google: robots.txt, sitemap.xml, datos del producto, vista previa al compartir | ✅ |
| RT-54 | Ícono y nombre propios de la tienda al instalarla o compartirla | ⏳ |

### No funcionales (RNT)

| N° | Requerimiento | Estado |
|---|---|---|
| RNT-01 | **Seguridad:** el visitante no toca la base. El servidor lee con la llave de servicio y elige columnas y local; `anon` no ejecuta ninguna función (`seguridad.test.mjs`) | ✅ |
| RNT-02 | **Precios:** el precio que se cobra lo decide el servidor, nunca el navegador. Hoy el carrito es una estimación que se pone al día al abrirlo; el recálculo al confirmar llega con el pedido (RT-23) | ◐ |
| RNT-03 | **Privacidad (Ley 19.628 / 21.719):** los datos del cliente quedan en su navegador y no salen hasta que él envía el pedido; "Borrar mis datos" | ✅ |
| RNT-04 | **Escritura de fotos y fichas:** solo admin, supervisor y bodega, y siempre en su propio local (sale de la sesión) | ✅ |
| RNT-05 | **Rendimiento:** catálogo en caché de 60 s en el servidor; ~1,1–1,6 s por página en desarrollo local; ~132 kB de JavaScript por página. Falta medirlo en Railway | ◐ |
| RNT-06 | **Móvil primero:** sin scroll horizontal a 390 px, botones de 44 px o más, barra de pestañas abajo, foto achicada a 800 px antes de subir | ✅ |
| RNT-07 | **Accesibilidad:** etiquetas y estados para lector de pantalla, la pestaña activa marcada, estados con texto y no solo color. Falta una auditoría formal | ◐ |
| RNT-08 | **Funciona sin JavaScript** para mirar: buscar, filtrar, ordenar por dirección y paginar son enlaces y formularios. El carrito sí requiere JavaScript | ✅ |
| RNT-09 | **Disponibilidad:** la tienda corre en el mismo servicio que el POS. Ventaja: un solo despliegue. Riesgo: mucho tráfico en la tienda puede hacer más lento el mostrador. Revisar si crece | ◐ |
| RNT-10 | **Fotos:** JPG, PNG o WebP, máximo 5 MB, en el bucket público `productos`; solo el servidor escribe | ✅ |
| RNT-11 | **Licencias:** las fotos de Open Food Facts son CC BY-SA; la tienda cita la fuente al pie | ✅ |
| RNT-12 | **Servicios externos:** Open Food Facts permite ~100 consultas por minuto. La herramienta espera 900 ms y reintenta con 429; si no responde, el alta sigue a mano | ✅ |
| RNT-13 | **Formato:** español de Chile, pesos sin decimales, IVA incluido | ✅ |
| RNT-14 | **Errores:** la tienda tiene su página de error y de "no encontrado"; los errores llegan al buzón del sistema (`/api/errores`) | ✅ |
| RNT-15 | **Mantenibilidad:** la lógica vive en `packages/core` con pruebas (tienda 47, ficha por código 6); las pantallas solo la usan | ✅ |

## 4. Cómo está hecho (etapa 1)

| Archivo | Qué hace |
|---|---|
| `packages/core/src/tienda.ts` | Lógica pura: búsqueda, filtro, páginas, ofertas en palabras, enlace de WhatsApp. Pruebas en `packages/core/test/tienda.test.ts` |
| `apps/web/src/lib/tienda/catalogo.ts` | Lee el catálogo en el servidor, con caché de 60 s. En modo demo, los productos de ejemplo |
| `apps/web/src/app/tienda/` | Las pantallas: catálogo, ficha, 404 y error |
| `apps/web/src/middleware.ts` | `rutaTienda`: deja pasar `/tienda` sin sesión y, en el dominio de la tienda, reescribe todo a `/tienda` |

**Por qué se lee con la llave de servicio y no con la pública.** Quien abre la
tienda no tiene sesión. Abrirle a `anon` una tabla o una función se la abre a
cualquiera con la consola del navegador, y `seguridad.test.mjs` exige que
`anon` no ejecute nada. El servidor elige las columnas y el local; al
navegador llega solo lo público. **No necesita migración**: la etapa 1 se puede
publicar sin tocar la base.

**Qué local se muestra.** El de `TIENDA_TENANT_ID`. Sin esa variable, la tienda
dice "todavía no está abierta": la variable es el interruptor.

**La etapa 2 en adelante sí necesita migración** (`pedidos_web`,
`pedido_web_items`, la función que crea el pedido validando precios, y la que lo
pasa a venta). El pedido lo crea un route handler del servidor, no el navegador
directo contra Supabase, por la misma razón de arriba.

---

## 5. Railway y el dominio

No hace falta un servicio nuevo: la tienda es parte del servicio web actual.

### Variables nuevas

| Variable | Ejemplo | Notas |
|---|---|---|
| `TIENDA_TENANT_ID` | `528bc63b-…` | El local cuya tienda se publica. Sin ella, no hay tienda |
| `NEXT_PUBLIC_TIENDA_HOST` | `tutienda.cl` | El dominio de la tienda, sin `https://` ni `www`. Se hornea al compilar: cambiarla exige redesplegar. Sin ella, la tienda igual funciona en `/tienda` del dominio actual |

### Pasos para el dominio

1. Comprar el dominio en NIC Chile (`.cl`, ~$10.000 al año).
2. DNS en **Cloudflare** (plan gratis): en NIC se cambian los servidores DNS
   por los que da Cloudflare. Hace falta porque NIC no permite apuntar el
   dominio "pelado" (`tutienda.cl`, sin `www`) a Railway con un CNAME, y
   Cloudflare sí (CNAME flattening).
3. En Railway → servicio web → Settings → Networking → **Custom Domain**:
   - `tutienda.cl` (la tienda) y `www.tutienda.cl`
   - `sistema.tutienda.cl` (el sistema)
   Para cada uno, Railway muestra un registro **CNAME** (y a veces un TXT de
   verificación) que se copia en Cloudflare con la nube en **gris** ("DNS
   only"), para que Railway emita el certificado HTTPS.
4. Variables: `NEXT_PUBLIC_TIENDA_HOST=tutienda.cl` y
   `NEXT_PUBLIC_APP_URL=https://sistema.tutienda.cl`, y **redesplegar**.
5. Supabase → Authentication → URL Configuration: *Site URL* y *Redirect URLs*
   a `https://sistema.tutienda.cl` (si no, "recuperar clave" e invitaciones
   siguen mandando a la URL `.up.railway.app`). Ver [09 §4.2](09-despliegue.md).
6. La URL `rutaahorroweb-production.up.railway.app` puede quedar: sigue
   sirviendo el sistema, y la tienda en `/tienda`.

---

## 6. Costos para cotizar

### Desarrollo (referencia: $15.000/h, como [12](12-costos-modelo-servicio.md))

| Parte | Horas |
|---|---:|
| Etapa 1 · catálogo | 12–16 (hecha) |
| Etapa 2 · carrito, pedido, "Pedidos web", correos | 20–28 |
| Etapa 3 · pasarela (tarjeta + transferencia), webhook, reservas | 10–16 |
| Dominio, pruebas, puesta en marcha | 6–8 |
| **Sin envíos** | **48–68 h ≈ $720.000–$1.020.000** |
| Etapa 4 · envíos propios por comuna | +12–20 |
| **Con envíos** | **60–88 h ≈ $900.000–$1.320.000** |
| Courier integrado (RT-45) | +15–25 |

### Mensual

| Concepto | Monto |
|---|---|
| Dominio `.cl` | ~$850/mes |
| Railway | sube algo por el tráfico público: estimado 5–10 USD en total |
| Supabase | con tienda pública se recomienda **Pro (25 USD)**: respaldos y nunca se pausa |
| Pasarela | solo comisión por venta, sin costo fijo |

### Comisiones de las pasarelas (verificar antes de cotizar: cambian)

| Pasarela | Tarjeta | Transferencia |
|---|---|---|
| Flow | 2,89 % + IVA (abono al 3er día hábil) | 0,99 % + IVA + $100 |
| Mercado Pago | 2,89–3,19 % + IVA | incluida |
| Webpay Plus directo | ~1,75 % débito / ~2,35 % crédito + IVA, según rubro | no |
| Transferencia manual | — | $0 |

---

## 7. Preguntas abiertas para el cliente

1. ¿Qué pasarela? La cuenta tiene que quedar a su nombre y RUT.
2. ¿Con o sin envíos? Si es con envíos: ¿a qué comunas y a qué precio?
3. ¿Qué dominio?
4. ¿Se publican todos los productos o hay que ocultar algunos (alcohol, cigarrillos)?
5. Dirección y celular de la sucursal: hoy están vacíos, y sin el celular no
   aparece el botón de WhatsApp.
6. Categorías y fotos: hoy el catálogo real no tiene ninguna categoría ni foto.
