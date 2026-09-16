# 21 — Auditoría de pantallas (QA)

**Primera pasada:** 2026-09-15 · **Segunda pasada:** 2026-09-16
**Método:** lectura del código de cada pantalla, contrastada contra
[17](17-inventario-alcance.md) y [03](03-requerimientos-funcionales.md).

## Alcance

| Pantalla | Revisión |
|---|---|
| Caja | Completa |
| Productos (listado) | Completa |
| Inventario | Completa |
| Recepción de mercadería | Completa |
| Vender (POS) | Completa |
| **Proveedores** | **Completa** · 2026-09-16 |
| **Importar** | **Completa** · 2026-09-16 |
| **Formulario de producto** | **Completa** · 2026-09-16 |
| **Ingreso (login)** | **Completa** · 2026-09-16 |
| Inicio | Parcial |
| Usuarios | Parcial |

Con la segunda pasada, **las 11 pantallas de la aplicación están auditadas**,
nueve de ellas línea por línea. Quedan parciales Inicio y Usuarios.

---

## 1. Hallazgos transversales

Antes de las pantallas, dos problemas que aparecieron en casi todas y que se
arreglaron una sola vez, en componentes compartidos.

### X-1 · Ningún diálogo era accesible — **media** · ✅ corregido

La aplicación tenía **nueve diálogos escritos a mano**, cada uno con su propio
`<div role="dialog">`. Los nueve compartían los mismos defectos:

| Defecto | Consecuencia |
|---|---|
| No cerraban con Escape | En el mostrador se opera con prisa; un diálogo que solo se cierra apuntando a "Cancelar" se queda abierto |
| No atrapaban el foco | Tabular desde el diálogo llevaba a los botones de la pantalla de atrás —visibles, porque el fondo es semitransparente— y se podía disparar una acción sin verla |
| No devolvían el foco | Quien navega con teclado quedaba al principio de la página cada vez que cerraba algo |
| Siete de nueve, sin nombre accesible | Un lector de pantalla anunciaba "diálogo" y nada más |
| El fondo se desplazaba | En el celular, arrastrar movía la página de atrás y el diálogo quedaba flotando sobre otra cosa |

**Corregido** con `apps/web/src/components/Modal.tsx`, que resuelve los cinco y
exige el título como propiedad obligatoria. Los nueve diálogos lo usan.

Incorpora `bloqueado`: mientras una operación ya salió hacia la base —confirmar
una recepción, cerrar una caja— el diálogo no se cierra ni con Escape ni tocando
el fondo. Cancelar a medias no cancela nada en el servidor: solo le esconde el
resultado al usuario.

### X-2 · Trece etiquetas que no eran etiquetas — **media** · ✅ corregido

Había trece `<label>` dibujados encima de su campo pero **sin `htmlFor`**: se
ven como etiquetas y no lo son. Consecuencias:

- El lector de pantalla anuncia "cuadro de texto, en blanco". El usuario no sabe
  si está escribiendo el precio o el costo.
- Tocar la etiqueta no enfoca el campo. En un celular, esa es la mitad del área
  útil del campo.

El caso más engañoso estaba en el formulario de producto: tenía un componente
`Campo` propio que *parecía* resolverlo y dibujaba la etiqueta y el control como
hermanos, sin enlazarlos.

**Corregido** con `apps/web/src/components/Campo.tsx`, que genera el `id` con
`useId` y se lo entrega al control, así que el enlace no depende de que alguien
se acuerde de escribirlo. Además conecta el mensaje de error por
`aria-describedby` y marca `aria-invalid`: el error se anuncia al llegar al
campo, no solo al intentar guardar.

---

## 2. Proveedores

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| P-1 | **No se puede desactivar un proveedor.** El modelo de datos lo soporta; la pantalla no ofrece la acción | Media | ⬜ Pendiente |
| P-2 | Anular una recepción no tenía candado contra el doble toque. Anular devuelve stock: dos toques en un celular lento mandaban dos anulaciones | Media | ✅ |
| P-3 | Los cinco campos del formulario de proveedor solo tenían `placeholder` | Baja | ✅ |
| P-4 | El correo no se validaba de ninguna forma | Baja | ✅ |
| P-5 | Sin buscador ni paginación, ni en proveedores ni en recepciones. Mismo caso que M-5 | Media | ⬜ Pendiente |
| P-6 | El título de la pantalla dice "Compras" y la navegación dice "Proveedores" | Baja | ⬜ Pendiente |

**Sobre P-1:** el documento del cliente afirmaba que se podía desactivar un
proveedor. No es cierto y ya se corrigió el documento (commit `f1930b1`). Esa
frase estaba escrita mirando el modelo de datos, no la interfaz — el mismo error
que produjo el hallazgo 1.1 de la primera pasada.

---

## 3. Importar (carga masiva)

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| I-1 | **El contrato mentía.** `importarLote` estaba documentada como "Carga masiva. Todo o nada" y ninguna de las dos implementaciones es atómica: aplica fila por fila. Si la fila 300 falla, las 299 anteriores ya están en el catálogo | Alta | ✅ |
| I-2 | Los errores por fila mostraban el mensaje técnico crudo. El almacenero que sube su planilla leía *"duplicate key value violates unique constraint product_barcodes_tenant_id_barcode_key"* | Media | ✅ |
| I-3 | Sin tope de tamaño de archivo. `file.text()` carga todo en memoria y el parseo corre en el hilo principal: un archivo grande congela el celular sin ningún mensaje | Media | ✅ |
| I-4 | Sin ningún avance durante la carga. 600 productos por 4G son minutos de pantalla quieta; el usuario cierra creyendo que se colgó, y lo que ya entró queda entrado | Media | ✅ |
| I-5 | `URL.revokeObjectURL` se llamaba en la misma vuelta que el clic. Es una carrera: en Safari de iPhone la descarga de la plantilla se cancela antes de empezar | Baja | ✅ |
| I-6 | La plantilla CSV salía sin BOM: Excel la abría en ANSI y los acentos de "Categoría" salían rotos | Baja | ✅ |

**Sobre I-1:** el comentario ahora dice lo que el código hace, la pantalla avisa
que *"los productos ya cargados se quedan cargados"*, y hay una barra de avance.
Hacer la carga atómica de verdad pide una función transaccional en la base, como
`fn_create_product`. Queda anotado en el cronograma, no resuelto.

---

## 4. Formulario de producto

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| F-1 | `parseCLP` se usaba para leer **cantidades**, y borra todo lo que no sea dígito: un stock mínimo de "1,5" kg se guardaba como 15 | Alta | ✅ |
| F-2 | Al editar con el campo costo en blanco se enviaba 0, y `actualizar` lo escribe tal cual. Cambiar el nombre de un producto le dejaba el costo promedio en cero, y con él el margen y el inventario valorizado | Alta | ✅ |
| F-3 | **`actualizar` no es atómica.** Borra todos los códigos de barra y los reinserta. Si la inserción falla —porque otro producto tomó ese código— el producto queda **sin ningún código**, que es justo el que no aparecerá al escanear. Es A-4 en la edición, y `fn_create_product` no lo cubre | Alta | ⬜ Pendiente |
| F-4 | Las etiquetas del formulario no estaban asociadas a sus campos (ver X-2) | Media | ✅ |
| F-5 | Los campos de cantidad usaban `inputMode="numeric"`, que en el teclado del celular no ofrece coma decimal — el mismo producto no se podía escribir a mano | Baja | ✅ |

**Sobre F-3:** es el hallazgo abierto más grave de esta pasada. El modo de falla
es idéntico al de A-4 y deja al producto invisible al escáner, que es la forma
principal de venderlo. Corresponde una `fn_update_product` transaccional.

---

## 5. Ingreso (login)

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| L-1 | **Redirección abierta.** El parámetro `next` viajaba sin filtrar desde la URL al router. Un enlace con `?next=https://sitio-falso.cl` sacaba al usuario del sitio justo después de autenticarse de verdad, que es cuando menos sospecha | Alta | ✅ |
| L-2 | El primer filtro seguía dejando pasar tres variantes: la barra invertida (`/\sitio.cl`), que el navegador normaliza a barra; y el tabulador o el salto de línea entre las dos barras, que desaparecen al normalizar la URL | Alta | ✅ |
| L-3 | El texto prometía que el administrador podía restablecer la contraseña. No puede: RF-M1-05 no existe, no hay pantalla, y reinvitar a alguien con cuenta falla en Supabase Auth | Media | ✅ |
| L-4 | El botón Ver/Ocultar contraseña no tenía nombre accesible ni estado | Baja | ✅ |
| L-5 | **RF-M1-05 (recuperar contraseña) no existe.** Hoy un vendedor que olvida su clave depende de que el dueño la resetee a mano en el panel de Supabase | Media | ⬜ Pendiente |

**Sobre L-1 y L-2:** la función vive ahora en `packages/core/src/destino.ts` con
**17 pruebas**, y no en la pantalla. Un arreglo de seguridad sin prueba es un
arreglo que vuelve en el próximo refactor.

---

## 6. Hallazgos nuevos en pantallas ya auditadas

Aparecieron revisando otra cosa. Se anotan igual.

| # | Pantalla | Hallazgo | Severidad | Estado |
|---|---|---|---|---|
| R-1 | Recepción | **La cantidad se guardaba como número y `Number("1,")` es `NaN`.** Escribir una cantidad con coma decimal —lo normal en Chile— hacía saltar el campo a 0 en mitad del tecleo: no había forma de recibir media unidad | Alta | ✅ |
| R-2 | Recepción | M-6 de la primera pasada: se podía confirmar con costo unitario 0 sin ningún aviso | Media | ✅ |
| R-3 | Recepción | Las cuatro etiquetas por línea se repetían idénticas en cada fila. Tabulando por veinte productos, "Cantidad" veinte veces no dice dónde está uno parado | Baja | ✅ |
| Q-1 | Productos | B-4 era peor de lo anotado: `puedeBorrarDef` conservaba el valor del producto **anterior**, así que el diálogo ofrecía "Eliminar definitivamente" para un producto que sí tenía ventas. La base lo rechazaba, pero la pantalla ya había mentido | Media | ✅ |
| Q-2 | Productos | Ninguna acción del diálogo tenía candado contra el doble toque | Baja | ✅ |
| U-1 | Usuarios | El grupo de radios del rol usaba un `<span>` en vez de `fieldset`/`legend`: el lector leía las cuatro opciones sueltas, sin decir de qué eran | Baja | ✅ |

---

## 7. Estado de los hallazgos de la primera pasada

| # | Hallazgo | Estado |
|---|---|---|
| A-1 | La toma no pedía confirmación | ✅ Diálogo de revisión previa |
| A-2 | La toma aplicaba conteos de productos ocultos por el filtro | ✅ La revisión los lista todos |
| A-3 | `parseCLP` aceptaba negativos en campos de dinero | ✅ `validarMonto` |
| A-4 | El alta de producto no era atómica | ✅ `fn_create_product` (migración 0007) |
| M-1 | No se puede corregir un movimiento de caja mal ingresado | ⬜ Pendiente · ahora **se advierte antes** de registrar |
| M-2 | "Cerrar caja" no advertía que el cierre es irreversible | ✅ Aviso explícito en la pantalla de cierre |
| M-3 | El ajuste aceptaba cantidades negativas | ✅ `validarCantidad` |
| M-4 | El kardex trae 80 movimientos fijos, sin filtros ni paginación | ⬜ Pendiente |
| M-5 | Productos sin paginación | ⬜ Pendiente · depende de P-02 |
| M-6 | Recepción con costo 0 sin aviso | ✅ (ver R-2) |
| M-7 | M4-16 (stock por lote) figura ✅ y el listado no muestra lotes | ⬜ **Sin verificar** |
| B-1 | "Reactivar" usaba el color de alerta | ✅ |
| B-2 | Los campos de movimiento de caja sin `<label>` | ✅ |
| B-3 | El diálogo de ajuste sin nombre accesible | ✅ (ver X-1) |
| B-4 | Sin estado de carga al abrir la confirmación de baja | ✅ (ver Q-1) |

---

## 8. Funciones de base sin pantalla

Sin cambios desde la primera pasada.

| Función | Requerimiento | Estado |
|---|---|---|
| `fn_void_sale` | M5-15 · Anular venta | Probada, **no la invoca ninguna pantalla** |
| `fn_write_off_lot` | M4-19 · Dar de baja lote vencido | Probada, sin pantalla |
| Cierre forzado de caja | M6-10 | Sin pantalla |

---

## 9. Lo que quedó bien

No todo son hallazgos. Estas decisiones resistieron las dos revisiones:

- **El enlace producto ↔ código de barra está correcto en la base:** FK con
  borrado en cascada, `unique (tenant_id, barcode)` haciendo cumplir RF-M2-03,
  índice por producto y RLS activa.
- **Importar valida antes de tocar nada.** El paso de revisión muestra el error
  con su número de fila y su columna, y no carga ni un producto si hay errores.
  La validación de dígito EAN y la detección de repetidos dentro del archivo
  funcionan.
- **Recepción** exige la fecha de vencimiento en perecibles y bloquea la
  confirmación mientras falte, con el conteo de cuántos faltan a la vista.
- **Productos** distingue desactivar de eliminar, y solo ofrece eliminar cuando
  el producto no tiene historial.
- **El login no revela si un correo existe.** El mensaje es el mismo para
  usuario inexistente y contraseña equivocada: sin eso se pueden enumerar los
  usuarios del sistema.
- **Inventario** explica en pantalla por qué el kardex no se edita.
- **Caja** exige comentario cuando hay diferencia y no deja cerrar sin él.
- Los estados de stock usan color **y** texto, no solo color (RNF-46).

---

## 10. Cómo seguir

Por severidad, no por pantalla:

1. **F-3 — `fn_update_product` transaccional.** Es el A-4 de la edición y deja
   productos invisibles al escáner. Lo más grave abierto.
2. **M-7 — verificar si M4-16 (stock por lote) existe de verdad.** Está marcado
   como hecho en el inventario de alcance y el código no lo respalda. Si no
   existe, es un requerimiento mal cerrado, que es exactamente lo que ya pasó
   con RF-M3-08 en la primera pasada.
3. **L-5 — recuperar contraseña (RF-M1-05).** Hoy el dueño tiene que entrar al
   panel de Supabase cada vez que un vendedor olvida su clave.
4. **M-1 — corregir un movimiento de caja.** Con el resto del módulo de caja.
5. **P-1, P-5, P-6, M-4, M-5** — pantalla por pantalla, sin urgencia.
6. **La carga masiva atómica** (I-1), si el cliente llega con una planilla
   grande.

Y lo que no es de pantallas pero pesa más que todo lo anterior:
**los casos CP-01 a CP-08 de concurrencia siguen sin ejecutarse**
([16](16-plan-pruebas.md)). Siete requerimientos marcados como hechos descansan
en diseño, no en pruebas.
