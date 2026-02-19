/**
 * ============================================
 * SESSION MANAGER SERVICE
 * ============================================
 * 
 * Servicio especializado para gestionar el ciclo de vida de sesiones de WhatsApp.
 * 
 * Responsabilidades:
 * - Validación de credenciales guardadas
 * - Gestión de reintentos con backoff
 * - Limpieza de credenciales corruptas
 * - Prevención de bucles infinitos
 * - Manejo de estados de conexión
 * 
 * @module SessionManager
 */

import fs from 'fs';
import path from 'path';
// logger removed: using console for logging to keep dependency minimal
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

// CONFIGURACIÓN DESDE VARIABLES DE ENTORNO

const CONFIG = {
  AUTO_REFRESH_ENABLED: process.env.AUTO_REFRESH_SESSION === 'true',
  MAX_RECONNECT_ATTEMPTS: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '3', 10),
  RECONNECT_TIMEOUT: parseInt(process.env.RECONNECT_TIMEOUT || '30000', 10),
  RECONNECT_COOLDOWN: parseInt(process.env.RECONNECT_COOLDOWN || '10000', 10),
  AUTO_CLEAN_CORRUPTED: process.env.AUTO_CLEAN_CORRUPTED_CREDS === 'true',
  AUTH_FOLDER: 'auth_info',
  CREDS_FILE: 'creds.json',
  HEALTH_CHECK_ENABLED: process.env.WHATSAPP_HEALTH_CHECK !== 'false', // Habilitado por defecto
  HEALTH_CHECK_TIMEOUT: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000', 10)
};


//ESTADO INTERNO DEL SESSION MANAGER


const sessionState = {
  isOperationInProgress: false,
  lastAttemptTimestamp: 0,
  consecutiveFailures: 0,
  credentialsStatus: 'unknown', // unknown | valid | invalid | corrupted | missing
  lastValidationTimestamp: 0,
  whatsappServiceStatus: 'unknown', // unknown | online | offline | degraded
  lastHealthCheckTimestamp: 0
};

// Runtime helpers para debounce y coordinación de limpieza
const runtime = {
  pendingCloseTimer: null,
  lastDisconnectInfo: null,
  isClearing: false
};



// CLASE PRINCIPAL: SessionManager


class SessionManager {
  _isLogoutIndicator(lastDisconnect) {
    if (!lastDisconnect) return false;
    const msg = (lastDisconnect.error && (lastDisconnect.error.message || lastDisconnect.error.toString())) || '';
    const status = lastDisconnect.statusCode || lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.data?.reason || '';

    const indicators = [
      'logged out',
      'invalid_session',
      'authentication',
      'auth',
      'bad session',
      '401',
      '403'
    ];

    const lower = String(msg).toLowerCase();
    if (indicators.some(i => lower.includes(String(i).toLowerCase()))) return true;
    if (String(status) === '401' || String(status) === '403') return true;
    return false;
  }

  /**
   * Maneja las actualizaciones de conexión emitidas por Baileys.
   * Aplica debounce y delega a `cleanAuthIfCorrupted` cuando se confirma logout/auth-failure.
   */
  async handleConnectionUpdate(update = {}) {
    const { connection, lastDisconnect } = update;
    runtime.lastDisconnectInfo = lastDisconnect || null;

    if (connection === 'open') {
      if (runtime.pendingCloseTimer) {
        clearTimeout(runtime.pendingCloseTimer);
        runtime.pendingCloseTimer = null;
        console.info('SessionManager: connection reopened, cancelled pending clear');
      }
      return;
    }

    if (connection === 'close') {
      const isLogout = this._isLogoutIndicator(lastDisconnect);

      if (runtime.pendingCloseTimer) {
        clearTimeout(runtime.pendingCloseTimer);
        runtime.pendingCloseTimer = null;
      }

      const waitMs = isLogout ? 2000 : 30000;
      console.info('SessionManager: connection closed detected, scheduling verify', { waitMs, isLogout });

      runtime.pendingCloseTimer = setTimeout(async () => {
        try {
          runtime.pendingCloseTimer = null;
          if (runtime.isClearing) {
            console.info('SessionManager: clear already in progress, skipping');
            return;
          }
          const res = await this.cleanAuthIfCorrupted(lastDisconnect);
          if (res.cleaned) {
            console.info('SessionManager: auth cleaned by cleanAuthIfCorrupted', { result: res });
          } else {
            console.info('SessionManager: cleanAuthIfCorrupted decided not to clean', { result: res });
          }
        } catch (error) {
          console.error('SessionManager: error in scheduled verify', { error: error.message });
        }
      }, waitMs);
    }
  }

  
  /**
   * Verifica si el servicio de WhatsApp está disponible
   * Previene falsos positivos cuando WhatsApp está caído
   * @returns {Promise<Object>} Estado del servicio
   */
  async checkWhatsAppHealth() {
    if (!CONFIG.HEALTH_CHECK_ENABLED) {
      return { 
        available: true, 
        status: 'check_disabled',
        message: 'Health check deshabilitado'
      };
    }

    console.info('🏥 Verificando salud del servicio WhatsApp...');

    try {
      const isAvailable = await this._pingWhatsApp();
      
      if (isAvailable) {
        sessionState.whatsappServiceStatus = 'online';
        sessionState.lastHealthCheckTimestamp = Date.now();
        console.info('✅ Servicio WhatsApp disponible');
        
        return {
          available: true,
          status: 'online',
          message: 'Servicio WhatsApp operativo'
        };
      } else {
        sessionState.whatsappServiceStatus = 'offline';
        sessionState.lastHealthCheckTimestamp = Date.now();
        console.warn('⚠️ Servicio WhatsApp no responde');
        
        return {
          available: false,
          status: 'offline',
          message: 'Servicio WhatsApp no disponible o en mantenimiento',
          recommendation: 'Esperar antes de limpiar credenciales'
        };
      }
    } catch (error) {
      sessionState.whatsappServiceStatus = 'unknown';
      console.error('❌ Error verificando salud de WhatsApp', { error: error.message });
      
      return {
        available: false,
        status: 'unknown',
        message: 'No se pudo verificar estado del servicio',
        error: error.message,
        recommendation: 'Asumir servicio caído, no limpiar credenciales'
      };
    }
  }

  /**
   * Hace ping a WhatsApp Web para verificar disponibilidad
   * @private
   * @returns {Promise<boolean>}
   */
  _pingWhatsApp() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('⏱️ Timeout en health check de WhatsApp');
        resolve(false);
      }, CONFIG.HEALTH_CHECK_TIMEOUT);

      const options = {
        hostname: 'web.whatsapp.com',
        port: 443,
        path: '/',
        method: 'HEAD',
        timeout: CONFIG.HEALTH_CHECK_TIMEOUT
      };

      const req = https.request(options, (res) => {
        clearTimeout(timeout);
        // Cualquier respuesta (incluso 404) significa que el servicio está activo
        const isOnline = res.statusCode >= 200 && res.statusCode < 500;
        console.debug('📡 WhatsApp Health Check', { 
          statusCode: res.statusCode,
          isOnline 
        });
        resolve(isOnline);
      });

      req.on('error', (error) => {
        clearTimeout(timeout);
        console.debug('🔌 WhatsApp no alcanzable', { error: error.code });
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        clearTimeout(timeout);
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Verifica si las credenciales guardadas existen y son válidas
   * @returns {Promise<Object>} Estado de las credenciales
   */
  async validateCredentials() {
    try {
      const authPath = path.resolve(process.cwd(), CONFIG.AUTH_FOLDER);
      const credsPath = path.join(authPath, CONFIG.CREDS_FILE);

      // 1. Verificar que existe la carpeta auth_info
      if (!fs.existsSync(authPath)) {
        console.info('📂 Carpeta auth_info no encontrada');
        sessionState.credentialsStatus = 'missing';
        return {
          valid: false,
          status: 'missing',
          reason: 'Carpeta auth_info no existe'
        };
      }

      // 2. Verificar que existe el archivo creds.json
      if (!fs.existsSync(credsPath)) {
        console.warn('📄 Archivo creds.json no encontrado');
        sessionState.credentialsStatus = 'missing';
        return {
          valid: false,
          status: 'missing',
          reason: 'Archivo creds.json no existe'
        };
      }

      // 3. Leer y validar contenido del archivo
      const fileStats = fs.statSync(credsPath);
      
      // Verificar tamaño mínimo (archivos vacíos o muy pequeños son sospechosos)
      if (fileStats.size < 50) {
        console.warn('⚠️ Archivo creds.json sospechosamente pequeño', { size: fileStats.size });
        sessionState.credentialsStatus = 'corrupted';
        return {
          valid: false,
          status: 'corrupted',
          reason: 'Archivo creds.json demasiado pequeño',
          size: fileStats.size
        };
      }

      // 4. Intentar parsear como JSON
      let credsContent;
      let credsParsed;
      
      try {
        credsContent = fs.readFileSync(credsPath, 'utf-8');
        credsParsed = JSON.parse(credsContent);
      } catch (parseError) {
        console.error('❌ Error parseando creds.json', { error: parseError.message });
        sessionState.credentialsStatus = 'corrupted';
        return {
          valid: false,
          status: 'corrupted',
          reason: 'Archivo creds.json no es JSON válido',
          error: parseError.message
        };
      }

      // 5. Validar estructura mínima requerida
      if (!credsParsed || typeof credsParsed !== 'object') {
        console.warn('⚠️ Estructura de credenciales inválida');
        sessionState.credentialsStatus = 'invalid';
        return {
          valid: false,
          status: 'invalid',
          reason: 'Estructura de credenciales no es un objeto válido'
        };
      }

      // 6. Verificar campos esenciales (me.id indica una sesión válida)
      if (!credsParsed.me || !credsParsed.me.id) {
        console.warn('⚠️ Credenciales incompletas - falta información del usuario');
        sessionState.credentialsStatus = 'invalid';
        return {
          valid: false,
          status: 'invalid',
          reason: 'Faltan campos esenciales (me.id)'
        };
      }

      // 7. Contar archivos de sesión adicionales
      const files = fs.readdirSync(authPath);
      const sessionFiles = files.filter(f => 
        f.startsWith('app-state-sync-key-') || 
        f.startsWith('session-') ||
        f === 'creds.json'
      );

      console.info('✅ Credenciales válidas encontradas', { 
        userId: credsParsed.me.id,
        sessionFiles: sessionFiles.length,
        size: fileStats.size 
      });

      sessionState.credentialsStatus = 'valid';
      sessionState.lastValidationTimestamp = Date.now();

      return {
        valid: true,
        status: 'valid',
        userId: credsParsed.me.id,
        sessionFiles: sessionFiles.length,
        lastModified: fileStats.mtime
      };

    } catch (error) {
      console.error('❌ Error validando credenciales', { 
        error: error.message,
        stack: error.stack 
      });
      
      sessionState.credentialsStatus = 'corrupted';
      
      return {
        valid: false,
        status: 'error',
        reason: 'Error al validar credenciales',
        error: error.message
      };
    }
  }

  /**
   * Verifica si se puede intentar reconectar (guardianes de seguridad)
   * @returns {Object} Resultado de la verificación
   */
  canAttemptReconnect() {
    // GUARDIÁN 1: Verificar si está habilitado
    if (!CONFIG.AUTO_REFRESH_ENABLED) {
      return {
        allowed: false,
        reason: 'Auto-refresh deshabilitado en configuración',
        code: 'DISABLED'
      };
    }

    // GUARDIÁN 2: Prevenir múltiples operaciones simultáneas
    if (sessionState.isOperationInProgress) {
      return {
        allowed: false,
        reason: 'Ya hay una operación de reconexión en progreso',
        code: 'IN_PROGRESS'
      };
    }

    // GUARDIÁN 3: Cooldown entre intentos
    const timeSinceLastAttempt = Date.now() - sessionState.lastAttemptTimestamp;
    if (timeSinceLastAttempt < CONFIG.RECONNECT_COOLDOWN) {
      const waitTime = Math.ceil((CONFIG.RECONNECT_COOLDOWN - timeSinceLastAttempt) / 1000);
      return {
        allowed: false,
        reason: `Debe esperar ${waitTime} segundos entre intentos`,
        code: 'COOLDOWN',
        waitSeconds: waitTime
      };
    }

    // GUARDIÁN 4: Límite de fallos consecutivos
    if (sessionState.consecutiveFailures >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      return {
        allowed: false,
        reason: `Límite de ${CONFIG.MAX_RECONNECT_ATTEMPTS} intentos fallidos alcanzado`,
        code: 'MAX_ATTEMPTS_REACHED',
        requiresManualIntervention: true
      };
    }

    // Todo OK, puede intentar
    return {
      allowed: true,
      attemptNumber: sessionState.consecutiveFailures + 1,
      maxAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS
    };
  }

  // Nota: La función de limpieza automática de credenciales corruptas fue eliminada
  // para evitar borrados automáticos del directorio `auth_info`. Si se detectan
  // credenciales corruptas, se requiere intervención manual (restore/endpoint).

  /**
   * Registra un intento fallido de reconexión
   */
  recordFailedAttempt() {
    sessionState.consecutiveFailures++;
    console.warn('⚠️ Intento de reconexión fallido', {
      attempt: sessionState.consecutiveFailures,
      maxAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS
    });
  }

  /**
   * Resetea el contador de fallos (llamar tras éxito)
   */
  resetFailureCounter() {
    if (sessionState.consecutiveFailures > 0) {
      console.info('✅ Reseteando contador de fallos tras reconexión exitosa');
    }
    sessionState.consecutiveFailures = 0;
  }

  /**
   * Marca el inicio de una operación
   */
  markOperationStart() {
    sessionState.isOperationInProgress = true;
    sessionState.lastAttemptTimestamp = Date.now();
  }

  /**
   * Marca el fin de una operación
   */
  markOperationEnd() {
    sessionState.isOperationInProgress = false;
  }

  /**
   * Obtiene el estado actual del session manager
   * @returns {Object} Estado actual
   */
  getStatus() {
    return {
      config: {
        autoRefreshEnabled: CONFIG.AUTO_REFRESH_ENABLED,
        maxAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS,
        timeout: CONFIG.RECONNECT_TIMEOUT,
        cooldown: CONFIG.RECONNECT_COOLDOWN,
        autoCleanCorrupted: CONFIG.AUTO_CLEAN_CORRUPTED,
        healthCheckEnabled: CONFIG.HEALTH_CHECK_ENABLED,
        healthCheckTimeout: CONFIG.HEALTH_CHECK_TIMEOUT
      },
      state: {
        isOperationInProgress: sessionState.isOperationInProgress,
        consecutiveFailures: sessionState.consecutiveFailures,
        credentialsStatus: sessionState.credentialsStatus,
        lastAttemptTimestamp: sessionState.lastAttemptTimestamp,
        lastValidationTimestamp: sessionState.lastValidationTimestamp,
        whatsappServiceStatus: sessionState.whatsappServiceStatus,
        lastHealthCheckTimestamp: sessionState.lastHealthCheckTimestamp
      },
      canAttempt: this.canAttemptReconnect()
    };
  }

  /**
   * Ejecuta el flujo completo de auto-refresh de sesión
   * @param {Function} reconnectCallback - Función del whatsapp.service para reconectar
   * @returns {Promise<Object>} Resultado de la operación
   */
  async autoRefreshSession(reconnectCallback) {
    console.info('🔄 SessionManager: Iniciando auto-refresh de sesión');

    try {
      // PASO 1: Verificar si puede intentar reconectar
      const canAttempt = this.canAttemptReconnect();
      
      if (!canAttempt.allowed) {
        console.warn('⛔ Auto-refresh bloqueado', { 
          reason: canAttempt.reason,
          code: canAttempt.code 
        });
        
        return {
          success: false,
          status: canAttempt.code.toLowerCase(),
          message: canAttempt.reason,
          requiresManualIntervention: canAttempt.requiresManualIntervention,
          waitSeconds: canAttempt.waitSeconds
        };
      }

      console.info(`📊 Intento ${canAttempt.attemptNumber} de ${canAttempt.maxAttempts}`);

      // PASO 2: Marcar inicio de operación
      this.markOperationStart();

      // PASO 3: Validar credenciales
      const validation = await this.validateCredentials();

      if (!validation.valid) {
        console.warn('⚠️ Credenciales inválidas o faltantes', { 
          status: validation.status,
          reason: validation.reason 
        });

        // Manejar credenciales corruptas: no se realiza limpieza automática
        if (validation.status === 'corrupted') {
          console.warn('⚠️ Credenciales corruptas detectadas - se requiere intervención manual', {
            reason: validation.reason
          });

          this.markOperationEnd();

          return {
            success: false,
            status: 'corrupted',
            message: 'Credenciales corruptas detectadas. Requiere intervención manual (restaurar backup o usar endpoint admin).',
            requiresManualIntervention: true,
            requiresQR: true,
            validation: validation
          };
        }

        this.markOperationEnd();

        return {
          success: false,
          status: validation.status,
          message: validation.reason,
          requiresQR: true,
          validation: validation
        };
      }

      console.info('✅ Credenciales válidas, procediendo con reconexión', {
        userId: validation.userId
      });

      // PASO 4: Intentar reconexión con timeout
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), CONFIG.RECONNECT_TIMEOUT)
        );

        const reconnectPromise = reconnectCallback();

        // Race: lo que termine primero
        const result = await Promise.race([reconnectPromise, timeoutPromise]);

        // PASO 5: Reconexión exitosa
        console.info('✅ Reconexión exitosa');
        this.resetFailureCounter();
        this.markOperationEnd();

        return {
          success: true,
          status: 'connected',
          message: 'Sesión reconectada exitosamente',
          validation: validation,
          result: result
        };

      } catch (reconnectError) {
        // PASO 6: Manejo de errores de reconexión
        if (reconnectError.message === 'TIMEOUT') {
          console.error('⏱️ Timeout al intentar reconectar', { 
            timeout: CONFIG.RECONNECT_TIMEOUT 
          });
        } else {
          console.error('❌ Error en reconexión', { 
            error: reconnectError.message,
            stack: reconnectError.stack 
          });
        }

        this.recordFailedAttempt();
        this.markOperationEnd();

        return {
          success: false,
          status: 'reconnection_failed',
          message: `Error al reconectar: ${reconnectError.message}`,
          error: reconnectError.message,
          requiresQR: true,
          attemptsRemaining: CONFIG.MAX_RECONNECT_ATTEMPTS - sessionState.consecutiveFailures
        };
      }

    } catch (error) {
      console.error('❌ Error crítico en auto-refresh', { 
        error: error.message,
        stack: error.stack 
      });

      this.markOperationEnd();

      return {
        success: false,
        status: 'critical_error',
        message: `Error crítico: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Resetea completamente el estado del session manager
   * Útil para testing o recuperación manual
   */
  resetState() {
    sessionState.isOperationInProgress = false;
    sessionState.lastAttemptTimestamp = 0;
    sessionState.consecutiveFailures = 0;
    sessionState.credentialsStatus = 'unknown';
    sessionState.lastValidationTimestamp = 0;
    sessionState.whatsappServiceStatus = 'unknown';
    sessionState.lastHealthCheckTimestamp = 0;
    console.info('🔄 Estado del SessionManager reseteado');
  }

  /**
   * Elimina el folder `auth_info` de forma segura cuando se detecta
   * que la desconexión fue causada por credenciales corruptas o fallas
   * de autenticación (por ejemplo, 401). Esta operación solo se ejecuta
   * si `AUTO_CLEAN_CORRUPTED` está activado en configuración.
   * @param {Object} lastDisconnect
   * @returns {Object} resultado
   */
  async cleanAuthIfCorrupted(lastDisconnect) {
    try {
      if (!CONFIG.AUTO_CLEAN_CORRUPTED) {
        return { cleaned: false, reason: 'auto_clean_disabled' };
      }

      if (!lastDisconnect) {
        return { cleaned: false, reason: 'no_disconnect_info' };
      }

      const err = lastDisconnect.error || lastDisconnect;

      // Detectar señales típicas de fallo de autenticación / credenciales o logout desde cliente
      const statusCode = err?.statusCode || err?.output?.statusCode || err?.data?.reason || null;
      const message = String(err?.message || err?.output?.payload?.message || '').toLowerCase();

      const authFailure = (
        statusCode === 401 ||
        String(statusCode) === '401' ||
        message.includes('unauthorized') ||
        message.includes('connection failure') ||
        message.includes('invalid') ||
        message.includes('credentials') ||
        err?.data?.reason === '401'
      );

      // También consideramos explícitamente señales de "logout" detectadas por _isLogoutIndicator
      const isLogout = this._isLogoutIndicator(lastDisconnect);

      if (!authFailure && !isLogout) {
        return { cleaned: false, reason: 'not_auth_failure_or_logout' };
      }

      const authPath = path.resolve(process.cwd(), CONFIG.AUTH_FOLDER);
      if (!fs.existsSync(authPath)) {
        console.info('🗂️ auth_info no existe, nada que limpiar');
        return { cleaned: false, reason: 'auth_missing' };
      }

      // Eliminar de forma segura todos los ficheros y subdirectorios dentro de auth_info
      // (conservar la carpeta `auth_info` en sí misma).
      console.warn('🧹 AUTO CLEAN: Limpiando contenido de auth_info por fallo de autenticación', { authPath });
      try {
        const entries = fs.readdirSync(authPath, { withFileTypes: true });

        for (const entry of entries) {
          const target = path.join(authPath, entry.name);
          try {
            fs.rmSync(target, { recursive: true, force: true });
            console.info('🗑️ Eliminado', { path: target });
          } catch (entryErr) {
            console.warn('⚠️ No se pudo eliminar entrada dentro de auth_info', { path: target, error: entryErr.message });
          }
        }

        console.info('✅ auth_info limpiado correctamente (contenido eliminado)');
        return { cleaned: true, reason: 'cleaned_by_auto' };
      } catch (rmErr) {
        console.error('❌ Error limpiando auth_info en auto-clean', { error: rmErr.message });
        return { cleaned: false, reason: 'rm_error', error: rmErr.message };
      }
    } catch (error) {
      console.error('❌ Error en cleanAuthIfCorrupted', { error: error.message });
      return { cleaned: false, reason: 'exception', error: error.message };
    }
  }
}


export default new SessionManager();
