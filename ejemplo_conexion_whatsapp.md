# Ejemplo de Estructura de Conexión y Solicitudes a WhatsApp Service

## 1. Conexión base al socket (WebSocket)

```js
import { io } from 'socket.io-client';

const token = /* JWT obtenido de Laravel */;
const socket = io('http://localhost:5111', {
  auth: { token }, // El JWT va aquí
  transports: ['websocket', 'polling'],
});
```

---

## 2. Solicitudes HTTP protegidas (fetch/REST)

Todas las solicitudes deben llevar el header:

```
Authorization: Bearer <JWT>
```

### a) QR Status

```js
fetch('http://localhost:5111/api/whatsapp/qr-status', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  },
});
```

### b) Request New QR

```js
fetch('http://localhost:5111/api/whatsapp/qr-request', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});
```

### c) Restart

```js
fetch('http://localhost:5111/api/whatsapp/restart', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});
```

---

## Resumen
- El JWT siempre se envía en el header Authorization (Bearer).
- Para sockets, el JWT va en el campo `auth` al crear la conexión.
- Para endpoints HTTP, el JWT va en el header Authorization.
- No se usa ni expone la API Key.
