# ADR-003 · Separar frontend (Vercel) y trabajos programados (Railway)

**Estado:** Aceptada
**Fecha:** 2026-09-14

## Contexto

El sistema requiere dos tipos de ejecución muy distintos:

1. **Peticiones cortas e interactivas**: cargar el POS, registrar una venta,
   consultar el stock. Milisegundos, altísima frecuencia, sensibles a la latencia.
2. **Procesos largos y programados**: respaldo diario con `pg_dump`, correo de
   resumen a las 22:00, generación de un Excel con 12 meses de ventas,
   verificación semanal de integridad del inventario. Segundos o minutos, baja
   frecuencia, deben correr aunque nadie tenga la aplicación abierta.

El cliente pidió explícitamente desplegar en **Vercel y Railway**.

## Alternativas evaluadas

### A · Todo en Vercel (funciones serverless + cron)
**A favor:** una sola plataforma; un solo despliegue.
**En contra:** las funciones serverless tienen límite de tiempo de ejecución. Un
`pg_dump` de la base completa o un Excel de 12 meses **no cabe** en ese límite de
forma confiable, y el modo de falla es el peor posible: el respaldo se corta a la
mitad y aparenta haber corrido. Además, el cron de Vercel en plan gratuito es
limitado y no garantiza el horario.

### B · Todo en Railway (Next.js + worker en el mismo servicio)
**A favor:** una sola plataforma; sin restricción de tiempo de ejecución; evita
el problema de uso comercial del plan Hobby de Vercel ([12 §2.2](../12-costos-modelo-servicio.md)).
**En contra:** se pierde la red de distribución al borde y la optimización de
Next.js que hace Vercel; sin previews automáticas por Pull Request; un pico de
tráfico o un trabajo pesado compiten por los mismos recursos que atienden al POS.

### C · Vercel para el frontend + Railway para el worker ← **elegida**
**A favor:** cada plataforma hace lo que hace bien; aislamiento total entre la
atención al cajero y los procesos pesados; previews automáticas por PR; el worker
puede correr todo el tiempo que necesite.
**En contra:** dos plataformas que configurar y monitorear; el costo del worker
se suma.

## Decisión

**Frontend Next.js en Vercel. Worker Node con cron en Railway.**

La razón de fondo: **un respaldo que falla en silencio es peor que no tener
respaldo**, porque genera confianza injustificada. Forzar un `pg_dump` dentro de
una función serverless es exactamente el tipo de decisión que parece funcionar
durante meses y falla el día que importa.

El aislamiento tiene una segunda ventaja: si el worker se cae generando un
reporte pesado, **el local sigue vendiendo**. Los procesos administrativos nunca
compiten con la caja.

## Consecuencias

**Positivas**
- El POS y los procesos pesados no comparten recursos ni se afectan entre sí.
- Los trabajos programados corren con horario confiable en `America/Santiago`.
- El worker con `pg_dump` propio hace que el compromiso de respaldo diario sea
  **independiente del plan contratado con Supabase**. Esto permite operar en plan
  gratuito sin incumplir RF-M9-01.
- La llave `service_role` queda confinada a un único servicio, que no envía nada
  al navegador.

**Negativas**
- Dos plataformas que configurar, monitorear y pagar. Costo adicional ~$5 USD/mes.
- El orden de despliegue importa: el worker debe existir antes de que Vercel
  conozca su URL ([09 §4.4](../09-despliegue.md)).
- Hay que autenticar la comunicación entre ambos. **Mitigación:**
  `WORKER_SHARED_SECRET` en la cabecera `X-Worker-Secret`, con `/health` como
  única ruta abierta.

**Condiciona**
- El frontend nunca debe escribir la URL del worker en el código: siempre vía
  `NEXT_PUBLIC_WORKER_URL`. Así el mismo código apunta a `localhost:8080` en
  desarrollo y a Railway en producción, sin condicionales.
- Si el costo del worker corriendo 24/7 supera lo previsto, la alternativa es
  ejecutarlo por cron en lugar de proceso permanente ([12 §4](../12-costos-modelo-servicio.md)).
