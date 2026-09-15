# ADR-002 · Supabase como backend, con la seguridad en la base de datos

**Estado:** Aceptada
**Fecha:** 2026-09-14

## Contexto

El sistema necesita base de datos, autenticación con roles, almacenamiento de
imágenes y actualizaciones en tiempo real. Un desarrollador debe construir y
mantener todo eso dentro de un presupuesto de infraestructura de pocos dólares
mensuales. Además, el requisito más crítico del sistema es que **un local jamás
pueda ver los datos de otro** ni un vendedor los costos del dueño.

El proyecto Supabase ya existe: `amlvspbmnhtvzuqiteqe`, región `ca-central-1`.

## Alternativas evaluadas

### A · Backend propio (Express/NestJS + PostgreSQL administrado)
**A favor:** control total; sin dependencia de proveedor.
**En contra:** hay que construir y mantener autenticación, recuperación de
contraseña, subida de archivos, permisos y migraciones. Son semanas de trabajo
que no agregan valor al cliente. Y cada regla de permiso queda repartida entre
decenas de endpoints: basta olvidar una validación en uno para abrir un agujero.

### B · Firebase / Firestore
**A favor:** maduro, buen soporte offline nativo.
**En contra:** base de datos NoSQL. Un sistema de inventario es **inherentemente
relacional y transaccional**: descontar stock, registrar la venta y afectar la
caja deben ocurrir juntos o no ocurrir. Emular eso en Firestore es posible pero
antinatural, y los reportes con agregaciones se vuelven costosos en lecturas.

### C · Supabase ← **elegida**
**A favor:** PostgreSQL real con transacciones ACID; RLS; autenticación incluida;
Storage; tiempo real; plan gratuito generoso; migraciones versionadas por CLI.
**En contra:** dependencia de un proveedor; el plan gratuito no incluye respaldos
automáticos.

## Decisión

**Supabase, con la autorización implementada como políticas RLS en PostgreSQL.**

El argumento decisivo no es el ahorro: es **dónde vive la seguridad**.

Con un backend tradicional, cada endpoint debe acordarse de verificar el tenant y
el rol. Con RLS, la regla vive en la base de datos: aunque alguien construya la
petición a mano, invoque un endpoint olvidado o encuentre un error en la interfaz,
**PostgreSQL simplemente no devuelve las filas que no le corresponden**. Para un
sistema multi-tenant mantenido por una sola persona, esa diferencia es lo que
hace la propuesta defendible.

## Consecuencias

**Positivas**
- Semanas de desarrollo ahorradas en autenticación, permisos y archivos.
- Transacciones reales para venta, recepción y arqueo.
- El aislamiento entre clientes es una propiedad de la base, no una convención
  del código.
- SQL estándar: no hay nada propietario que impida migrar a otro PostgreSQL.

**Negativas**
- Escribir políticas RLS es meticuloso y fácil de hacer mal. **Mitigación:** una
  prueba automatizada en CI que falla si existe cualquier tabla sin RLS o si un
  usuario del tenant A alcanza datos del tenant B (RNF-24, RNF-27).
- El plan gratuito no respalda automáticamente. **Mitigación:** el worker de
  Railway hace `pg_dump` diario propio ([ADR-003](ADR-003-vercel-railway.md)).
- Dependencia de proveedor. **Mitigación:** PostgreSQL estándar, migraciones en
  el repositorio, respaldos propios. Migrar sería trabajoso, no imposible.

**Condiciona**
- Ninguna operación crítica puede quedar solo en la interfaz: si un permiso no se
  puede expresar como política RLS, hay que rediseñarlo hasta que se pueda.
- La llave `service_role` omite RLS por completo. Su uso queda restringido al
  worker de Railway, y CI verifica que nunca aparezca en el bundle del navegador.
