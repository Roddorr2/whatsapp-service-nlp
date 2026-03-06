# WhatsApp Service — Responsabilidades y contrato (resumen para implementación)

Este documento resume qué debe hacer el servicio externo de WhatsApp (Node/Baileys o servicio HTTP) según la arquitectura y tareas definidas en `tasks_whatsapp_fase0`.

## Objetivo
- Entregar mensajes enviados por la plataforma Laravel con pacing, reintentos técnicos y respuestas de estado.

## Endpoints y contratos
- POST /api/whatsapp/send-campaign-batch
  - Payload: { campania_id:int, recipients: [{ id_modalservicio?, nombre?, telefono }], metadata?: {...} }
  - Respuesta 200: { exitosos:int, fallidos:int, details?: [{telefono, status, error?}] }
  - 4xx/5xx: cuerpo con `error`.

- POST /api/whatsapp/send-modal
  - Payload: { wat_id:int, numero:string, mensaje:string, metadata? }
  - Respuesta 200: { sent:true, message_id:string }

## Requisitos funcionales
- Pacing interno: cuando recibe lote de campaña, enviar con un ritmo configurable (ej. 1 mensaje/minuto por conexión). Respetar el espaçamento pedido por Planner (2min entre chunks en Laravel).
- Idempotencia: aceptar `id_modalservicio` o `wat_id` para evitar duplicados. Rechazar reenvío si `message_id` ya existe y está en DB (Laravel mantiene estado).
- Retries técnicos: reintentar en fallos transitorios (up to N con backoff exponencial) pero devolver fallo final si imposible. Informar a Laravel con estado por lote.
- Timeouts: establecer timeout razonable (ej. 60s) por petición.

## Manejo de errores
- Respuesta debe incluir conteo de `exitosos` y `fallidos` y detalles por número.
- Para errores permanentes (número inválido), reportar en `details` y no reintentar.
- Para errores transitorios, intentar reintentos y, si falla, devolver los fallidos al caller para que Laravel marque `envios_fallidos`.

## Seguridad
- Autenticación por `X-API-Key` en cabecera.
- Validar origen y payload antes de procesar.

## Observabilidad
- Log por `campania_id` / `reservation_id` / `chunk_id` con niveles INFO/ERROR.
- Métricas expuestas: `envios_exitosos_total`, `envios_fallidos_total`, `latencia_promedio_batch`.

## Requisitos de integración con Laravel
- Recibir batch → devolver resultado rápidamente cuando posible; no bloquear eternamente.
- En caso de éxito parcial: devolver detalles para que Laravel actualice `campanias_whatsapp` y `modal_wats` (marcar enviados/errores).
- Mantener idempotencia y correlación con `id_modalservicio` y `reservation_id` enviados en metadata.

## Casos especiales
- Si servicio cae completamente: Laravel debe marcar registros como `error` y permitir reintento manual.
- Si se requiere reprogramación, Laravel planificará nuevo `scheduled_at` y despachará nuevo chunk.

## Contratos de testing
- Debe poder simular respuestas: éxito completo, parcial, y fallo para pruebas de integración.

---
Este archivo es referencia para el equipo que implementa el servicio Node/externo. Si quieres, puedo añadir ejemplos de payloads y respuesta JSON más detallados.
