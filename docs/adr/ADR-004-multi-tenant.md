# ADR-004 · Multi-tenant desde el primer día

**Estado:** Aceptada
**Fecha:** 2026-09-14

## Contexto

Hoy hay **un solo cliente**: RutaAhorro. Pero el modelo de negocio declarado es
una suscripción mensual de $59.990 CLP, es decir, un SaaS pensado para venderse a
varios comercios. El análisis de [12 §2](../12-costos-modelo-servicio.md) muestra
que con un solo cliente en planes pagados el margen es del 4 %: **el negocio solo
funciona con varios clientes compartiendo la misma infraestructura.**

La pregunta es si construir para un cliente ahora y adaptar después, o construir
multi-tenant desde el inicio.

## Alternativas evaluadas

### A · Un cliente ahora, adaptar después
**A favor:** esquema más simple; una columna menos en cada tabla.
**En contra:** agregar `tenant_id` a un sistema en producción significa migrar
todas las tablas, reescribir todas las políticas RLS, revisar todas las consultas
y hacerlo **sin perder datos reales del cliente que ya está operando**. Es una de
las migraciones más caras y riesgosas que existen.

### B · Una instalación completa por cliente
**A favor:** aislamiento absoluto; sin riesgo de fuga entre clientes.
**En contra:** el costo de infraestructura crece **linealmente** con los
ingresos: cada cliente nuevo agrega ~$48.000 CLP mensuales contra ingresos netos
de $50.412. El margen nunca mejora con la escala. Además, un desarrollador tendría
que desplegar y actualizar N sistemas por separado.

### C · Multi-tenant con aislamiento por RLS ← **elegida**
**A favor:** una infraestructura atiende a todos; el margen mejora con cada
cliente; una sola actualización llega a todos; agregar un cliente no requiere
desplegar nada.
**En contra:** un error en una política RLS expone datos entre clientes.

## Decisión

**Toda tabla de negocio lleva `tenant_id`, y el aislamiento se implementa como
política RLS en PostgreSQL desde la primera migración.**

El costo de tomar esta decisión hoy es **una columna y una política por tabla**:
prácticamente nada. El costo de tomarla en un año, con el local del cliente
operando todos los días sobre la base, es una migración de alto riesgo sobre
datos reales.

Es una decisión asimétrica: barata ahora, cara después. Esas se toman temprano.

## Consecuencias

**Positivas**
- El margen crece con cada cliente: 89 % con uno, 85 % con diez
  ([12 §2.3](../12-costos-modelo-servicio.md)).
- Agregar un cliente toma menos de una hora de configuración, sin desplegar
  código (RNF-43).
- Una sola versión que mantener, probar y actualizar.
- El modelo ya contempla `store_id`, así que abrir una segunda sucursal tampoco
  exige rediseñar nada.

**Negativas**
- **Riesgo concentrado:** un error en una política RLS puede exponer datos entre
  clientes. Es el riesgo más grave del diseño, y se acepta conscientemente a
  cambio de la viabilidad económica.
- Toda consulta debe respetar el filtro por tenant.

**Mitigaciones obligatorias**
1. El `tenant_id` **jamás** se acepta como parámetro del cliente: se deriva
   siempre del token vía `auth.tenant_id()`.
2. Prueba automatizada en CI: ninguna tabla de `public` sin RLS.
3. Prueba automatizada en CI: un usuario del tenant A no alcanza **ninguna** fila
   del tenant B, en **ninguna** tabla.
4. Ambas pruebas bloquean el despliegue si fallan.

**Condiciona**
- Cada tabla nueva nace con `tenant_id` y su política. No hay excepciones, ni
  siquiera para tablas "auxiliares": las excepciones son justamente donde se
  filtran los datos.
