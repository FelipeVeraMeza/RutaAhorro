# 14 — Glosario

Vocabulario común entre el cliente y el equipo. Si una palabra de esta lista se
usa con otro sentido en una conversación, hay que aclararla de inmediato: la
mayoría de los malentendidos de un proyecto de inventario nacen aquí.

---

## Términos del negocio

| Término | Significado en este proyecto |
|---|---|
| **Arqueo** | Contar el efectivo real de la caja y compararlo con lo que el sistema dice que debería haber |
| **Caja (sesión de)** | Período entre que un usuario abre y cierra su caja. Todas sus ventas y movimientos pertenecen a esa sesión |
| **Costo promedio ponderado** | Costo de un producto calculado como promedio de todas las compras, ponderado por cantidad. Es el criterio que usa el sistema para valorizar el inventario y calcular márgenes |
| **Diferencia de caja** | Efectivo contado − efectivo esperado. Negativa = faltante; positiva = sobrante |
| **Folio** | Número correlativo de una venta dentro del local. **No** es el folio tributario del SII |
| **Kardex** | Historial completo e inmutable de todos los movimientos de un producto. Es la fuente de verdad del inventario |
| **Margen** | Precio de venta − costo. En porcentaje: margen ÷ precio de venta |
| **Merma** | Producto perdido por vencimiento, daño, robo o error. Se registra como un tipo de ajuste específico para poder reportarlo aparte |
| **Movimiento de inventario** | Cualquier hecho que cambia el stock: venta, recepción, ajuste, merma, toma de inventario |
| **Quiebre de stock** | Quedarse sin producto disponible para vender |
| **Recepción** | Registro de la mercadería que llega del proveedor. Sube el stock y recalcula el costo |
| **SKU** | *Stock Keeping Unit*. Código interno único de cada producto distinto |
| **Stock mínimo** | Cantidad bajo la cual el sistema avisa que hay que reponer |
| **Ticket promedio** | Venta total ÷ número de transacciones |
| **Toma de inventario** | Contar físicamente el stock y registrar la diferencia contra el sistema |
| **Valorización del inventario** | Cuánta plata hay inmovilizada en mercadería: stock × costo promedio |

---

## Términos técnicos (para el cliente)

| Término | Explicación sin jerga |
|---|---|
| **Aplicación web / PWA** | El sistema se abre en el navegador del celular y se puede dejar como ícono en la pantalla de inicio. Se usa como una app, pero no se descarga de ninguna tienda |
| **Base de datos** | Donde se guarda toda la información del local |
| **Caché** | Copia de información guardada en el celular para que la app responda rápido y funcione sin internet |
| **Modo offline** | El sistema sigue funcionando sin internet. Las ventas se guardan en el celular y se envían solas cuando vuelve la señal |
| **Nube** | Los datos no están en un computador del local, sino en servidores externos con respaldo |
| **Respaldo (backup)** | Copia de seguridad de toda la información, tomada automáticamente cada día |
| **Rol** | Tipo de usuario. Define qué puede ver y hacer cada persona |
| **Sincronizar** | Enviar al servidor lo que quedó guardado en el celular mientras no había internet |
| **Tiempo real** | La información se actualiza al instante para todos. Si el cajero vende, el dueño lo ve de inmediato desde su casa |

---

## Términos técnicos (para el equipo)

| Término | Definición |
|---|---|
| **ADR** | *Architecture Decision Record*. Documento breve que registra una decisión técnica y por qué se tomó |
| **DoD / DoR** | Definición de Terminado / de Listo. Criterios para que una tarea pueda cerrarse o comenzar |
| **Idempotencia** | Propiedad de una operación que, repetida varias veces, produce el mismo resultado que una sola. Es lo que impide que una venta reenviada se registre dos veces |
| **IndexedDB** | Base de datos del navegador. Guarda el catálogo y la cola de ventas offline |
| **Kardex inmutable** | Los movimientos no se editan ni se borran; corregir significa agregar un movimiento compensatorio |
| **MoSCoW** | Priorización: Must, Should, Could, Won't |
| **Multi-tenant** | Una sola instalación atiende a varios clientes, con sus datos aislados entre sí |
| **PostgREST** | Capa de Supabase que expone las tablas de PostgreSQL como API REST |
| **RLS** (*Row Level Security*) | Seguridad a nivel de fila en PostgreSQL. Cada consulta solo devuelve las filas que el usuario tiene derecho a ver, aplicada por la base de datos y no por la aplicación |
| **RPC** | Llamada a una función almacenada en la base de datos. Se usa para operaciones que deben ser atómicas |
| **RPO / RTO** | Pérdida máxima de datos tolerable / tiempo máximo de recuperación |
| **Service Worker** | Programa que corre en el navegador en segundo plano; habilita el modo offline y la sincronización |
| **Tenant** | Cliente contratante. Cada local es un tenant con sus datos aislados |
| **Transacción atómica** | Conjunto de operaciones que ocurren todas o ninguna. Impide que el stock baje sin que la venta quede registrada |

---

## Términos legales y tributarios (Chile)

| Término | Significado |
|---|---|
| **Boleta electrónica** | Documento tributario que el comercio debe emitir al consumidor final. **Fuera del alcance de la v1.0** |
| **CAF** | *Código de Autorización de Folios*. Autorización del SII para emitir documentos tributarios con numeración válida |
| **DTE** | Documento Tributario Electrónico: boleta, factura, guía de despacho |
| **F29** | Formulario mensual de declaración de IVA ante el SII |
| **IVA** | Impuesto al Valor Agregado, 19 % en Chile. Los precios al público se manejan con IVA incluido |
| **Ley 19.628** | Ley sobre protección de la vida privada y tratamiento de datos personales |
| **Ley 21.719** | Nueva ley de protección de datos personales, con entrada en vigencia programada para diciembre de 2026. Crea la Agencia de Protección de Datos Personales |
| **RUT** | Rol Único Tributario. Identificador de personas y empresas en Chile |
| **SII** | Servicio de Impuestos Internos |
