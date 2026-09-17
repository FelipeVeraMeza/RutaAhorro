# 22 — Tareas pendientes

**Fecha:** 2026-09-17 · **Fuente:** auditado sobre el código, no sobre los documentos.

Este documento consolida en una sola lista lo que queda por hacer: los hallazgos
abiertos de la [auditoría de pantallas](21-qa-pantallas.md), las fases del
[cronograma](19-cronograma.md) y los huecos que aparecieron al revisar el
escáner y el camino hacia la boleta.

El [cronograma](19-cronograma.md) sigue siendo la fuente autorizada del **orden**
por fases. Esto es la lista operativa: qué tarea, quién la desbloquea, qué pasa
si no se hace.

---

## 0. Dos preguntas que hay que separar

Se mezclan seguido y llevan a conclusiones equivocadas.

### «¿Escanear el código y que diga que es leche?» — **ya funciona**

No necesita QR ni nada nuevo. El camino existe completo:

1. `product_barcodes` guarda uno o varios códigos por producto, con
   `unique (tenant_id, barcode)` para que un código no apunte a dos cosas.
2. El escáner del POS lee el EAN-13 del envase, busca el código y trae el
   producto con su nombre, su precio y su stock.
3. Si el producto no está en el catálogo, lo dice y ofrece crearlo.

Lo único que falta ahí es **T-01**: el producto tiene una columna `description`
en la base y la aplicación no la usa en ninguna parte. Es una tarde de trabajo.

### «¿La boleta con QR para el SII?» — **no, y el formato importa**

La representación impresa de una boleta electrónica **no lleva QR**: lleva el
**timbre electrónico en PDF417**, que es otro formato de código de barras 2D.
Es un requisito del SII, no una preferencia de diseño: un ticket sin timbre
PDF417 válido no es una boleta, es un comprobante interno con otro nombre.

Y el timbre no se puede dibujar: contiene la firma del documento con el
**certificado digital del contribuyente** y consume un folio de un **CAF**
autorizado por el SII. Sin esos dos trámites hechos por el cliente, no hay
boleta válida por mucho código que se escriba. Ver [18](18-documentos-tributarios-sii.md) §2.

**Lo que sí se entrega hoy** es el comprobante interno de venta, con el detalle,
el neto, el IVA desglosado y el total. Ya existe, ya imprime en térmica de 58/80
mm, y dice `NO ES DOCUMENTO TRIBUTARIO` en pantalla y en el papel. Eso último no
es un detalle: un papel que se parece a una boleta y no lo es, es un problema
para el cliente.

---

## 1. Bloqueado en el cliente, no en programar

Estas no avanzan escribiendo código. Cada semana que pasan sin empezar es una
semana que se suma al final del proyecto.

| # | Tarea | Quién | Bloquea a |
|---|---|---|---|
| **B-01** | **Aplicar el esquema en Supabase.** `npm run db:instalar` → pegar `supabase/instalar.sql` | Felipe | **Todo.** Hoy el sistema corre contra IndexedDB |
| **B-02** | Crear el primer administrador: `npm run db:admin -- --correo=… --nombre="…"` | Felipe | Entrar al sistema real |
| **B-03** | Desplegar en Railway con `NEXT_PUBLIC_DEMO=false` y `PORT=8080` | Felipe | Que el cliente vea algo |
| **B-04** | **Certificado digital de firma electrónica** | Cliente | F6 completa. Es la ruta crítica |
| **B-05** | **Enrolamiento como emisor electrónico en sii.cl** | Cliente | F6 completa |
| **B-06** | Elegir proveedor de DTE (P-27) | Felipe + cliente | Todo el diseño de F6 |
| **B-07** | Probar una etiqueta EAN-13 impresa contra el lector real | Felipe | Cerrar RF-M2-13 con evidencia |
| **B-08** | Decidir si el repositorio es público o privado (P-13) | Felipe | Si es público, rotar las llaves de Supabase |

> **Sobre B-04 y B-05:** son trámites con plazos que no controlamos. Conviene
> empezarlos **ahora**, en paralelo al desarrollo de F5, y no cuando el código
> esté listo. Es el error clásico: terminar el módulo y descubrir que faltan
> seis semanas de papeleo.

---

## 2. Defectos abiertos — ordenados por daño

### Cerrados el 2026-09-17

| # | Qué era | Dónde quedó |
|---|---|---|
| **T-01** | `description` del producto sin usar | Campo en el formulario, columna en la plantilla de carga, y se muestra al escanear en el POS |
| **T-02** | La edición de producto no era transaccional: si fallaba la inserción de códigos, el producto quedaba **sin ninguno** y dejaba de aparecer al escanear | `fn_update_product` (0008). Y se encontró que la **carga masiva borraba códigos en el camino normal**, no en el de falla: una planilla de precios sin columna de código dejaba invisible al escáner todo lo que tocara |
| **T-03** | Verificar M4-16 | Verificado: **no existía**. Hoy hay pestaña Lotes en Inventario |
| **T-05** | Anular venta | Pantalla `/ventas`, con historial y búsqueda por folio |
| **T-07** | Dar de baja lote vencido | Junto al lote, en Inventario |
| **T-08** | Cierre forzado de caja | En Caja, arriba, para admin y supervisor |
| **T-44** | Auditar Inicio y Usuarios | Hechas. Las 11 pantallas están auditadas línea por línea |

Y cuatro que no estaban en esta lista porque nadie los había visto: **S-1** a
**S-4** en [21](21-qa-pantallas.md) §0, dos de ellos críticos.

### Abiertos

| # | Tarea | Dónde | Por qué importa |
|---|---|---|---|
| **T-14** | **`unit_price` llega del cliente sin compararlo con el catálogo.** Es lo que queda abierto de S-4: el tope de descuento se puede rodear vendiendo a precio 1 en vez de aplicando un descuento | `fn_register_sale` | Es deliberado que el precio viaje —una venta sin conexión se sincroniza con el precio que tenía al venderse— pero eso abre un camino que el tope no cubre. Cerrarlo bien pide comparar contra `price_history` con la fecha de la venta |
| **T-04** | **Recuperar contraseña (RF-M1-05)** | Login | Hoy el dueño entra al panel de Supabase cada vez que un vendedor olvida su clave |
| **T-06** | **Corregir un movimiento de caja (M-1).** Un egreso de 50.000 en vez de 5.000 no se puede enmendar | Caja | Descuadra el arqueo sin forma de explicarlo |
| **T-09** | Kardex con filtros y paginación. Hoy trae 80 movimientos fijos | Inventario | Con tres meses de operación deja de servir para investigar nada |
| **T-10** | Paginación en Productos y en Proveedores/Recepciones | Productos, Proveedores | Con 1.000 productos se renderizan los 1.000 |
| **T-11** | Desactivar un proveedor (P-1) | Proveedores | Un proveedor con el que se dejó de trabajar sigue en la lista |
| **T-12** | Carga masiva atómica (I-1). Hoy aplica fila por fila | Importar | Una carga interrumpida deja medio catálogo. Ya se avisa en pantalla |
| **T-13** | El título de Proveedores dice "Compras" y la navegación dice "Proveedores" | Proveedores | Confunde al usuario nuevo |
| **T-15** | **Revisar el resto de los datos de demo con la pregunta de U-2:** ¿qué otros campos rellena la maqueta que en producción no escribe nadie? | `lib/demo/data.ts` | `last_seen_at` hacía que RF-M1-14 figurara cumplido y solo funcionaba en demo. No hay razón para pensar que es el único |
| **T-16** | Descuento por línea en el POS (M5-08) | POS | La base ya lo valida desde 0011; la pantalla no lo ofrece |
| **T-17** | Pago mixto (M5-10) | POS | La base acepta varias filas de pago desde el primer día |
| **T-18** | Pantalla de configuración del local (M9-08) | Nueva | La capa de lectura ya existe (`lib/datos/configuracion.ts`); falta poder escribirla sin entrar a Supabase |
| **T-19** | Historial de cambios de precio (M2-09) | Formulario de producto | `trg_price_history` graba desde el primer día y nadie lo muestra |

## 3. Camino a la boleta — en orden

Ninguna de estas se puede saltar. Las de F5 se pueden hacer **sin** los trámites
del cliente; las de F6 no.

### F5 · Simulador — se puede empezar hoy

| # | Tarea | Depende de |
|---|---|---|
| **T-20** | Migración: `dte_documents`, `dte_folios`, `dte_events`. Inmutables por disparador, igual que el kardex | — |
| **T-21** | Datos del emisor: RUT, razón social, giro, dirección, actividad económica | Pantalla de configuración del local |
| **T-22** | Interfaz `EmisorDTE` con dos implementaciones, simulada y real. La misma frontera que ya usa la capa de repositorio | T-20 |
| **T-23** | Emisión simulada: consume folio, arma el XML con la estructura real, firma con certificado de prueba | T-20, T-21, T-22 |
| **T-24** | Máquina de estados: `borrador → emitido → enviado → aceptado / rechazado / anulado` | T-23 |
| **T-25** | Nota de crédito para anular. Un DTE no se borra nunca | T-24 |
| **T-26** | **Representación impresa con timbre PDF417.** El generador de EAN-13 que ya existe no sirve: PDF417 es otro formato | T-23 |
| **T-27** | Marca visible de "documento simulado", en pantalla y en el papel | T-26 |
| **T-28** | Pruebas: el folio se consume aunque falle el envío; `neto + IVA === total` sin descuadre de un peso; no hay dos documentos con el mismo folio bajo concurrencia | T-23, T-24 |

> **Sobre T-26:** vale la pena decidir temprano si el PDF417 se dibuja a mano
> —como se hizo con el EAN-13— o con una biblioteca. PDF417 es bastante más
> complejo: tiene corrección de errores Reed-Solomon y varios modos de
> compactación. Aquí probablemente la biblioteca gana.

### F6 · Real — bloqueado en los trámites

| # | Tarea | Depende de |
|---|---|---|
| **T-30** | Carga de CAF y control de folios disponibles, con aviso antes de agotarse | B-04, B-05 |
| **T-31** | Implementar `EmisorDTE` real contra la API del proveedor | B-06, T-22 |
| **T-32** | Set de pruebas / certificación del SII | Todas las anteriores |
| **T-33** | Reporte de Consumo de Folios | T-30 |

---

## 4. La deuda que no se ve

| # | Tarea | Por qué |
|---|---|---|
| **T-40** | **Ejecutar CP-01 a CP-08** del [plan de pruebas](16-plan-pruebas.md) | **Siete requerimientos de concurrencia están marcados como hechos y descansan en diseño, no en pruebas.** Dos cajeros vendiendo el último producto al mismo tiempo no se ha probado nunca. Es el riesgo más grande del proyecto y el más fácil de seguir postergando |
| **T-41** | Revisar precio y plazo del proyecto | El módulo tributario entró al alcance el 2026-09-15 (P-03) y ni la propuesta comercial ni el plan de trabajo lo contemplaban |
| **T-42** | Decidir el nombre del producto | Las maquetas dicen "SimplePyme", el repositorio dice "RutaAhorro". Lo razonable: SimplePyme el producto, RutaAhorro el primer cliente |
| **T-43** | Avisarle al cliente que se desplegará solo en Railway | Había pedido Vercel + Railway; se decidió lo otro en ADR-008 y todavía no se le dice (P-26) |
| **T-44** | Auditar Inicio y Usuarios línea por línea | Son las dos pantallas que quedaron en revisión parcial |

---

## 5. Orden recomendado

1. **B-01, B-02, B-03** — sin esto nada de lo demás es verificable de verdad.
   Y ahora hay una razón más: las correcciones de seguridad S-1 a S-4 viajan en
   el esquema, así que **la base tiene que instalarse con `instalar.sql` al
   día**. Si alguna vez se aplicó una versión anterior en algún lado, hay que
   reinstalar o aplicar 0009 y 0011 a mano.
2. **B-04, B-05** en paralelo, el mismo día. Son trámites con plazos ajenos.
3. **T-40** — la concurrencia. Subió al tercer lugar porque es lo único grande
   que sigue descansando en diseño y no en pruebas, y porque conviene hacerlo
   antes de que haya datos reales que perder.
4. **T-14** — cerrar lo que queda del tope de descuento.
5. **T-15** — revisar los datos de demo. Es barato y puede destapar otros
   requerimientos que figuran cumplidos y solo funcionan en la maqueta.
6. **T-04, T-06** — lo que falta para cerrar el día a día.
7. **T-16 a T-19** — las cuatro piezas que están en la base y no en la pantalla.
8. **F5 completo** (T-20 a T-28), mientras corren los trámites.
9. **F6** cuando B-04 y B-05 estén listos.
