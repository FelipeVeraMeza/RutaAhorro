# 01 — Visión y alcance

> **Estado:** borrador para validación del cliente.
> Las secciones marcadas con 🔶 contienen **supuestos** que deben confirmarse
> (ver [15 — Preguntas abiertas](15-preguntas-abiertas.md)).

---

## 1. Contexto de negocio

RutaAhorro es un comercio minorista con mercadería física en local. Hoy la
gestión de existencias, precios y ventas se lleva de forma manual (cuaderno,
planilla y memoria del personal). Esto genera tres costos que el dueño paga sin
verlos en una línea del balance:

1. **Quiebre de stock**: se descubre que falta un producto cuando el cliente ya
   está frente al mostrador. Venta perdida.
2. **Sobre-stock y merma**: se compra lo que ya había, o se pierde producto sin
   saber cuánto ni cuándo.
3. **Descuadre de caja**: no hay forma de saber si la diferencia del día es un
   error de vuelto, un precio mal cobrado o una fuga.

Ninguno de esos tres problemas se resuelve comprando software genérico: se
resuelven teniendo **un registro confiable, en tiempo real, alimentado sin
fricción durante la operación normal del local**.

## 2. Problema a resolver

> El local no puede responder con certeza, en menos de un minuto:
> ¿cuánto tengo de este producto?, ¿cuánto vendí hoy?, ¿cuánto me costó lo que
> vendí? y ¿cuadra la caja?

Las soluciones POS tradicionales resuelven esto, pero exigen una inversión
inicial (computador, lector láser, cajón, impresora, licencia) que un comercio
pequeño no justifica.

## 3. Propuesta de valor

Un sistema que **usa el celular que el trabajador ya tiene** como terminal y
como lector de códigos de barras, accesible desde el navegador sin instalar
nada, con la información centralizada y respaldada.

| Enfoque tradicional | RutaAhorro |
|---|---|
| Computador + lector láser por caja (~$400.000 inicial) | Celular del trabajador ($0 inicial) |
| Instalación y mantención en sitio | Acceso por navegador, actualizaciones automáticas |
| Datos en el PC del local | Datos centralizados y respaldados |
| Licencia + soporte por separado | Precio mensual único todo incluido |

## 4. Objetivos

### 4.1 Objetivos de negocio (del cliente)

| # | Objetivo | Métrica de éxito | Cómo se mide |
|---|---|---|---|
| ON-1 | Saber el stock real sin contar a mano | Diferencia inventario físico vs. sistema **< 3 %** | Toma de inventario mensual |
| ON-2 | Eliminar el descuadre de caja no explicado | **> 95 %** de cierres con diferencia $0 | Reporte de arqueos |
| ON-3 | Evitar quiebres en productos de alta rotación | **0** quiebres no avisados con 48 h de anticipación | Alertas de stock mínimo |
| ON-4 | Conocer el margen real por producto | 100 % de productos con costo registrado | Reporte de márgenes |
| ON-5 | Reducir el tiempo de cierre diario | De ~30 min a **< 5 min** | Medición antes/después |

### 4.2 Objetivos del producto (del equipo)

| # | Objetivo |
|---|---|
| OP-1 | Registrar una venta en **menos de 10 segundos** desde el escaneo hasta el cobro |
| OP-2 | Un trabajador nuevo opera el POS con **menos de 15 minutos** de capacitación |
| OP-3 | El sistema sigue vendiendo **sin internet** y sincroniza al reconectar |
| OP-4 | La arquitectura soporta **N clientes** sin reescribir nada (modelo SaaS) |

## 5. Alcance de la versión 1.0

### 5.1 Dentro del alcance

Corresponde íntegramente a lo ofertado en el *Plan Completo* de la propuesta
comercial ($59.990 CLP/mes, IVA incluido):

| Módulo | Incluye |
|---|---|
| **M1 · Autenticación y usuarios** | Sesiones independientes por trabajador, roles y permisos, recuperación de contraseña |
| **M2 · Catálogo de productos** | Alta/baja/edición, categorías, múltiples códigos de barra por producto, precio de venta, costo, imagen |
| **M3 · Proveedores y compras** | Ficha de proveedor, recepción de mercadería, actualización automática de costo y stock |
| **M4 · Inventario** | Stock en tiempo real, kardex de movimientos, ajustes con motivo, toma de inventario, alertas de stock mínimo |
| **M5 · Punto de venta** | Venta con escaneo por cámara o búsqueda manual, carrito, descuentos, medios de pago, anulación |
| **M6 · Control de caja** | Apertura con monto inicial, movimientos (ingreso/egreso), cierre con arqueo y diferencia |
| **M7 · Reportes** | Ventas por día/período/usuario/producto, inventario valorizado, productos sin movimiento, márgenes |
| **M8 · Alertas** | Stock bajo mínimo, caja sin cerrar, diferencias de arqueo |
| **M9 · Administración** | Respaldo automático diario, bitácora de auditoría, configuración del local |

**Transversal:** acceso desde celular, tablet y computador (PWA responsiva);
funcionamiento offline del POS; respaldo de información; actualizaciones del
sistema; soporte.

### 5.2 Fuera del alcance de la v1.0

Esto **no** se construye en la v1.0. Se documenta explícitamente para que no
haya ambigüedad contractual.

| # | Fuera de alcance | Por qué | ¿Futuro? |
|---|---|---|---|
| FA-1 | **Emisión de boleta/factura electrónica (DTE) ante el SII** | Requiere certificado digital, folios CAF y homologación con el SII, o contratar un proveedor DTE. Es un proyecto en sí mismo. 🔶 | v2.0 vía proveedor DTE |
| FA-2 | **Contabilidad formal** (libro diario, mayor, balance, F29) | La propuesta menciona "control contable"; lo que se entrega es **control de caja y de márgenes**, no contabilidad tributaria. 🔶 **Hay que alinear esta expectativa con el cliente antes de firmar.** | Exportación para el contador |
| FA-3 | Integración con Transbank / POS de tarjetas | Depende del adquirente contratado por el local | v2.0 |
| FA-4 | Impresión en impresora térmica | Requiere hardware en local; contradice la premisa "sin infraestructura" | Opcional bajo pedido |
| FA-5 | E-commerce / venta en línea al público | No fue solicitado | v2.0 |
| FA-6 | Multi-sucursal con traspasos entre bodegas | El local es uno solo 🔶 | Modelado en la BD desde el día 1, habilitado en v1.1 |
| FA-7 | Venta a granel por peso (integración con balanza) | Por confirmar si el local vende por peso 🔶 | v1.1 si aplica |
| ~~FA-11~~ | ~~Control de vencimientos~~ | **Incorporado al alcance el 2026-09-14** tras confirmarse que el local maneja perecibles (P-07). Ver [ADR-007](adr/ADR-007-lotes-vencimiento.md) | **En v1.0** |
| FA-8 | Fidelización / puntos / clientes registrados | No fue solicitado | v2.0 |
| FA-9 | App nativa en App Store / Play Store | La PWA cubre el caso de uso sin costo de publicación ni revisión de tiendas | Si el cliente lo pide |
| FA-10 | Cobro automatizado de la suscripción | El cobro al cliente es manual entre las partes | Cuando haya más de 5 clientes |

## 6. Supuestos 🔶

Estos supuestos sostienen el plan y el precio. **Si alguno resulta falso, cambia
el alcance, el plazo o el costo.**

| # | Supuesto | Impacto si es falso |
|---|---|---|
| S-1 | El local es **uno solo**, sin sucursales ni bodegas externas | +2 semanas (traspasos, stock por ubicación) |
| S-2 | Hay **menos de 5 usuarios** operando simultáneamente | Revisar plan de infraestructura |
| S-3 | El catálogo tiene **menos de 3.000 SKU** | Revisar carga inicial y búsqueda offline |
| S-4 | El local tiene internet con **cortes ocasionales**, no permanentes | El modo offline pasa de red de seguridad a requisito crítico |
| S-5 | La mayoría de los productos **trae código de barras de fábrica** | Hay que imprimir y pegar etiquetas: +horas-hombre en la carga inicial |
| S-6 | Los trabajadores tienen **smartphone con cámara** (Android 10+ / iOS 15+) | El local debe proveer un dispositivo |
| S-7 | El cliente **no requiere emitir boleta electrónica** desde este sistema | Ver FA-1: proyecto adicional |
| S-8 | La carga inicial del inventario la hace **el cliente**, con plantilla y apoyo del equipo | +40 a 80 horas-hombre al proyecto |
| S-9 | Los precios se manejan **con IVA incluido** (precio de lista al público) | Cambia el cálculo de totales y reportes |
| S-10 | Solo **una parte** del catálogo es perecible; el resto no requiere lote | Si todo el catálogo lleva lote, cada recepción se encarece y la carga inicial crece |

## 7. Restricciones

| # | Restricción |
|---|---|
| RE-1 | **Presupuesto operacional**: el costo de infraestructura debe caber holgadamente dentro de los $59.990 CLP/mes. Ver [12 — Costos](12-costos-modelo-servicio.md) |
| RE-2 | **Sin hardware en el local**: la solución no puede depender de un equipo instalado en el comercio |
| RE-3 | **Un solo desarrollador** disponible para el proyecto |
| RE-4 | **Región de datos**: el proyecto Supabase está en `ca-central-1` (Canadá). Implicancia legal en [10 — Seguridad](10-seguridad-cumplimiento.md) |
| RE-5 | El navegador exige **HTTPS** para acceder a la cámara: no hay escaneo sin certificado válido |

## 8. Criterios de aceptación del proyecto

La v1.0 se considera entregada cuando, en el local del cliente y con datos reales:

1. El catálogo completo está cargado y valorizado.
2. Se opera **5 días hábiles consecutivos** registrando el 100 % de las ventas en el sistema.
3. Los 5 cierres de caja se realizan desde el sistema, con toda diferencia explicada.
4. Se ejecuta una toma de inventario con desviación menor al 3 %.
5. El respaldo automático se verifica **restaurando** en un entorno de prueba.
6. El personal está capacitado y firmó el acta de capacitación.
7. Todos los requerimientos de prioridad **Must** están implementados y probados.
8. La documentación de `docs/` está actualizada al estado real del sistema entregado.
