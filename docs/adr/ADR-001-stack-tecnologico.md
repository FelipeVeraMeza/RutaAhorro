# ADR-001 · Stack tecnológico del frontend

**Estado:** Aceptada
**Fecha:** 2026-09-14

## Contexto

El sistema debe funcionar como aplicación web y móvil, en el celular del
trabajador, sin instalación desde una tienda de aplicaciones. Necesita acceso a
la cámara, funcionamiento sin conexión y una interfaz rápida en dispositivos de
gama media. Lo desarrolla **una sola persona**, con presupuesto operacional muy
ajustado ([12](../12-costos-modelo-servicio.md)).

## Alternativas evaluadas

### A · React + Vite (SPA), como el proyecto previo `Invetariado`
**A favor:** stack ya conocido por el equipo; build simple; despliegue trivial.
**En contra:** sin renderizado en servidor, la carga inicial es más lenta en
móvil; toda la lógica sensible vive en el cliente; hay que montar un backend
aparte para lo que no puede hacerse desde el navegador.

### B · Next.js 15 (App Router) ← **elegida**
**A favor:** componentes de servidor reducen el JavaScript enviado al celular;
route handlers evitan un backend separado para las pocas operaciones de servidor
necesarias; excelente soporte de PWA; despliegue en Vercel sin configuración.
**En contra:** mayor complejidad conceptual (servidor vs. cliente); acopla el
proyecto al ecosistema de Vercel, aunque se puede desplegar en cualquier Node.

### C · React Native / Expo (app nativa)
**A favor:** mejor acceso a la cámara; experiencia nativa.
**En contra:** obliga a publicar en App Store y Play Store, con revisiones,
cuentas de desarrollador ($25 + $99 anuales) y actualizaciones que dependen de la
aprobación de las tiendas. **Contradice el argumento comercial central: "sin
instalar nada"**. Además, el dueño necesita acceso desde el computador, lo que
exigiría mantener también una web.

### D · Flutter
**A favor:** un código para web y móvil.
**En contra:** el equipo no lo domina; el rendimiento de Flutter Web es pobre
para una aplicación con muchos formularios; comunidad menor en este dominio.

## Decisión

**Next.js 15 con App Router, TypeScript estricto, Tailwind CSS y shadcn/ui.**

Razones determinantes:

1. **Una sola base de código** sirve al celular del cajero, la tablet y el
   computador del dueño. Con un desarrollador, mantener dos bases de código no es
   una opción realista.
2. **PWA sin tiendas de aplicaciones**: se instala desde el navegador y se
   actualiza solo. Cumple literalmente lo ofrecido en la propuesta comercial y
   elimina el costo y la fricción de publicar.
3. **TypeScript estricto** es innegociable en un sistema que maneja dinero e
   inventario. Un error de tipo en el cálculo de un total es una diferencia de
   caja que alguien tendrá que explicar.
4. **shadcn/ui** entrega componentes accesibles como código propio en el
   repositorio, no como dependencia opaca: se pueden adaptar a objetivos táctiles
   de 44 px sin pelear contra la librería.

## Consecuencias

**Positivas**
- Un despliegue, tres dispositivos.
- Carga inicial liviana gracias a los componentes de servidor.
- Actualizaciones instantáneas para todos, sin intervención del cliente (RF-M9-10).

**Negativas**
- Hay que ser disciplinado con el límite servidor/cliente. Mitigación: regla de
  los tres clientes de Supabase en [07 §5](../07-arquitectura.md).
- Acceso a la cámara vía API web, menos potente que el nativo. Mitigación:
  respaldo con ZXing y búsqueda manual siempre disponible (R-05).

**Condiciona**
- Si el escaneo web resultara insuficiente en las pruebas de F2, la alternativa
  no es reescribir en nativo, sino sugerir un lector Bluetooth económico que se
  comporta como teclado.
