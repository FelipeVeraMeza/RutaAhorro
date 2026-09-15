# 02 — Stakeholders, usuarios y roles

## 1. Stakeholders

| Stakeholder | Rol en el proyecto | Interés principal | Poder de decisión |
|---|---|---|---|
| **Dueño / administrador de RutaAhorro** | Cliente, patrocinador | Que el negocio deje de perder plata por descontrol | **Alto** — aprueba alcance y pagos |
| **Trabajadores del local** | Usuarios finales diarios | Que el sistema no les haga más lento el trabajo | Medio — su rechazo mata el proyecto |
| **Felipe Vera Meza** | Desarrollador, analista, soporte | Entregar un sistema mantenible y rentable de operar | **Alto** — decide arquitectura |
| **Contador externo del local** | Consumidor de reportes | Recibir información confiable y exportable | Bajo — pero define formatos de salida 🔶 |
| **Proveedores del local** | Actores externos | Ninguno directo (solo son datos en el sistema) | Ninguno |
| **Proveedores de infraestructura** (Supabase, Railway) | Terceros críticos | — | Ninguno, pero son riesgo de dependencia |

## 2. Perfiles de usuario (personas)

### 2.1 Dueño / Administrador — "Necesito saber si estoy ganando plata"

- **Contexto**: no está todo el día en el local; revisa desde su celular.
- **Objetivos**: ver ventas del día sin llamar por teléfono; saber qué reponer;
  detectar diferencias de caja; conocer márgenes.
- **Frustraciones**: reportes que no entiende; tener que pedirle a alguien que le saque el número.
- **Competencia digital**: media. Usa WhatsApp y banca en línea con soltura.
- **Dispositivo principal**: celular.

### 2.2 Cajero / Vendedor — "Tengo una fila esperando"

- **Contexto**: atiende de pie, con clientes esperando, a veces con una sola mano libre.
- **Objetivos**: cobrar rápido y sin equivocarse; que el precio salga solo.
- **Frustraciones**: pantallas con letra chica; tener que buscar el producto en una lista larga; que se caiga internet.
- **Competencia digital**: variable. Puede ser baja.
- **Dispositivo principal**: celular propio.
- **Requisito crítico que impone**: la pantalla del POS debe operarse **con el pulgar, con una mano**.

### 2.3 Bodeguero / Repositor — "Llegó el camión"

- **Contexto**: recibe mercadería, cuenta cajas, repone góndola.
- **Objetivos**: ingresar la recepción rápido; saber qué falta en sala.
- **Frustraciones**: tener que anotar en papel y después digitar todo de nuevo.
- **Dispositivo principal**: celular, muchas veces con las manos ocupadas.

### 2.4 Contador externo — "Necesito los datos del mes" 🔶

- **Contexto**: externo al local, recibe información una vez al mes.
- **Objetivos**: recibir ventas y compras del período en un formato que pueda procesar.
- **Necesidad concreta**: exportación a Excel/CSV. **No** necesita acceso al sistema en v1.0.

## 3. Roles del sistema

Se definen **cuatro roles**. Todo usuario tiene exactamente uno.

| Rol | Código | Descripción |
|---|---|---|
| Administrador | `admin` | Dueño o encargado general. Control total sobre su local. |
| Supervisor | `supervisor` | Encargado de turno. Opera y autoriza excepciones, pero no toca configuración ni costos. |
| Vendedor | `vendedor` | Cajero. Solo vende y opera su propia caja. |
| Bodega | `bodega` | Recepciona mercadería y ajusta inventario. No vende ni ve dinero. |

> Existe además un rol interno `soporte` para el equipo de desarrollo, con acceso
> auditado y limitado en el tiempo. Ver [10 — Seguridad §5](10-seguridad-cumplimiento.md).

## 4. Matriz de permisos

Leyenda: ✅ permitido · ⚠️ permitido con restricción · ❌ denegado

| Acción | `admin` | `supervisor` | `vendedor` | `bodega` |
|---|:--:|:--:|:--:|:--:|
| **Productos** | | | | |
| Ver catálogo y precios de venta | ✅ | ✅ | ✅ | ✅ |
| Ver **costo** y margen | ✅ | ❌ | ❌ | ⚠️ solo al recepcionar |
| Crear / editar producto | ✅ | ✅ | ❌ | ⚠️ sin tocar precio de venta |
| Cambiar precio de venta | ✅ | ⚠️ con registro en bitácora | ❌ | ❌ |
| Desactivar producto | ✅ | ❌ | ❌ | ❌ |
| **Inventario** | | | | |
| Ver stock | ✅ | ✅ | ✅ | ✅ |
| Ajustar stock (merma, robo, corrección) | ✅ | ⚠️ requiere motivo | ❌ | ⚠️ requiere motivo |
| Ejecutar toma de inventario | ✅ | ✅ | ❌ | ✅ |
| Ver kardex / historial de movimientos | ✅ | ✅ | ❌ | ✅ |
| **Compras y proveedores** | | | | |
| Gestionar proveedores | ✅ | ❌ | ❌ | ⚠️ solo lectura |
| Registrar recepción de mercadería | ✅ | ✅ | ❌ | ✅ |
| **Ventas** | | | | |
| Registrar venta | ✅ | ✅ | ✅ | ❌ |
| Aplicar descuento en línea | ✅ | ✅ | ⚠️ hasta un % configurable | ❌ |
| Anular venta del día | ✅ | ✅ | ❌ | ❌ |
| Anular venta de días anteriores | ✅ | ❌ | ❌ | ❌ |
| Ver historial de ventas propias | ✅ | ✅ | ✅ | ❌ |
| Ver historial de ventas de todos | ✅ | ✅ | ❌ | ❌ |
| **Caja** | | | | |
| Abrir su caja | ✅ | ✅ | ✅ | ❌ |
| Registrar ingreso/egreso de caja | ✅ | ✅ | ⚠️ con motivo | ❌ |
| Cerrar su propia caja | ✅ | ✅ | ✅ | ❌ |
| Cerrar la caja de otro usuario | ✅ | ✅ | ❌ | ❌ |
| Ver diferencias históricas de arqueo | ✅ | ✅ | ❌ | ❌ |
| **Reportes** | | | | |
| Reportes operativos (ventas, stock) | ✅ | ✅ | ⚠️ solo propios | ⚠️ solo inventario |
| Reportes financieros (margen, utilidad) | ✅ | ❌ | ❌ | ❌ |
| Exportar a Excel/CSV | ✅ | ⚠️ sin costos | ❌ | ⚠️ solo inventario |
| **Administración** | | | | |
| Crear / desactivar usuarios | ✅ | ❌ | ❌ | ❌ |
| Cambiar configuración del local | ✅ | ❌ | ❌ | ❌ |
| Ver bitácora de auditoría | ✅ | ❌ | ❌ | ❌ |
| Descargar respaldo | ✅ | ❌ | ❌ | ❌ |

> **Regla de oro de la matriz:** el rol `vendedor` nunca ve costos ni márgenes, y
> nunca puede modificar hacia atrás lo que ya ocurrió. Esa es la separación de
> funciones que hace confiable el control de caja.

## 5. Implementación técnica de los permisos

Los permisos **no** se implementan solo en la interfaz. Cada regla de esta matriz
se traduce a una **política RLS en PostgreSQL**, de modo que ocultar un botón sea
una comodidad visual y no un control de seguridad.

Ver [06 — Modelo de datos §6](06-modelo-datos.md) para las políticas concretas.

## 6. Matriz RACI del proyecto

| Actividad | Dueño | Trabajadores | Felipe | Contador |
|---|:--:|:--:|:--:|:--:|
| Definir requerimientos | **A** | C | **R** | C |
| Aprobar alcance y precio | **A/R** | I | C | I |
| Diseño y desarrollo | I | I | **A/R** | — |
| Carga inicial del inventario | **A** | **R** | C | — |
| Pruebas de aceptación | **A** | **R** | C | I |
| Capacitación | I | **R** | **A** | — |
| Operación diaria | A | **R** | I | — |
| Soporte y mantención | I | I | **A/R** | — |

R = Responsable · A = Aprobador · C = Consultado · I = Informado
