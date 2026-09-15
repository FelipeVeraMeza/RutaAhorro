# 04 — Requerimientos no funcionales

Cada requerimiento incluye **cómo se verifica**. Un RNF sin forma de medirlo es
una intención, no un requerimiento.

---

## 1. Rendimiento

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-01 | El POS debe cargar y estar operativo en **menos de 3 s** en una conexión 4G, y en **menos de 1 s** en cargas posteriores (caché del service worker). | Lighthouse en dispositivo real, percentil 75 |
| RNF-02 | La búsqueda de productos debe devolver resultados en **menos de 300 ms** con 3.000 SKU, incluso sin conexión. | Índice local; medición con catálogo de prueba |
| RNF-03 | El reconocimiento de un código de barras debe ocurrir en **menos de 1,5 s** desde que el código entra en cuadro, con luz de local comercial. | Prueba con 50 productos reales |
| RNF-04 | Confirmar una venta debe tomar **menos de 800 ms** con conexión, y ser **instantáneo** sin conexión (encolado optimista). | Medición en producción |
| RNF-05 | Un reporte de 12 meses de ventas debe generarse en **menos de 5 s**. | Carga con datos sintéticos de 12 meses |
| RNF-06 | El paquete inicial de JavaScript no debe superar **250 KB** comprimidos. | Presupuesto verificado en CI |

## 2. Disponibilidad y continuidad

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-07 | Disponibilidad objetivo del **99,0 % mensual** en horario comercial (≈ 7 h de indisponibilidad al mes como máximo). | Monitoreo externo de uptime |
| RNF-08 | **El local debe poder seguir vendiendo aunque el sistema central esté caído.** El POS opera offline y sincroniza al restablecerse. | Prueba de corte: modo avión durante 30 min con ventas reales |
| RNF-09 | RPO (pérdida máxima de datos tolerable): **24 h** vía respaldo diario, y **0** para las ventas ya sincronizadas. | Prueba de restauración |
| RNF-10 | RTO (tiempo máximo de recuperación): **4 h** en horario hábil. | Simulacro documentado |

## 3. Compatibilidad y acceso multi-dispositivo

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-11 | Debe funcionar en **Chrome/Edge 110+**, **Safari iOS 15+** y **Chrome Android 10+**. | Matriz de pruebas por navegador |
| RNF-12 | La interfaz debe ser **responsiva** de 360 px a 1920 px de ancho, sin scroll horizontal. | Inspección en 5 breakpoints |
| RNF-13 | Debe instalarse como **PWA** en la pantalla de inicio del celular, con ícono y pantalla de arranque propios. | Instalación en Android e iOS |
| RNF-14 | No debe requerir instalación de software ni drivers en el local. | Por diseño |
| RNF-15 | El escaneo por cámara debe degradar con elegancia: si el navegador no soporta `BarcodeDetector`, debe usar la librería de respaldo sin que el usuario note la diferencia. | Prueba en Safari iOS |

## 4. Usabilidad

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-16 | Todo objetivo táctil debe medir al menos **44 × 44 px**. | Revisión de diseño |
| RNF-17 | Las acciones principales del POS deben estar en el **tercio inferior** de la pantalla, alcanzables con el pulgar. | Revisión de diseño |
| RNF-18 | Un usuario nuevo debe completar su primera venta en **menos de 15 min** de capacitación, sin ayuda escrita. | Prueba con 2 trabajadores reales |
| RNF-19 | Toda operación destructiva o irreversible (anular venta, ajustar stock, cerrar caja) debe requerir **confirmación explícita**. | Revisión funcional |
| RNF-20 | Los mensajes de error deben estar en **lenguaje del negocio**, no técnico: "No hay stock de este producto", no "constraint violation". | Revisión de textos |
| RNF-21 | Los montos deben mostrarse siempre formateados como CLP, con separador de miles y **sin decimales** ($12.990). | Pruebas unitarias del formateador |
| RNF-22 | La aplicación debe estar íntegramente en **español de Chile**. | Revisión de textos |

## 5. Seguridad

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-23 | Todo el tráfico debe ir por **HTTPS/TLS 1.2+**. Sin excepción (además, la cámara no funciona sin HTTPS). | Configuración de plataforma |
| RNF-24 | **Toda** tabla de la base de datos debe tener **RLS habilitado** con políticas explícitas. Ninguna tabla accesible sin política. | Test automatizado que falla si hay tablas sin RLS |
| RNF-25 | Las llaves `service_role` / `sb_secret_` deben existir **solo** en variables de entorno de servidor, nunca en el bundle del navegador. | Test en CI que revisa el bundle compilado |
| RNF-26 | Las contraseñas deben almacenarse con hash fuerte. Se delega en Supabase Auth (bcrypt); **el sistema nunca implementa su propia criptografía**. | Por diseño |
| RNF-27 | Un usuario de un local **jamás** debe poder leer datos de otro local, ni siquiera manipulando peticiones. | Test de penetración lógica sobre las políticas RLS |
| RNF-28 | Las acciones sensibles deben quedar en bitácora inmutable con usuario, fecha e IP. | RF-M9-05 |
| RNF-29 | El sistema debe aplicar limitación de tasa en autenticación y en endpoints del worker. | Prueba de carga |
| RNF-30 | Las dependencias deben auditarse automáticamente; ninguna vulnerabilidad **crítica** puede llegar a producción. | `npm audit` en CI, Dependabot |

## 6. Datos y localización

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-31 | Las fechas se almacenan en **UTC** (`timestamptz`) y se presentan en `America/Santiago`. | Pruebas unitarias, incluido el cambio de horario |
| RNF-32 | Los montos se almacenan como **enteros en CLP**. Prohibido usar punto flotante para dinero. | Revisión del esquema |
| RNF-33 | Las cantidades de inventario se almacenan como `numeric(14,3)` para soportar fracciones y peso. | Revisión del esquema |
| RNF-34 | La configuración de IVA (19 %) debe ser un parámetro, no un número escrito en el código. | Revisión del código |

## 7. Mantenibilidad y calidad

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-35 | Todo el código en **TypeScript en modo estricto**. Sin `any` implícito. | CI |
| RNF-36 | Cobertura de pruebas **≥ 70 %** en la lógica de negocio (cálculo de totales, costo promedio, arqueo, sincronización offline). | Reporte de cobertura en CI |
| RNF-37 | Debe existir una **suite de pruebas end-to-end** que cubra: venta completa, cierre de caja y recepción de mercadería. | Playwright en CI |
| RNF-38 | Los cambios de esquema se aplican solo mediante **migraciones versionadas** en el repositorio. Prohibido editar la base a mano en producción. | Revisión de PR |
| RNF-39 | **La documentación de `docs/` debe actualizarse en el mismo PR que cambia el comportamiento del sistema.** Un PR que altera una regla de negocio sin actualizar su documento no se aprueba. | Checklist de PR |
| RNF-40 | Todo error en producción debe reportarse automáticamente con su traza y contexto. | Sentry configurado |

## 8. Escalabilidad

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-41 | La arquitectura debe soportar **múltiples locales (tenants)** sin cambios de esquema. | [ADR-004](adr/ADR-004-multi-tenant.md) |
| RNF-42 | El sistema debe soportar **20 usuarios concurrentes** por local y 50.000 ventas anuales sin degradación perceptible. | Prueba de carga |
| RNF-51 | Ninguna operación concurrente puede producir **stock incorrecto**: tras N ventas simultáneas del mismo producto, el saldo debe ser exactamente el inicial menos lo vendido. | Prueba automatizada de concurrencia |
| RNF-52 | El sistema no debe presentar **interbloqueos** (deadlocks) bajo carga concurrente normal. | Monitoreo de Postgres bajo prueba de carga |
| RNF-53 | Un mismo usuario debe poder operar en **hasta 3 dispositivos** simultáneos sin que se invaliden las sesiones entre sí. | Prueba manual con 3 equipos |
| RNF-43 | Agregar un local nuevo debe tomar **menos de 1 hora** de configuración, sin desplegar código. | Procedimiento documentado |
| RNF-50 | Con **5 cajeros vendiendo en paralelo**, el tiempo de confirmación de venta no debe superar 1,5 s en el percentil 95. | Prueba de carga concurrente |

## 8.1 Concurrencia y consistencia

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-54 | Toda operación que modifique stock, caja o folios debe ejecutarse **dentro de una transacción de base de datos**, nunca orquestada desde el cliente. | Revisión de código: ninguna escritura multi-tabla fuera de una función PL/pgSQL |
| RNF-55 | El sistema debe tolerar que **dos dispositivos sincronicen la misma venta** (reintento tras corte de red) sin duplicarla. | Prueba automatizada de idempotencia |
| RNF-56 | Los conflictos de edición deben resolverse **avisando al usuario**, nunca descartando silenciosamente el cambio de otro. | Revisión funcional |

> **La regla que sostiene todo lo anterior:** la aplicación web **nunca** calcula
> y luego escribe. Lee para mostrar, y delega el cálculo definitivo a la base de
> datos, que es el único punto donde el orden entre usuarios está garantizado.
> Un carrito calculado en el celular es una comodidad visual; el total que vale
> es el que devuelve `fn_register_sale`.

## 9. Accesibilidad

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-44 | Contraste mínimo **4,5:1** en texto normal (WCAG 2.1 AA). | Auditoría automática |
| RNF-45 | La aplicación debe ser operable con teclado en escritorio. | Revisión manual |
| RNF-46 | El estado de la aplicación nunca debe comunicarse **solo** por color (importa para el estado de conexión y el stock bajo). | Revisión de diseño |

## 10. Legal y cumplimiento

| ID | Requerimiento | Verificación |
|---|---|---|
| RNF-47 | El tratamiento de datos personales debe cumplir la normativa chilena vigente (Ley 19.628 y Ley 21.719 según su entrada en vigencia). | [10 — Seguridad §6](10-seguridad-cumplimiento.md) |
| RNF-48 | El cliente debe poder **exportar todos sus datos** en formato abierto y solicitar su eliminación al término del servicio. | RF-M9-03 |
| RNF-49 | Debe informarse al cliente que sus datos residen en **Canadá (`ca-central-1`)** y obtener su conformidad. | Cláusula en el contrato de servicio |
