# 17 — Inventario de alcance (estado real del sistema)

**Fecha del corte:** 2026-09-17 (v1.3)
**Método:** auditoría del código, no estimación. Se enumeraron funciones,
vistas y tablas de `supabase/migrations/`, pantallas de `apps/web/src/app/`,
trabajos de `apps/worker/` y módulos de `packages/core/`.

> ✅ **Tercera pasada, 2026-09-17 (v1.3).** Los estados de M4, M5, M6, M7 y
> M9 se contrastaron contra el código. Diez requerimientos pasaron de 🔵 a ✅
> porque se les construyó la pantalla que les faltaba —los seis reportes, la
> anulación de venta, la baja de lote, el cierre forzado de caja y los lotes en
> Inventario—, y la categoría 🔵 bajó de 16 a 6.
>
> **Y tres filas decían más de lo que el código hacía.** Se corrigieron en su
> propia fila, no se borraron:
>
> - **M4-16** "Stock por lote · visible en pantalla Stock": no estaba visible
>   en ninguna parte.
> - **M1-14** "Ver quién está conectado": no funcionaba en producción. Lo
>   tapaba el modo demo.
> - **M2-11** "Carga masiva desde Excel/CSV": leía CSV y nada más.
>
> Las tres tienen la misma forma, y conviene tenerla presente al leer el resto
> de este documento: **la pieza existía y no estaba conectada con nada.**
>
> ⚠️ **Re-verificación del 2026-09-15 (v1.2).** Las filas de M1, M3 y M4 se
> contrastaron contra el código: varias marcadas 🔵 o ⬜ ya tienen pantalla y
> se corrigieron. **Los contadores por módulo y el resumen ejecutivo NO se
> recalcularon** — quedaron de la versión anterior y hoy subestiman lo hecho.
> La fuente autorizada para planificar es [19 — Cronograma](19-cronograma.md).
> Falta una auditoría completa de los 124 requerimientos.
>
> **Además, el alcance creció:** P-03 se respondió y el sistema debe emitir
> documentos tributarios electrónicos. Ese módulo todavía no está inventariado
> aquí — ver [18](18-documentos-tributarios-sii.md).

> **Para qué sirve este documento.** Los documentos 03 y 04 dicen qué *debe*
> hacer el sistema. Este dice qué *hace hoy*. La diferencia entre ambos es el
> trabajo que queda, y es la única base honesta para comprometer una fecha.

---

## Leyenda de estado

| Símbolo | Significado |
|:--:|---|
| ✅ | **Hecho y verificado.** Funciona y está probado |
| 🔵 | **Hecho en la base de datos, falta la pantalla.** La lógica existe y es correcta; no hay forma de usarla desde la aplicación |
| 🟡 | **Parcial.** Funciona a medias o solo en un camino |
| ⬜ | **No empezado** |

> La categoría 🔵 es la más importante de este inventario. Representa trabajo
> **ya pagado** que hoy no produce ningún valor para el cliente, porque nadie
> puede alcanzarlo. Convertir 🔵 en ✅ es mucho más barato que construir ⬜, y
> es donde está el mayor retorno inmediato.

---

## 1. Resumen ejecutivo

| Capa | Estado | Comentario |
|---|---|---|
| **Base de datos** | ~90 % | 26 tablas, 23 funciones, 11 vistas, RLS completo. Es la capa más madura |
| **Lógica de negocio** (`packages/core`) | ~90 % | 10 módulos, 119 pruebas pasando |
| **Worker / trabajos programados** | ~80 % | 7 trabajos operativos, falta generación de reportes pesados |
| **Aplicación web** | **~35 %** | 8 pantallas de ~19 necesarias. **Sigue siendo el cuello de botella** |
| **Despliegue y operación** | ~10 % | Nada aplicado en Supabase, nada desplegado |

### El número que importa

De los **101 requerimientos funcionales**:

| Estado | Cantidad | % |
|---|:--:|:--:|
| ✅ Hecho y verificado | 37 | 37 % |
| 🔵 En la base, sin pantalla | 29 | 29 % |
| 🟡 Parcial | 10 | 10 % |
| ⬜ No empezado | 25 | 25 % |

> **Actualizado 2026-09-15.** El módulo de productos (M2) pasó de 3 a 9
> requerimientos terminados: alta, edición, baja, categorías, códigos múltiples
> y carga masiva. Se eliminó el bloqueo de R-02 del lado del software.

> **Lectura de jefe de proyecto:** el sistema está al 37 % de entregable y al
> 66 % de construido. Los 29 requerimientos marcados 🔵 son "ponerle pantalla a
> algo que ya funciona", que rinde mucho más rápido que empezar de cero: el
> módulo de productos pasó de 3 a 9 terminados en una sola tanda por eso mismo.

---

## 2. Inventario por módulo

### M1 · Autenticación, usuarios y sesiones — 15 requerimientos

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M1-01 | Inicio de sesión con correo y contraseña | ✅ | — |
| M1-02 | Sesión independiente por trabajador | ✅ | — |
| M1-03 | Crear / editar / desactivar usuarios | ✅ | Desactivar y reactivar; nadie puede desactivarse a sí mismo |
| M1-04 | Asignación de rol | 🔵 | Existe el trigger `handle_new_user`; hoy el rol se pone a mano en Supabase |
| M1-05 | Recuperar contraseña por correo | ⬜ | Pantalla + plantilla de correo en español |
| M1-06 | Sesión persistente entre turnos | ✅ | — |
| M1-07 | Cerrar sesión | ✅ | — |
| M1-08 | Contraseña mínima de 8 caracteres | 🟡 | Depende de la configuración de Supabase Auth, sin fijar |
| M1-09 | Cierre de sesión remoto | ⬜ | — |
| M1-10 | Segundo factor para admin | ⬜ | Prioridad *Could* |
| M1-11 | Bloqueo tras 5 intentos fallidos | 🟡 | Supabase lo hace por defecto; falta verificar el umbral |
| M1-12 | Invitar empleado por correo | ✅ | Route handler + pantalla. Exige `SUPABASE_SECRET_KEY` en el servidor |
| M1-13 | Mismo usuario en varios dispositivos | ✅ | Por diseño de Supabase Auth |
| M1-14 | Ver quién está conectado | ✅ | **Corregido 2026-09-17:** figuraba cumplido y no funcionaba en producción. `last_seen_at` no la escribía nadie; todos aparecían como "Nunca ha entrado". Se veía bien solo en demo, porque los datos de ejemplo traen la hora puesta |
| M1-15 | Registrar inicio/cierre de sesión en bitácora | ⬜ | — |

**Estado del módulo: 5 ✅ · 1 🔵 · 2 🟡 · 7 ⬜**

---

### M2 · Catálogo de productos — 15 requerimientos

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M2-01 | Crear producto | ✅ | Formulario con validación. Incluye la descripción, que hasta el 2026-09-17 existía en la base y no leía ni escribía nadie |
| M2-02 | Varios códigos de barra por producto | ✅ | Se agregan y quitan desde el formulario |
| M2-03 | Un código no puede estar en dos productos | ✅ | `UNIQUE (tenant_id, barcode)` |
| M2-04 | Crear producto escaneando | 🟡 | El formulario tiene escáner; falta el salto desde el POS |
| M2-05 | Buscar por nombre, código o SKU | ✅ | Local en el POS, y en la pantalla Productos |
| M2-06 | Categorías | ✅ | Se eligen y se crean desde el formulario |
| M2-07 | Imagen del producto | ⬜ | Requiere Storage |
| M2-08 | Desactivar producto | ✅ | Con reactivación y borrado definitivo si no tiene historial |
| M2-09 | Historial de cambios de precio | 🔵 | Trigger `trg_price_history` funcionando; sin pantalla |
| M2-10 | Margen visible solo a admin | ✅ | Verificado: el vendedor no lo recibe |
| M2-11 | Carga masiva desde Excel/CSV | ✅ | **Decía Excel y solo leía CSV.** Desde 2026-09-17 lee `.xlsx` de verdad, sin convertir |
| M2-12 | Validar el archivo antes de aplicar | ✅ | Todo o nada, con 31 pruebas |
| M2-13 | Generar etiquetas con código de barras | ✅ | Pantalla /productos/etiquetas: EAN-13 en SVG, tres tamaños, con precio, y asignación de código interno a productos sin código de fábrica |
| M2-14 | Productos por peso o fracción | 🟡 | La base soporta decimales; el POS no pide cantidad fraccionada |
| M2-15 | Duplicar producto | ⬜ | — |

**Estado del módulo: 9 ✅ · 0 🔵 · 3 🟡 · 3 ⬜** *(actualizado 2026-09-15)*

---

### M3 · Proveedores y recepción — 11 requerimientos

> **Módulo sin ninguna pantalla.** Toda la lógica existe y está probada; no hay
> forma de usarla. Es el bloque con mayor desbalance del proyecto.

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M3-01 | Registrar proveedores | ✅ | Pantalla con alta y edición |
| M3-02 | Validar RUT chileno | ✅ | `isValidRut()` probado, incluido dígito K |
| M3-03 | Asociar proveedores a productos | ✅ | Desde la recepción |
| M3-04 | Registrar recepción de mercadería | ✅ | Pantalla invocando `fn_confirm_receipt` |
| M3-05 | La recepción sube el stock | ✅ | — |
| M3-06 | Recalcular costo promedio ponderado | ✅ | Probado, incluidos stock cero y negativo |
| M3-07 | Cargar recepción escaneando | ⬜ | El lector existe, falta la pantalla |
| M3-08 | Advertir variación de costo | ✅ | Aviso en la pantalla de recepción |
| M3-09 | Anular recepción | ✅ | `fn_void_receipt` invocada desde la app |
| M3-10 | Historial de compras por proveedor | ⬜ | — |
| M3-11 | Orden de compra sugerida | ⬜ | Prioridad *Could* |

**Estado del módulo: 2 ✅ · 6 🔵 · 0 🟡 · 3 ⬜**

---

### M4 · Inventario y stock — 20 requerimientos

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M4-01 | Stock en tiempo real | ✅ | — |
| M4-02 | Todo cambio genera kardex | ✅ | `fn_post_movement` |
| M4-03 | 9 tipos de movimiento | ✅ | — |
| M4-04 | Ajustar stock con motivo | ✅ | Pantalla Inventario |
| M4-05 | Toma de inventario | ✅ | Pantalla Inventario, pestaña Toma |
| M4-06 | Toma parcial por categoría | 🟡 | Se puede contar un subconjunto; **no hay filtro por categoría** |
| M4-07 | Stock mínimo y marca visual | ✅ | Visible en Productos e Inicio |
| M4-08 | Inventario valorizado | ✅ | Pantalla Stock |
| M4-09 | Advertir venta sin stock | ✅ | Probado |
| M4-10 | Merma como ajuste diferenciado | 🔵 | — |
| M4-11 | Kardex inmutable | ✅ | Trigger que rechaza UPDATE/DELETE |
| M4-12 | Consultar kardex con filtros | 🟡 | Hay pantalla, pero **sin filtros**: 80 movimientos fijos, sin filtrar por producto, fecha ni tipo |
| M4-13 | Stock por ubicación | ⬜ | Prioridad *Could* |
| M4-14 | Marcar producto como perecible | ✅ | Desde el formulario de producto |
| M4-15 | Exigir vencimiento al recepcionar | ✅ | Validado en base y pedido en la pantalla |
| M4-16 | Stock por lote | ✅ | **Corregido 2026-09-17:** figuraba como visible en Stock y no lo estaba. La base sí lo mantenía; ninguna pantalla leía `v_stock_by_lot` ni `v_expiring_lots`. Hoy hay pestaña Lotes |
| M4-17 | Consumo FEFO automático | ✅ | Probado: no descuenta dos veces del mismo lote |
| M4-18 | Alertas de vencimiento | ✅ | Vista + trabajo del worker + pantalla |
| M4-19 | Dar de baja lote vencido | ✅ | Junto al lote, en Inventario |
| M4-20 | Anular venta devuelve al lote exacto | ✅ | `sale_item_lots` |

**Estado del módulo: 10 ✅ · 9 🔵 · 0 🟡 · 1 ⬜**

---

### M5 · Punto de venta — 22 requerimientos

> El módulo más avanzado. Es también el más crítico.

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M5-01 | Agregar escaneando con la cámara | ✅ | Verificado con código real |
| M5-02 | Escaneo continuo | ✅ | Antirrebote de 1.200 ms |
| M5-03 | Sonido y vibración al leer | ✅ | — |
| M5-04 | Ofrecer crear producto si no existe | 🟡 | Avisa y pone el código en la búsqueda; no abre el formulario |
| M5-05 | Buscar por nombre | ✅ | — |
| M5-06 | Modificar cantidad y eliminar líneas | ✅ | — |
| M5-07 | Total en tiempo real sin decimales | ✅ | — |
| M5-08 | Descuento por línea o total | 🔵 | La base ya lo valida (0011); falta el control en el POS. T-16 |
| M5-09 | Medio de pago | ✅ | Los 4 medios |
| M5-10 | Pago mixto | 🔵 | La base acepta varias filas de pago; la pantalla no |
| M5-11 | Cálculo de vuelto | ✅ | Con montos sugeridos |
| M5-12 | Venta atómica | ✅ | `fn_register_sale` |
| M5-13 | Folio correlativo | ✅ | Sin saltos bajo concurrencia |
| M5-14 | Comprobante compartible | ⬜ | — |
| M5-15 | Anular venta | ✅ | Pantalla `/ventas`, con historial y búsqueda por folio |
| M5-16 | Impedir vender sin caja abierta | ✅ | — |
| M5-17 | Vender sin conexión | ✅ | Cola en IndexedDB |
| M5-18 | Sincronizar al reconectar, sin duplicar | ✅ | Idempotencia por `client_uuid` |
| M5-19 | Indicador de conexión y pendientes | ✅ | — |
| M5-20 | Dejar venta en espera | ⬜ | — |
| M5-21 | Operable con una sola mano | 🟡 | Diseñado así; **falta probar en celular real** |
| M5-22 | Producto genérico con monto libre | ⬜ | Prioridad *Could* |

**Estado del módulo: 14 ✅ · 3 🔵 · 2 🟡 · 3 ⬜**

---

### M6 · Control de caja — 12 requerimientos

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M6-01 | Apertura con monto inicial | ✅ | — |
| M6-02 | Caja propia por usuario | ✅ | — |
| M6-03 | Ingresos y egresos con motivo | ✅ | — |
| M6-04 | Cálculo del efectivo esperado | ✅ | Probado |
| M6-05 | Cierre con conteo físico | ✅ | — |
| M6-06 | Exigir comentario si hay diferencia | ✅ | — |
| M6-07 | Resumen del cierre | ✅ | — |
| M6-08 | Caja cerrada inmutable | ✅ | Trigger |
| M6-09 | Una sola caja abierta por usuario | ✅ | Índice único parcial |
| M6-10 | Cierre forzado por admin | ✅ | En Caja, para admin y supervisor |
| M6-11 | Alerta de caja abierta demasiado tiempo | 🟡 | `isSessionStale()` probado; worker avisa; sin aviso en pantalla |
| M6-12 | Historial de cierres | ✅ | — |

**Estado del módulo: 10 ✅ · 1 🔵 · 1 🟡 · 0 ⬜**

---

### M7 · Reportes — 12 requerimientos

> **Las 11 vistas de reporte existen en la base. No hay ninguna pantalla de
> reportes.** Es el segundo mayor desbalance del proyecto.

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M7-01 | Dashboard del día | ✅ | Pantalla Inicio |
| M7-02 | Ventas por período | ✅ | `/reportes`, con rango de fechas |
| M7-03 | Ventas por usuario | ✅ | `/reportes` |
| M7-04 | Ventas por producto y categoría | ✅ | `/reportes`, ordenable por monto o unidades |
| M7-05 | Inventario valorizado | ✅ | Stock mostraba solo el total; el detalle por producto está en `/reportes` |
| M7-06 | Margen y utilidad | ✅ | `/reportes`, solo para admin |
| M7-07 | Productos sin movimiento | ✅ | `/reportes`, con umbral de días |
| M7-08 | Mermas y ajustes | ✅ | `/reportes`, con motivo y responsable |
| M7-09 | Exportar a Excel/CSV | ✅ | En los seis reportes |
| M7-10 | Gráfico de los últimos 30 días | ⬜ | — |
| M7-11 | Comparación con período anterior | ⬜ | Prioridad *Could* |
| M7-12 | Reportes respetan permisos | ✅ | Por RLS, y el costo no se pide siquiera cuando el rol no puede verlo |

**Estado del módulo: 3 ✅ · 6 🔵 · 0 🟡 · 3 ⬜**

---

### M8 · Alertas — 6 requerimientos

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M8-01 | Alerta de stock bajo mínimo | ✅ | Trigger + worker + pantalla Inicio |
| M8-02 | Resumen diario por correo | 🟡 | Implementado; **falta configurar el proveedor de correo** |
| M8-03 | Avisar caja sin cerrar | 🟡 | Igual que el anterior |
| M8-04 | Alerta por diferencia de arqueo | ⬜ | — |
| M8-05 | Configurar destinatario y tipos | ⬜ | Sin pantalla de configuración |
| M8-06 | Notificaciones push | ⬜ | Prioridad *Could* |

**Además, sin requerimiento asignado:** la tabla `alerts` se llena pero **no
hay pantalla que la muestre**. Las alertas de vencimiento y stock existen en la
base y solo se ven parcialmente en Inicio.

**Estado del módulo: 1 ✅ · 0 🔵 · 2 🟡 · 3 ⬜**

---

### M9 · Administración, respaldo y auditoría — 10 requerimientos

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M9-01 | Respaldo automático diario | 🟡 | Implementado; **nunca ejecutado en producción** |
| M9-02 | Retención de 30 días | 🟡 | Implementado, sin verificar |
| M9-03 | Descargar respaldo | ⬜ | Sin pantalla |
| M9-04 | Restauración probada | ⬜ | **Pendiente. Un respaldo sin restaurar es una suposición** |
| M9-05 | Bitácora de auditoría | ✅ | Triggers escribiendo |
| M9-06 | Detalle de cada registro | ✅ | — |
| M9-07 | Bitácora inmutable | ✅ | Trigger que rechaza UPDATE/DELETE |
| M9-08 | Configuración del local | 🟡 | La aplicación ya **lee** `tenants.settings` (IVA, umbral de costo, tope de descuento). Falta la pantalla para escribirlo. T-18 |
| M9-09 | Versión y changelog visibles | ⬜ | — |
| M9-10 | Actualizaciones sin intervención | ✅ | Por diseño de Railway: cada push a main despliega |

**Estado del módulo: 4 ✅ · 1 🔵 · 2 🟡 · 3 ⬜**

---

### M10 · Trabajo simultáneo — 11 requerimientos

| RF | Ítem | Estado | Falta |
|---|---|:--:|---|
| M10-01 | Varios usuarios vendiendo a la vez | ✅ | Probado: CP-02, 50 ventas desde 5 cajas (`db:test`) |
| M10-02 | Descuento de stock atómico | ✅ | Probado: CP-01. Ajustes, anulaciones y bajas **no lo eran** hasta 0012 |
| M10-03 | Aviso al editar en simultáneo | ⬜ | **Hueco conocido.** Hoy el segundo sobrescribe sin avisar |
| M10-04 | Folio sin saltos ni repetidos | ✅ | Probado: CP-02, con ventas fallidas intercaladas |
| M10-05 | Advertir cierre de caja ajena | 🟡 | La base ya no pierde la venta en curso (CP-07, 0012). Falta la advertencia en pantalla |
| M10-06 | Stock actualizado en otras pantallas | ⬜ | Requiere Realtime |
| M10-07 | Vendedor ve solo sus ventas | ✅ | Probado: CP-09 |
| M10-08 | Toma de inventario no se aplica dos veces | ✅ | **Figuraba hecho y no lo estaba**: se aplicaba dos veces. Corregido en 0012, probado: CP-05 |
| M10-09 | Sincronización sin duplicar | ✅ | Probado: CP-03. Un reintento con el primer envío en curso devolvía error hasta 0012 |
| M10-10 | FEFO sin doble descuento | ✅ | Probado: CP-04 |
| M10-11 | Ver quién modificó por última vez | ⬜ | Prioridad *Could* |

**Estado del módulo: 7 ✅ · 0 🔵 · 0 🟡 · 4 ⬜**

> ⚠️ Los 7 ✅ de este módulo están implementados pero **no probados bajo
> concurrencia real**. Los casos CP-01 a CP-08 del [plan de pruebas](16-plan-pruebas.md)
> siguen pendientes. Hasta ejecutarlos, son "correctos por diseño", no
> "verificados".

---

## 3. Inventario de pantallas

| Pantalla | Estado | Para quién |
|---|:--:|---|
| Acceso (login) | ✅ | Todos |
| Inicio / resumen | 🟡 Básico, sin acciones rápidas ni comparación | admin, supervisor |
| Punto de venta | ✅ | admin, supervisor, vendedor |
| Caja | ✅ | admin, supervisor, vendedor |
| Productos (lista) | 🟡 Solo lectura | todos |
| Inventario / stock | 🟡 Solo lectura | admin, supervisor, bodega |
| Alta/edición de producto | ✅ | admin, supervisor, bodega |
| Carga masiva de productos | ✅ | admin, supervisor, bodega |
| **Kardex de producto** | ⬜ | admin, supervisor, bodega |
| **Ajuste de stock** | ⬜ | admin, supervisor, bodega |
| **Toma de inventario** | ⬜ | admin, supervisor, bodega |
| **Proveedores** | ⬜ | admin |
| **Recepción de mercadería** | ⬜ | admin, supervisor, bodega |
| **Historial de ventas / anular** | ⬜ | admin, supervisor |
| **Reportes** | ⬜ | admin, supervisor |
| **Alertas** | ⬜ | admin, supervisor |
| **Usuarios** | ⬜ | admin |
| **Configuración** | ⬜ | admin |
| **Recuperar contraseña** | ⬜ | todos |

**8 de 19 pantallas construidas.** De las 12 que faltan, **8 solo necesitan
interfaz**: la lógica ya existe y está probada.

---

## 4. Inventario operacional (no es software)

Trabajo real que no aparece en ningún requerimiento y que **nadie ha hecho**:

| # | Ítem | Estado | Responsable | Bloquea a |
|---|---|:--:|---|---|
| OP-1 | Aplicar el esquema en Supabase | ⬜ | Felipe | Todo |
| OP-2 | Crear el usuario administrador | ⬜ | Felipe | Todo |
| OP-3 | Desplegar el worker en Railway | ⬜ | Felipe | Respaldos, alertas |
| OP-4 | Desplegar la web en Railway | ⬜ | Felipe | Uso real |
| OP-5 | Configurar proveedor de correo | ⬜ | Felipe | M8-02, M8-03 |
| OP-6 | Configurar URLs de redirección | ⬜ | Felipe | Recuperar contraseña |
| OP-7 | Probar restauración de respaldo | ⬜ | Felipe | Criterio de aceptación 5 |
| OP-8 | Pruebas de concurrencia CP-01 a CP-08 | ⬜ | Felipe | Cierre de F3 |
| OP-9 | Pruebas en celulares reales | ⬜ | Felipe | Cierre de F5 |
| OP-10 | **Carga inicial del catálogo real** | ⬜ | **Cliente** | Puesta en marcha |
| OP-11 | Capacitación del personal | ⬜ | Felipe | Cierre de F5 |
| OP-12 | Manual de usuario | ⬜ | Felipe | Entrega |
| OP-13 | Responder preguntas bloqueantes | ⬜ | **Cliente** | **F1 completa** |
| OP-14 | Decidir nombre de producto vs. cliente | ⬜ | Felipe + cliente | Logo, correos, dominio |
| OP-15 | Aclarar alcance de "control contable" | ⬜ | **Cliente** | Riesgo R-01 |

> **OP-13 y OP-15 llevan abiertos desde el inicio.** Son de decisión del cliente
> y no avanzan solos. OP-10 es el que más horas consume y tampoco depende de
> nosotros.

---

## 5. Dependencias que ordenan el trabajo

```
OP-1 Aplicar esquema
  └── OP-2 Usuario admin
        ├── OP-4 Desplegar web ──── Todo el uso real
        └── OP-3 Desplegar worker ── Respaldos y alertas
                                        └── OP-5 Correo ── M8-02, M8-03

Alta de producto (M2-01)
  ├── Carga masiva (M2-11) ── OP-10 Carga del catálogo ── Puesta en marcha
  ├── Recepción (M3-04) ──── Kardex con datos reales
  └── Ajustes (M4-04) ────── Toma de inventario (M4-05)

Invitar empleados (M1-12)
  └── Varios usuarios ──── Pruebas de concurrencia (OP-8)
```

**Camino crítico hacia un sistema utilizable por el cliente:**

```
OP-1 → OP-2 → M1-12 (invitar) → M2-01 (alta producto)
     → M2-11 (carga masiva) → OP-10 (catálogo real) → OP-4 (desplegar)
```

Todo lo demás —reportes, alertas, configuración— puede llegar después sin
impedir que el local empiece a operar.

---

## 6. Lo que este inventario deja en evidencia

1. **El frontend es el cuello de botella, no el backend.** 34 requerimientos
   están construidos y esperando una pantalla. Priorizar pantallas sobre lógica
   nueva es lo que más rápido convierte trabajo en valor.

2. **Faltan dos módulos completos de interfaz**: proveedores/recepción (M3) y
   reportes (M7). Ambos tienen la base lista.

3. **Nada está desplegado.** El sistema no existe para el cliente todavía. OP-1
   a OP-4 son media jornada y cambian eso.

4. **La concurrencia está implementada pero no verificada.** Siete requerimientos
   marcados ✅ en M10 descansan en diseño, no en pruebas. Es el riesgo silencioso
   más grande del proyecto.

5. **Tres ítems dependen del cliente y llevan abiertos desde el inicio**:
   responder las preguntas bloqueantes, aclarar "control contable" y cargar el
   catálogo. Ninguno avanza por trabajar más horas de desarrollo.

---

## Control de cambios

| Versión | Fecha | Autor | Cambio |
|---|---|---|---|
| 1.0 | 2026-09-14 | Felipe Vera | Inventario inicial por auditoría de código |
| 1.1 | 2026-09-15 | Felipe Vera | Módulo de productos terminado: alta, edición, baja y carga masiva. M2 de 3 a 9 ✅ |
| 1.2 | 2026-09-15 | QA | Re-verificación contra el código de M1, M3 y M4: 14 filas corregidas (usuarios, proveedores, recepción, ajustes, kardex y toma ya tienen pantalla). M4-06 baja a 🟡: no existe filtro por categoría. Contadores por módulo pendientes de recalcular |
| 1.3 | 2026-09-15 | QA | Auditoría de pantallas. M4-12 baja de ✅ a 🟡: la pantalla de kardex existe pero no tiene los filtros que pide el requerimiento; la marca ✅ de la v1.2 fue generosa. Ver informe en 21 |
