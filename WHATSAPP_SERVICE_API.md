## WhatsApp Service API — Contrato para integración con backend Laravel

Actualización: este documento especifica los nombres de campo como están definidos en las migraciones y la API expuesta actualmente por el servidor. Se incluyen alias aceptados (camelCase) para compatibilidad con proveedores.

Resumen
- Endpoint principal que el proveedor debe implementar para recibir lotes (chunks) enviados por nuestro orquestador: `POST /api/whatsapp/send-campaign-batch` (nota: el servidor actual expone esta ruta en `message.routes.js`).
- Endpoint público para activar una campaña desde frontend/cliente: `POST /api/whatsapp/activate` (según el payload que nos indicaste).
- Webhook que el proveedor debe invocar para informar estados finales: `POST /api/whatsapp/webhook/status`.
- Autenticación requerida en todas las llamadas: cabecera `X-API-Key: <secret>`.

Principios
- El backend (Laravel) planifica y persiste `whatsapp_chunks` (cada chunk referencia una `campania`).
- El servicio WhatsApp recibe un chunk (con `campania_id`/`campaign_id` y `chunk_id`/`chunk_number`) y debe procesarlo; puede hacerlo síncrono o asíncrono.
- El webhook que envía el servicio es la fuente de la verdad para estados finales (sent, delivered, failed). La respuesta del envío no sustituye al webhook.

Contrato: POST /api/whatsapp/send-campaign-batch

Headers
- `Content-Type: application/json`
- `X-API-Key: <api-key>` (obligatorio)

Request body (JSON)
```json
{
  "campania_id": 123,           // alias: campaign_id
  "chunk_id": 987,              // alias: chunk_number
  "id_servicio": 1,             // el id del producto/servicio local
  "parrafo": "Texto del mensaje",
  "imagen_url": "https://...cloudinary...",
  "recipients": [
    {"id_modalservicio": 1, "telefono": "51933946247"},
    {"id_modalservicio": 5, "telefono": "51912345678"}
  ]
}
```

Notas sobre el request
- Los nombres de columna en la DB son: `campanias_whatsapp.id_campania`, `campanias_whatsapp.id_servicio`, y en `modalservicios` la PK es `id_modalservicio`. El proveedor debe incluir `id_modalservicio` por destinatario para que el backend pueda mapear idempotentemente.
- Aceptamos aliases en camelCase: `campaign_id` ↔ `campania_id`, `chunk_number` ↔ `chunk_id`, `imageUrl` ↔ `imagen_url`, `message` ↔ `parrafo`.
- `recipients.length` debe respetar el `chunk_size` configurado por el backend (p.ej. 20).

Respuesta síncrona (cuando el proveedor procesa en línea)
```json
HTTP/1.1 200 OK
{
  "success": true,
  "failed": 0,
  "results": [
    {"id_modalservicio":1,"provider_message_id":"m-abc123","status":"sent"},
    {"id_modalservicio":5,"provider_message_id":"m-abc124","status":"sent"}
  ]
}
```

Respuesta asíncrona aceptada
```json
HTTP/1.1 202 Accepted
{
  "success": true,
  "request_id": "req-xyz",
  "message": "Processing asynchronously; results will arrive via webhooks"
}
```

Errores
- `401 Unauthorized` si `X-API-Key` inválida.
- `400 Bad Request` para payload inválido.
- `429 Too Many Requests` con `Retry-After` si hay rate limiting.
- `5xx` para errores del proveedor (el backend puede reintentar con backoff si aplica).

Webhooks: POST /api/whatsapp/webhook/status

Headers
- `Content-Type: application/json`
- `X-API-Key: <api-key>` (obligatorio)
- (Opcional) `X-Signature`: HMAC para verificar autenticidad

Payloads aceptables

- Evento por mensaje (uno a uno):
```json
{
  "chunk_id": 987,
  "campania_id": 123,
  "id_modalservicio": 1,
  "provider_message_id": "provider-msg-abc123",
  "status": "sent",            // sent | delivered | failed | undelivered
  "error": null,
  "sentAt": "2026-03-06T12:00:00Z"
}
```

- Resumen por chunk (batch result):
```json
{
  "chunk_id": 987,
  "campania_id": 123,
  "results": [
    {"id_modalservicio":1,"provider_message_id":"m-1","status":"delivered"},
    {"id_modalservicio":5,"status":"failed","error":"invalid_number"}
  ],
  "status": "partial|completed"
}
```

Requisitos sobre webhooks
- Incluir siempre `id_modalservicio` y `campania_id` o `chunk_id` para rastrear la fila local.
- Incluir `provider_message_id` del proveedor cuando esté disponible.
- El backend debe procesar webhooks idempotentemente: si recibe el mismo `provider_message_id`/`id_modalservicio` repetido, debe ignorarlo o actualizar sin duplicar contadores.

Comportamiento recomendado del backend (Laravel)
- Cuando el orquestador envía un chunk:
  - Si la respuesta es 200 con `results`: marque `whatsapp_chunks.status = sent` y guarde cualquier `provider_message_id` informado; pero NO actualizar los contadores finales (`envios_exitosos`/`envios_fallidos`) hasta recibir webhooks.
  - Si la respuesta es 202 (async): marque `status = processing` y espere webhooks para marcar `completed`.
- Cuando llegue un webhook:
  - Persistir raw event en la tabla `whatsapp_webhook_events`.
  - Encolar job `ProcessWhatsappStatus` para actualizar `modal_wats` y `campanias_whatsapp` de forma idempotente.
  - Si un evento indica `failed` y `attempts < max_attempts`, crear un nuevo `whatsapp_chunks` de retry (con `parent_chunk_id`) y reservar slots acorde — las reglas de reintento deben consumir el presupuesto permitido y no repetir envíos confirmados.

Idempotencia y reintentos
- El proveedor puede reintentar webhooks; el backend debe detectar duplicados por `provider_message_id` o por combinación (`campania_id`, `chunk_id`, `id_modalservicio`, `status`) y procesar sólo cambios de estado válidos.
- Los reintentos de envío (por fallo) deben crearse en el backend sólo tras recibir webhook de fallo; no confiar en que el proveedor reenvíe automáticamente mensajes fallidos y actualice contadores.

Seguridad y operativa
- Mantener `X-API-Key` compartida y rotable. Para mayor seguridad, admitir firma HMAC en webhooks.
- Exponer cabeceras de rate-limit y respetar `Retry-After`.
- Registrar `chunk_id` y `campania_id` en logs y en las respuestas para trazabilidad.

Ejemplos mínimos (curl)

- Enviar batch (ruta real que el servidor expone):
```bash
curl -X POST https://whatsapp.service/api/whatsapp/send-campaign-batch \
  -H "X-API-Key: S3CR3T" \
  -H "Content-Type: application/json" \
  -d '{"campania_id":123,"chunk_id":987,"recipients":[{"id_modalservicio":1,"telefono":"519..."}],"parrafo":"Hola","imagen_url":"https://..."}'
```

- Webhook (ejemplo que el proveedor llamaría a nuestro backend):
```bash
curl -X POST https://our.backend/api/whatsapp/webhook/status \
  -H "X-API-Key: S3CR3T" \
  -H "Content-Type: application/json" \
  -d '{"chunk_id":987,"campania_id":123,"id_modalservicio":1,"provider_message_id":"m-1","status":"delivered","sentAt":"2026-03-06T12:00:00Z"}'
```

Endpoint de activación (frontend → backend)

El frontend que crea/activa campañas POSTea a:

```bash
POST https://our.backend/api/whatsapp/activate
```

Payload mínimo aceptado por el controlador de activación (ejemplo):
```json
{
  "id_servicio": 1,
  "parrafo": "Texto del mensaje",
  "imagen_url": "https://...",
  "recipients": [ {"id_modalservicio":1}, {"id_modalservicio":2} ]
}
```

Checklist de implementación para el servicio WhatsApp
- Implementar `POST /api/whatsapp/send-campaign-batch` y devolver por-recipient `provider_message_id` cuando sea posible.
- Emitir webhooks detallados por mensaje o resumen de chunk con `id_modalservicio` y `campania_id`/`chunk_id`.
- Proteger endpoints con `X-API-Key` y (opcional) firma HMAC para webhooks.
- Respetar `chunk_size` y no aceptar más destinatarios por petición que el límite acordado.
- Documentar ejemplos y respuestas de error.

Si quieres, genero un ejemplo de servidor Node/Express que implemente `send-campaign-batch` + webhook simulator (útil para pruebas locales).

*** Fin de la especificación ***
