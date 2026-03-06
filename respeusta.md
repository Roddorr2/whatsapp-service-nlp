# Respuestas

Respuestas concisas basadas en la implementación actual y recomendaciones operativas.

1) Tablas que "reservan cupos" — ¿ya existen? esquema / migración
- Sí: `whatsapp_campaign_reservations` existe (migración: `2026_02_25_000000_create_whatsapp_campaign_reservations_table.php`).
  - Esquema principal:
    - `id` BIGINT PK
    - `campaign_id` BIGINT NULL (nullable: null = flujo modal)
    - `date` DATE (index)
    - `reserved_slots` INT DEFAULT 0
    - `created_at`, `updated_at` TIMESTAMP
- Además añadimos campos en `modal_wats` (migración: `2026_02_26_000001_add_reservation_fields_to_modal_wats_table.php`):
  - `reservation_id` BIGINT NULL
  - `scheduled_at` TIMESTAMP NULL
  - `flow_type` VARCHAR(32) NULL
  - `campaign_id` BIGINT NULL
  - Nota: las columnas son NULLABLE; no hay FKs forzadas en la patch (se pueden añadir si se desea).

2) ¿El límite de 50 mensajes es por campaña en total, por chunk, por conexión o por unidad temporal?
- En el diseño actual el `50` es un límite diario por flujo: es un tope por día (dentro de la ventana 08:00–23:00).
- Hay límites separados por tipo de flujo: `daily_limit_campaign = 50` y `daily_limit_modal = 50`.
- No es límite por chunk ni por conexión; es un máximo agregado por día.

3) Para `send-message-image` el límite 50: ¿independiente y por reservation_id o global?
- En la implementación propuesta los límites son por `flow_type` y por fecha (dia). Por tanto:
  - Es independiente entre `campaign` y `modal` (pueden coexistir hasta sus respectivos 50/día).
  - Las reservas (`whatsapp_campaign_reservations`) se contabilizan por `date` y, cuando aplica, por `campaign_id`. Para modales `campaign_id` es NULL y se acumulan por fecha.

4) Política de reintentos
- Recomendación: máximo N = 3 reintentos.
- Aplicar reintentos sólo para errores transitorios (timeouts, 5xx, conexión). Errores permanentes (4xx válidos, número inválido) → no reintentar.

5) Idempotencia: comprobaciones y almacenamiento
- Recomendado: doble control.
  - Laravel debe comprobar y marcar estado en `modal_wats` antes de enviar (control primario).
  - El servicio externo (WhatsApp service) debe aceptar `id_modalservicio`/`wat_id` y mantener registro mínimo (`message_id`, `estado`, `timestamp`) para idempotencia y reconciliación.
  - Esto evita duplicados y facilita auditoría.

6) Notificaciones en tiempo real
- Mínimo obligatorio: devolver resumen por chunk al terminar (exitosos/fallidos/detalles).
- Opcional/altamente recomendado: webhooks configurables para eventos por mensaje

7) Reserva de cupos: comportamiento cuando no hay cupo
- Recomendación operativa (no bloquear): no mantener la petición HTTP bloqueada.
  - Planner intenta reservar en el día; si no hay cupo, calcula la siguiente fecha disponible y devuelve la planificación.
  - Respuesta HTTP sugerida: `202 Accepted` con `scheduled_for: YYYY-MM-DD` o `409/429` si quieres respuesta rápida de rechazo. Preferible 202 con fecha programada.

8) Observabilidad
- Logs estructurados por `campania_id`, `reservation_id`, `chunk_id` y traces para latencia.

9) Seguridad
- Implementación mínima: autenticación por `X-API-Key` (valor por entorno).
- Recomendación adicional: rotación de keys, lista blanca de IPs o JWT/mTLS si necesitas mayor seguridad.


---
Si quieres, ahora genero uno de los siguientes artefactos: (elige uno)
- SQL con FKs/constraints sugeridas para `modal_wats` y `whatsapp_campaign_reservations`.
- Ejemplos JSON de payloads/respuestas (success/partial/fail) para que el servicio Node implemente rutas de test.
- Cambios de migración para añadir FKs/índices adicionales.
