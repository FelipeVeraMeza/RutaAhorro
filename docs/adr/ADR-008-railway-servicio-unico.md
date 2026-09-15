# ADR-008 · Despliegue unificado en Railway con un solo servicio

**Estado:** Aceptada
**Fecha:** 2026-09-15
**Supera a:** [ADR-003](ADR-003-vercel-railway.md)

## Contexto

[ADR-003](ADR-003-vercel-railway.md) decidió frontend en Vercel y worker en
Railway. Al llegar el momento de desplegar por primera vez, tres de sus premisas
ya no se sostienen:

**1. El worker no lo llama nadie.** ADR-003 diseñó la comunicación
frontend → worker y la autenticó con `WORKER_SHARED_SECRET` en la cabecera
`X-Worker-Secret`. Esa comunicación todavía no existe:
`NEXT_PUBLIC_WORKER_URL` está declarada en `.env.example` y documentada como el
único mecanismo permitido, pero no aparece en ningún archivo de `apps/` ni de
`packages/`. El worker solo ejecuta sus propios cron contra Supabase.

**2. El argumento central de ADR-003 ya no aplica.** Su decisión se apoyaba en
que un `pg_dump` no cabe de forma confiable en una función serverless.
`apps/worker/src/jobs/backup.ts` no usa `pg_dump`: hace un export lógico con
supabase-js, y su propio comentario explica por qué — el contenedor de Railway
no garantiza ese binario. El respaldo, tal como está escrito hoy, no tiene la
restricción que motivó separar plataformas.

**3. Vercel Hobby prohíbe el uso comercial.** Este sistema se le cobra a un
cliente. El plan Pro son ~19.000 CLP mensuales sobre un presupuesto que hoy no
los contempla, y [12 §4](../12-costos-modelo-servicio.md) ya tenía anotada la
salida: *"desplegar también el frontend en Railway y prescindir de Vercel"*.

## Alternativas evaluadas

### A · Mantener Vercel + Railway (lo decidido en ADR-003)
**A favor:** entrega al borde y optimización de Next.js que hace Vercel;
previews automáticas por Pull Request; aislamiento total entre la atención al
cajero y los procesos pesados.
**En contra:** obliga al plan Pro por el uso comercial; dos plataformas que
configurar, monitorear y pagar para un monorepo de dos paquetes; y el
aislamiento protege de una contención de recursos que nadie ha medido, en un
local con dos cajeros.

### B · Todo en Railway, dos servicios (web + worker)
**A favor:** una sola plataforma; conserva el aislamiento de ADR-003; resuelve
el problema de licencia comercial.
**En contra:** el segundo servicio existiría para correr cron sobre una base que
todavía no tiene datos productivos. Un respaldo diario de una base vacía no vale
nada, y cada variable de entorno de más es superficie de error.

### C · Todo en Railway, un solo servicio web ← **elegida**
**A favor:** una plataforma, un servicio, un dominio, un conjunto de variables;
resuelve la licencia comercial; sin restricción de tiempo de ejecución si mañana
un route handler necesita más segundos.
**En contra:** sin previews por PR; los siete trabajos programados no corren
hasta que exista el worker; un pico de tráfico y un proceso pesado compartirían
recursos el día que el worker vuelva a este mismo servicio.

## Decisión

**Un único servicio en Railway que sirve la aplicación Next.js**, construido
desde `main` del repositorio de GitHub. Se prescinde de Vercel.

**El worker se mantiene en el repositorio y no se despliega.** No se borra
código: sigue compilando, sigue cubierto por `npm run typecheck`, y sus
trabajos se ejecutan a mano con el CLI que ya existe
(`npm run job -w @rutaahorro/worker <nombre>`).

**Criterio de reactivación, explícito para que no quede a criterio del día:** el
worker vuelve como segundo servicio (alternativa B) **antes de que el cliente
registre su primera venta real**. Desde ese momento hay datos que perder y
`backup-daily` pasa a ser lo que sostiene el compromiso de respaldo diario
(RF-M9-01), independientemente del plan de Supabase.

El razonamiento de fondo de ADR-003 sigue siendo válido y no se está negando:
*un respaldo que falla en silencio es peor que no tener respaldo*. Lo que cambia
es que hoy no hay nada que respaldar, y montar la infraestructura de respaldo
antes que los datos no la hace más confiable — solo la deja sin probar por más
tiempo.

## Consecuencias

**Positivas**
- Una sola plataforma que configurar, monitorear y pagar.
- Se elimina el riesgo de suspensión por uso comercial en plan Hobby
  ([13 §R-11](../13-riesgos.md)).
- Desaparece el orden de despliegue acoplado de ADR-003 §4.4: ya no hay que
  levantar el worker antes para que el frontend conozca su URL.
- `service_role` queda en un único servicio. La llave sigue sin viajar al
  navegador: la usa un route handler de servidor
  (`apps/web/src/app/api/usuarios/invitar/route.ts`), no el bundle del cliente.

**Negativas**
- Se pierden las previews automáticas por Pull Request. Revisar un cambio antes
  de fusionar vuelve a ser local.
- Se pierde la entrega al borde. Para un local en Chile contra Supabase en
  `ca-central-1`, la latencia la domina la base, no el CDN.
- **Los siete trabajos programados no corren.** Mientras el worker no exista
  como servicio, no hay respaldo automático, ni resumen diario, ni alerta de
  stock bajo, ni aviso de caja sin cerrar. Se ejecutan a mano o no se ejecutan.
- ADR-003 deja constancia de que **el cliente pidió explícitamente desplegar en
  Vercel y Railway**. Esta decisión se aparta de ese pedido y **debe validarse
  con él** — ver P-26 en [15](../15-preguntas-abiertas.md).

**Condiciona**
- El día que el frontend necesite invocar al worker, sigue vigente la regla de
  ADR-003: nunca escribir su URL en el código, siempre vía
  `NEXT_PUBLIC_WORKER_URL`.
- Si el worker vuelve a este mismo servicio en vez de uno propio, se pierde el
  aislamiento que ADR-003 defendía y habría que escribir un ADR que lo declare.
