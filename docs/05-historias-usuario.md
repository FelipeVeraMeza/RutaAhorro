# 05 — Historias de usuario y backlog

Formato: `Como <rol>, quiero <acción>, para <beneficio>`.
Los criterios de aceptación están en Gherkin (`Dado / Cuando / Entonces`) para que
sean directamente traducibles a pruebas automatizadas.

**Estimación:** puntos de historia (Fibonacci). Referencia: 1 punto ≈ media jornada.

---

## Épica E1 — Puedo entrar al sistema y cada quien responde por lo suyo

### US-01 · Iniciar sesión — `3 pts` — *Must*
> Como **trabajador**, quiero iniciar sesión con mi correo y contraseña, para que
> mis ventas queden registradas a mi nombre.

```gherkin
Escenario: Ingreso exitoso
  Dado que soy un usuario activo del local
  Cuando ingreso mi correo y contraseña correctos
  Entonces accedo al sistema
  Y veo mi nombre y mi rol en la cabecera

Escenario: Credenciales incorrectas
  Cuando ingreso una contraseña incorrecta
  Entonces veo "Correo o contraseña incorrectos"
  Y el mensaje no revela si el correo existe o no

Escenario: Usuario desactivado
  Dado que mi usuario fue desactivado por el administrador
  Cuando intento ingresar con credenciales válidas
  Entonces veo "Tu cuenta está desactivada. Contacta al administrador"
```
**Cubre:** RF-M1-01, RF-M1-02, RF-M1-03

### US-02 · Sesión persistente — `2 pts` — *Must*
> Como **cajero**, quiero seguir con sesión iniciada entre turnos, para no escribir
> mi clave cada vez que tomo el celular.

```gherkin
Escenario: La sesión sobrevive al cierre del navegador
  Dado que inicié sesión y marqué "mantener sesión"
  Cuando cierro el navegador y vuelvo a abrir la aplicación al día siguiente
  Entonces sigo con la sesión iniciada
```
**Cubre:** RF-M1-06

### US-03 · Administrar usuarios — `5 pts` — *Must*
> Como **administrador**, quiero crear y desactivar usuarios con su rol, para
> controlar quién opera el sistema.

```gherkin
Escenario: Crear un vendedor
  Cuando creo un usuario con rol "vendedor" y correo válido
  Entonces el usuario recibe un correo para definir su contraseña
  Y aparece en la lista de usuarios como "pendiente de activación"

Escenario: Desactivar conserva el historial
  Dado que un vendedor tiene 40 ventas registradas
  Cuando lo desactivo
  Entonces no puede iniciar sesión
  Y sus 40 ventas siguen visibles y atribuidas a su nombre
```
**Cubre:** RF-M1-03, RF-M1-04

---

## Épica E2 — Tengo mi catálogo cargado y ordenado

### US-04 · Crear producto — `5 pts` — *Must*
> Como **administrador**, quiero crear un producto con su precio, costo y código,
> para poder venderlo y saber cuánto gano.

```gherkin
Escenario: Creación con datos válidos
  Cuando creo un producto con nombre, precio 1990, costo 1200 y código 7801234567890
  Entonces el producto queda disponible en el catálogo
  Y el sistema muestra un margen de $790 (39,7 %)

Escenario: Código duplicado
  Dado que ya existe un producto con el código 7801234567890
  Cuando intento crear otro con el mismo código
  Entonces veo "Ese código ya pertenece a: <nombre del producto>"
  Y se me ofrece ir a ese producto
```
**Cubre:** RF-M2-01, RF-M2-03, RF-M2-10

### US-05 · Crear producto escaneando — `5 pts` — *Must*
> Como **administrador**, quiero crear un producto escaneando su código, para no
> tipear 13 dígitos sin equivocarme.

```gherkin
Escenario: Escaneo de código nuevo
  Cuando escaneo un código que no existe en el catálogo
  Entonces se abre el formulario de producto con el código ya cargado
  Y solo debo completar nombre, precio y costo
```
**Cubre:** RF-M2-04

### US-06 · Carga masiva del catálogo — `8 pts` — *Must*
> Como **administrador**, quiero cargar mi catálogo completo desde un Excel, para
> no crear 800 productos a mano.

```gherkin
Escenario: Archivo válido
  Cuando subo una planilla con 800 productos que cumple la plantilla
  Entonces veo una vista previa con los 800 registros antes de confirmar
  Y al confirmar, los 800 productos quedan creados con su stock inicial

Escenario: Archivo con errores
  Dado que la fila 45 tiene un precio no numérico y la fila 120 un código repetido
  Cuando subo el archivo
  Entonces veo un informe indicando fila 45 y fila 120 con su error
  Y NO se carga ningún producto hasta que corrija el archivo
```
**Cubre:** RF-M2-11, RF-M2-12
**Nota:** historia crítica. De ella depende la puesta en marcha (ver R-02 en [13](13-riesgos.md)).

### US-07 · Historial de precios — `3 pts` — *Must*
> Como **administrador**, quiero ver cuándo y quién cambió el precio de un producto,
> para entender variaciones de margen.

```gherkin
Escenario: Cambio de precio registrado
  Cuando el supervisor cambia el precio de $1.990 a $2.190
  Entonces el historial registra fecha, usuario, valor anterior y valor nuevo
  Y ese registro no puede editarse ni borrarse
```
**Cubre:** RF-M2-09, RF-M9-05

---

## Épica E3 — Sé exactamente cuánto tengo

### US-08 · Ver stock en tiempo real — `3 pts` — *Must*
> Como **administrador**, quiero ver el stock actual de cada producto, para saber
> qué reponer.

```gherkin
Escenario: El stock refleja la venta de inmediato
  Dado que el producto A tiene 10 unidades
  Cuando un cajero vende 3 unidades del producto A
  Entonces el stock del producto A muestra 7 unidades
  Y el kardex registra un movimiento tipo "venta" de -3 con saldo 7
```
**Cubre:** RF-M4-01, RF-M4-02

### US-09 · Ajustar stock con motivo — `5 pts` — *Must*
> Como **administrador**, quiero corregir el stock indicando el motivo, para que
> las diferencias queden explicadas y no escondidas.

```gherkin
Escenario: Ajuste por merma
  Cuando ajusto el producto A de 7 a 5 unidades con motivo "producto vencido"
  Entonces el kardex registra un movimiento tipo "merma" de -2
  Y el movimiento queda asociado a mi usuario
  Y aparece en el reporte de mermas del período

Escenario: Motivo obligatorio
  Cuando intento ajustar el stock sin indicar motivo
  Entonces el sistema no permite guardar
```
**Cubre:** RF-M4-04, RF-M4-10

### US-10 · Toma de inventario — `8 pts` — *Must*
> Como **administrador**, quiero registrar el conteo físico y que el sistema calcule
> la diferencia, para cuadrar el inventario sin hacer cálculos a mano.

```gherkin
Escenario: Conteo con diferencias
  Dado que inicio una toma de inventario de la categoría "Bebidas"
  Cuando registro el conteo físico de los 30 productos escaneándolos
  Entonces veo un resumen con los productos que difieren, la diferencia en unidades y su valor en pesos
  Y al confirmar se generan los ajustes tipo "toma_inventario" correspondientes

Escenario: Toma parcial
  Cuando hago una toma solo de la categoría "Bebidas"
  Entonces el resto del catálogo no se ve afectado
```
**Cubre:** RF-M4-05, RF-M4-06

### US-11 · Alerta de stock mínimo — `3 pts` — *Must*
> Como **administrador**, quiero que me avisen cuando un producto está por acabarse,
> para reponer antes de perder la venta.

```gherkin
Escenario: Producto cruza el mínimo
  Dado que el producto A tiene stock mínimo 5 y stock actual 6
  Cuando se venden 2 unidades
  Entonces el producto aparece en el panel "bajo stock mínimo"
  Y se incluye en el resumen diario por correo
```
**Cubre:** RF-M4-07, RF-M8-01, RF-M8-02

---

## Épica E4 — Recibo mercadería sin papeles

### US-12 · Registrar recepción — `8 pts` — *Must*
> Como **bodeguero**, quiero registrar lo que llegó del proveedor escaneando cada
> producto, para que el stock suba solo.

```gherkin
Escenario: Recepción confirmada
  Dado que llegó mercadería del proveedor "Distribuidora Sur" con guía 12345
  Cuando escaneo 12 productos indicando cantidad y costo unitario
  Y confirmo la recepción
  Entonces el stock de los 12 productos aumenta
  Y el kardex registra 12 movimientos tipo "recepcion" referidos a la guía 12345
  Y el costo promedio ponderado de cada producto se recalcula

Escenario: Alerta de variación de costo
  Dado que el producto A tenía costo promedio $1.000
  Cuando lo recepciono a $1.400 (40 % más)
  Entonces el sistema me advierte de la variación antes de confirmar
```
**Cubre:** RF-M3-04 a RF-M3-08

### US-13 · Anular recepción — `5 pts` — *Must*
> Como **administrador**, quiero anular una recepción mal registrada, para corregir
> sin que quede un descuadre.

```gherkin
Escenario: Reversa completa
  Cuando anulo la recepción de la guía 12345
  Entonces el stock vuelve al valor previo
  Y el kardex conserva el movimiento original Y el de anulación
  Y ningún registro del kardex fue borrado
```
**Cubre:** RF-M3-09, RF-M4-11

---

## Épica E5 — Vendo rápido, con o sin internet

### US-14 · Venta escaneando — `13 pts` — *Must* — **historia central del sistema**
> Como **cajero**, quiero cobrar escaneando los productos con la cámara, para
> atender rápido y sin errores de precio.

```gherkin
Escenario: Venta de tres productos
  Dado que tengo mi caja abierta
  Cuando escaneo tres productos seguidos sin cerrar la cámara
  Entonces cada uno se agrega al carrito con su precio
  Y escucho un sonido y siento una vibración por cada lectura
  Y el total se actualiza en pantalla

Escenario: Producto repetido
  Cuando escaneo dos veces el mismo producto
  Entonces la línea muestra cantidad 2, no dos líneas separadas

Escenario: Código desconocido
  Cuando escaneo un código que no está en el catálogo
  Entonces se me ofrece "Crear este producto" sin perder el carrito actual

Escenario: Cobro en efectivo con vuelto
  Dado que el total es $7.450
  Cuando indico pago en efectivo con $10.000 recibidos
  Entonces el sistema muestra "Vuelto: $2.550"
  Y al confirmar, descuenta stock, registra la venta y afecta la caja
```
**Cubre:** RF-M5-01 a RF-M5-13

### US-15 · Vender sin internet — `13 pts` — *Must* — **la historia más riesgosa**
> Como **cajero**, quiero seguir vendiendo cuando se cae internet, para no parar
> la atención ni perder la venta.

```gherkin
Escenario: Venta offline
  Dado que el celular perdió conexión
  Cuando registro una venta
  Entonces la venta se confirma de inmediato en pantalla
  Y el indicador muestra "Sin conexión · 1 venta por sincronizar"

Escenario: Sincronización al reconectar
  Dado que tengo 5 ventas en cola
  Cuando se restablece la conexión
  Entonces las 5 ventas se envían en el mismo orden en que ocurrieron
  Y el indicador vuelve a "Conectado · todo sincronizado"
  Y no se crea ninguna venta duplicada

Escenario: Reintento seguro
  Dado que una venta se envió pero la respuesta se perdió por corte de red
  Cuando el sistema reintenta el envío
  Entonces el servidor reconoce el identificador único de esa venta
  Y no la registra dos veces
```
**Cubre:** RF-M5-17, RF-M5-18, RF-M5-19
**Nota técnica:** requiere clave de idempotencia generada en el cliente. Ver
[08 — Contratos de API](08-api-contratos.md).

### US-16 · Anular venta — `5 pts` — *Must*
> Como **supervisor**, quiero anular una venta del día, para corregir un error de
> cobro dejando constancia.

```gherkin
Escenario: Anulación del día
  Cuando anulo una venta de hoy indicando el motivo
  Entonces el stock de sus productos se repone
  Y el efectivo esperado de la caja se ajusta
  Y la venta queda marcada como "anulada", nunca borrada
  Y la acción queda en la bitácora de auditoría

Escenario: Venta de días anteriores
  Dado que soy supervisor
  Cuando intento anular una venta de hace 3 días
  Entonces el sistema lo impide e indica que requiere un administrador
```
**Cubre:** RF-M5-15, RF-M9-05

---

## Épica E6 — La caja cuadra

### US-17 · Abrir caja — `3 pts` — *Must*
> Como **cajero**, quiero declarar con cuánto efectivo parto, para que al cerrar se
> sepa si cuadra.

```gherkin
Escenario: Apertura
  Cuando abro caja declarando $30.000 iniciales
  Entonces puedo comenzar a vender
  Y el efectivo esperado parte en $30.000

Escenario: Venta sin caja abierta
  Dado que no tengo caja abierta
  Cuando entro al POS
  Entonces el sistema me pide abrir caja antes de vender
```
**Cubre:** RF-M6-01, RF-M6-02, RF-M5-16

### US-18 · Cerrar caja con arqueo — `8 pts` — *Must*
> Como **cajero**, quiero contar el efectivo y que el sistema me diga si cuadra,
> para cerrar mi turno tranquilo.

```gherkin
Escenario: Cierre con diferencia
  Dado que el efectivo esperado es $187.400
  Cuando declaro un conteo físico de $185.400
  Entonces el sistema muestra "Faltante: $2.000"
  Y me exige escribir un comentario antes de cerrar
  Y el cierre queda registrado con esa diferencia y comentario

Escenario: Caja cerrada es inmutable
  Dado que cerré mi caja
  Cuando intento registrar un movimiento en ella
  Entonces el sistema lo impide
```
**Cubre:** RF-M6-04 a RF-M6-08

### US-19 · Movimientos de caja — `3 pts` — *Must*
> Como **cajero**, quiero registrar que saqué plata de la caja para un gasto, para
> que el arqueo no salga descuadrado.

```gherkin
Escenario: Egreso
  Cuando registro un egreso de $5.000 con motivo "compra de bolsas"
  Entonces el efectivo esperado baja en $5.000
  Y el movimiento aparece en el detalle del cierre
```
**Cubre:** RF-M6-03, RF-M6-04

---

## Épica E7 — Sé cómo va el negocio

### US-20 · Dashboard del día — `5 pts` — *Must*
> Como **administrador**, quiero abrir la app y ver de inmediato cómo va el día,
> para no tener que llamar al local.

```gherkin
Escenario: Vista de inicio
  Cuando entro como administrador
  Entonces veo ventas de hoy, número de transacciones, ticket promedio
  Y la cantidad de productos bajo stock mínimo
  Y el estado de las cajas (abiertas / cerradas)
```
**Cubre:** RF-M7-01

### US-21 · Reporte de margen — `5 pts` — *Must*
> Como **administrador**, quiero saber cuánto gané de verdad, no solo cuánto vendí,
> para decidir qué conviene tener.

```gherkin
Escenario: Utilidad del período
  Cuando consulto el reporte de margen del mes
  Entonces veo, por producto: unidades vendidas, venta total, costo total y utilidad bruta
  Y puedo ordenar por utilidad para ver qué producto realmente aporta

Escenario: Restricción por rol
  Dado que soy vendedor
  Cuando intento acceder al reporte de margen
  Entonces el sistema me lo deniega
```
**Cubre:** RF-M7-06, RF-M7-12

### US-22 · Exportar a Excel — `3 pts` — *Must*
> Como **administrador**, quiero exportar mis reportes, para mandárselos a mi contador.

```gherkin
Escenario: Exportación
  Cuando exporto el reporte de ventas del mes
  Entonces descargo un archivo CSV/Excel con los mismos datos que veo en pantalla
  Y las fechas están en hora de Chile y los montos en CLP
```
**Cubre:** RF-M7-09

### US-23 · Resumen diario por correo — `5 pts` — *Must*
> Como **administrador**, quiero recibir un correo al cierre del día, para enterarme
> sin entrar al sistema.

```gherkin
Escenario: Envío automático
  Dado que son las 22:00 hora de Chile
  Cuando el trabajo programado se ejecuta
  Entonces recibo un correo con ventas del día, diferencias de caja y productos bajo mínimo
  Y si alguna caja quedó abierta, el correo lo destaca
```
**Cubre:** RF-M8-02, RF-M8-03

---

## Épica E8 — Mis datos están seguros

### US-24 · Respaldo automático — `5 pts` — *Must*
> Como **administrador**, quiero que mis datos se respalden solos, para no perder
> el negocio por un accidente.

```gherkin
Escenario: Respaldo diario
  Dado que son las 03:00 hora de Chile
  Cuando el trabajo de respaldo se ejecuta
  Entonces se genera un respaldo completo con la fecha en su nombre
  Y se conservan los últimos 30 días
  Y si el respaldo falla, el administrador del servicio recibe una alerta
```
**Cubre:** RF-M9-01, RF-M9-02

### US-25 · Descargar mis datos — `3 pts` — *Must*
> Como **administrador**, quiero descargar mi información, para no quedar atrapado
> en el sistema de nadie.

```gherkin
Escenario: Exportación completa
  Cuando solicito la exportación de mis datos
  Entonces recibo un archivo con productos, ventas, movimientos de inventario y cajas
  En formato CSV legible por Excel
```
**Cubre:** RF-M9-03, RNF-48

### US-26 · Bitácora de auditoría — `5 pts` — *Must*
> Como **administrador**, quiero ver quién hizo cada cosa sensible, para poder
> investigar una diferencia.

```gherkin
Escenario: Consulta de bitácora
  Cuando consulto la bitácora filtrando por usuario y fecha
  Entonces veo cada cambio de precio, ajuste de stock y anulación con valor anterior y nuevo

Escenario: Inmutabilidad
  Dado que soy administrador
  Cuando intento borrar un registro de la bitácora
  Entonces el sistema lo impide, incluso por acceso directo a la base de datos
```
**Cubre:** RF-M9-05, RF-M9-06, RF-M9-07

---

## Resumen del backlog

| Épica | Historias | Puntos | Fase |
|---|:--:|:--:|---|
| E1 · Acceso y usuarios | 3 | 10 | F1 |
| E2 · Catálogo | 4 | 21 | F2 |
| E3 · Inventario | 4 | 19 | F2 |
| E4 · Recepción | 2 | 13 | F2 |
| E5 · Punto de venta | 3 | 31 | F3 |
| E6 · Caja | 3 | 14 | F3 |
| E7 · Reportes | 4 | 18 | F4 |
| E8 · Datos y auditoría | 3 | 13 | F4 |
| **Total** | **26** | **139** | |

> 139 puntos ≈ 70 jornadas de desarrollo netas. Con un desarrollador a tiempo
> parcial, el cronograma de [11 — Plan de trabajo](11-plan-trabajo.md) asume
> ~10 semanas más las fases de piloto y marcha blanca.
