# Eliminación y manejo de `auth_info` (especificación para replicar)

Este documento describe cómo detectar y procesar el cierre de sesión desde el cliente (p. ej. mobile), y cómo limpiar de forma segura el contenido de la carpeta `auth_info` para poder replicar este comportamiento en otro proyecto.

## Propósito

- Explicar el flujo actual de detección de logout e invalidación de credenciales.
- Proveer un procedimiento reproducible para eliminar/respaldar `auth_info` cuando la sesión se cierra en el cliente.
- Incluir ejemplos de integración y pruebas para replicar en otro proyecto.

## Archivos relevantes (en este repositorio)

- [src/services/session.manager.js](src/services/session.manager.js#L1-L200) — lógica de verificación y debounce tras `connection.update`.
- [src/triggers/clearAuthTrigger.js](src/triggers/clearAuthTrigger.js#L1-L80) — utilidad que elimina el contenido de `auth_info`.
- [src/services/whatsapp.service.js](src/services/whatsapp.service.js#L1-L140) — crea la sesión Baileys y delega `connection.update` al `SessionManager`.
- [test-delete.js](test-delete.js#L1-L120) — script de prueba que limpia `auth_info` localmente.

> Nota: `auth_info` es el directorio donde `useMultiFileAuthState` de Baileys guarda `creds.json`, keys y metadatos. Eliminarlo obliga a re-escanear QR.

## Resumen del flujo de detección y decisión

1. Baileys emite `connection.update` con `connection: 'close'` y un `lastDisconnect` con causa.
2. El servicio (`whatsapp.service`) delega la actualización a `SessionManager.handleConnectionUpdate(update)`.
3. `SessionManager`:
   - Analiza `lastDisconnect` con `_isLogoutIndicator()` buscando indicadores (`logged out`, `invalid_session`, `401`, `403`, `Bad session`, etc.).
   - Aplica un debounce antes de verificar (p. ej. 2s si parece logout, o 30s por defecto) para evitar falsos positivos.
   - Ejecuta `_verifyAndMaybeClear()` que llama a `validateCredentials()` para comprobar `auth_info/creds.json`.
   - Si las credenciales son inválidas y se confirma logout, se debe proceder a limpiar `auth_info`.

Actualmente en este repo existe `clearAuthContent()` que borra `auth_info`, pero no está integrada automáticamente dentro de `SessionManager._verifyAndMaybeClear()` — por lo tanto la eliminación no ocurre a menos que se invoque manualmente.

## Recomendación de integración (segura)

1. Añadir un punto de integración en `SessionManager._verifyAndMaybeClear()` para llamar a la rutina de limpieza tras comprobar invalidación y corroborar indicadores de logout.
2. Antes de eliminar, cerrar ordenadamente el socket (ej. llamar a `cleanupConnection()` en el servicio de conexión) o usar un evento para coordinar el cierre.
3. Hacer backup opcional: mover `creds.json` a `auth_info/backups/<timestamp>/` antes de borrar — útil para diagnóstico.
4. Marcar una bandera (`runtime.isClearing`) para prevenir operaciones concurrentes y reintentos automáticos durante la limpieza.

### Fragmento de integración sugerido

Este ejemplo muestra la idea general (adaptar rutas/imports según tu proyecto):

```javascript
import { clearAuthContent } from '../triggers/clearAuthTrigger.js';
// si necesitas cerrar el socket, coordinar con whatsapp.service (exponer cleanupConnection o emitir evento)

async _verifyAndMaybeClear(lastDisconnect) {
  // ...validaciones/retries existentes...
  const val = await this.validateCredentials();
  if (!val.valid && this._isLogoutIndicator(lastDisconnect)) {
    runtime.isClearing = true;
    try {
      // pedir cierre ordenado del socket (ejemplo: emit 'request-cleanup')
      // await someCleanupFunction();
      // backup opcional
      // await backupAuthInfo();
      clearAuthContent();
      logger.info('auth_info cleared after logout detected');
    } finally {
      runtime.isClearing = false;
    }
  }
}
```



## Pruebas y verificación

- Probar localmente con `node test-delete.js` para verificar la rutina de borrado manual.
- Simular `connection.update` con `lastDisconnect` que contenga `401`/`logged out` y confirmar que `SessionManager` detecta la condición.
- Verificar que tras la limpieza la aplicación solicita nuevo QR y no intenta reconectar automáticamente sin intervención si así se desea.

Comandos útiles:

```powershell
node test-delete.js
# luego arrancar servicio y forzar logout desde cliente mobile
```


## Checklist para replicar en otro proyecto

- Copiar `clearAuthTrigger.js` y el README.
- Asegurar que la capa que gestiona `connection.update` delega a un `SessionManager` o equivalente.
- Implementar el paso de confirmación y backup antes de borrado.
- Añadir logs claros y tests que simulen `lastDisconnect` con códigos 401/403.

---

Si quieres, aplico los cambios aquí para integrar la llamada a `clearAuthContent()` en `SessionManager` y coordinar el cierre ordenado del socket, además de crear el endpoint de administración y pruebas unitarias.
