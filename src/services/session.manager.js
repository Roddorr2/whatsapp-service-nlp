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
import logger from '../utils/logger.js';
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


// CLASE PRINCIPAL: SessionManager


class SessionManager {
  
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

    logger.info('🏥 Verificando salud del servicio WhatsApp...');

    try {
      const isAvailable = await this._pingWhatsApp();
      
      if (isAvailable) {
        sessionState.whatsappServiceStatus = 'online';
        sessionState.lastHealthCheckTimestamp = Date.now();
        logger.info('✅ Servicio WhatsApp disponible');
        
        return {
          available: true,
          status: 'online',
          message: 'Servicio WhatsApp operativo'
        };
      } else {
        sessionState.whatsappServiceStatus = 'offline';
        sessionState.lastHealthCheckTimestamp = Date.now();
        logger.warn('⚠️ Servicio WhatsApp no responde');
        
        return {
          available: false,
          status: 'offline',
          message: 'Servicio WhatsApp no disponible o en mantenimiento',
          recommendation: 'Esperar antes de limpiar credenciales'
        };
      }
    } catch (error) {
      sessionState.whatsappServiceStatus = 'unknown';
      logger.error('❌ Error verificando salud de WhatsApp', { error: error.message });
      
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
        logger.warn('⏱️ Timeout en health check de WhatsApp');
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
        logger.debug('📡 WhatsApp Health Check', { 
          statusCode: res.statusCode,
          isOnline 
        });
        resolve(isOnline);
      });

      req.on('error', (error) => {
        clearTimeout(timeout);
        logger.debug('🔌 WhatsApp no alcanzable', { error: error.code });
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
        logger.info('📂 Carpeta auth_info no encontrada');
        sessionState.credentialsStatus = 'missing';
        return {
          valid: false,
          status: 'missing',
          reason: 'Carpeta auth_info no existe'
        };
      }

      // 2. Verificar que existe el archivo creds.json
      if (!fs.existsSync(credsPath)) {
        logger.warn('📄 Archivo creds.json no encontrado');
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
        logger.warn('⚠️ Archivo creds.json sospechosamente pequeño', { size: fileStats.size });
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
        logger.error('❌ Error parseando creds.json', { error: parseError.message });
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
        logger.warn('⚠️ Estructura de credenciales inválida');
        sessionState.credentialsStatus = 'invalid';
        return {
          valid: false,
          status: 'invalid',
          reason: 'Estructura de credenciales no es un objeto válido'
        };
      }

      // 6. Verificar campos esenciales (me.id indica una sesión válida)
      if (!credsParsed.me || !credsParsed.me.id) {
        logger.warn('⚠️ Credenciales incompletas - falta información del usuario');
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

      logger.info('✅ Credenciales válidas encontradas', { 
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
      logger.error('❌ Error validando credenciales', { 
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

  /**
   * Limpia credenciales corruptas (con backup de seguridad)
   * @returns {Promise<Object>} Resultado de la limpieza
   */
  async cleanupCorruptedCredentials() {
    try {
      const authPath = path.resolve(process.cwd(), CONFIG.AUTH_FOLDER);
      
      if (!fs.existsSync(authPath)) {
        logger.info('No hay carpeta auth_info para limpiar');
        return { success: true, action: 'nothing_to_clean' };
      }

      // Crear backup antes de eliminar
      const timestamp = Date.now();
      const backupPath = path.resolve(process.cwd(), `auth_info_backup_${timestamp}`);
      
      try {
        // Renombrar carpeta original a backup
        fs.renameSync(authPath, backupPath);
        logger.info('🗑️ Credenciales corruptas respaldadas', { backupPath });
        
        // Crear carpeta limpia nueva
        fs.mkdirSync(authPath, { recursive: true });
        logger.info('✅ Carpeta auth_info recreada');
        
        return {
          success: true,
          action: 'cleaned_with_backup',
          backupPath: backupPath
        };
        
      } catch (renameError) {
        logger.error('Error creando backup, intentando eliminación directa', { 
          error: renameError.message 
        });
        
        // Fallback: eliminar sin backup
        fs.rmSync(authPath, { recursive: true, force: true });
        fs.mkdirSync(authPath, { recursive: true });
        
        return {
          success: true,
          action: 'cleaned_no_backup',
          warning: 'No se pudo crear backup'
        };
      }
      
    } catch (error) {
      logger.error('❌ Error al limpiar credenciales corruptas', { 
        error: error.message,
        stack: error.stack 
      });
      
      return {
        success: false,
        action: 'cleanup_failed',
        error: error.message
      };
    }
  }

  /**
   * Registra un intento fallido de reconexión
   */
  recordFailedAttempt() {
    sessionState.consecutiveFailures++;
    logger.warn('⚠️ Intento de reconexión fallido', {
      attempt: sessionState.consecutiveFailures,
      maxAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS
    });
  }

  /**
   * Resetea el contador de fallos (llamar tras éxito)
   */
  resetFailureCounter() {
    if (sessionState.consecutiveFailures > 0) {
      logger.info('✅ Reseteando contador de fallos tras reconexión exitosa');
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
    logger.info('🔄 SessionManager: Iniciando auto-refresh de sesión');

    try {
      // PASO 1: Verificar si puede intentar reconectar
      const canAttempt = this.canAttemptReconnect();
      
      if (!canAttempt.allowed) {
        logger.warn('⛔ Auto-refresh bloqueado', { 
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

      logger.info(`📊 Intento ${canAttempt.attemptNumber} de ${canAttempt.maxAttempts}`);

      // PASO 2: Marcar inicio de operación
      this.markOperationStart();

      // PASO 3: Validar credenciales
      const validation = await this.validateCredentials();

      if (!validation.valid) {
        logger.warn('⚠️ Credenciales inválidas o faltantes', { 
          status: validation.status,
          reason: validation.reason 
        });

        // Manejar credenciales corruptas
        if (validation.status === 'corrupted' && CONFIG.AUTO_CLEAN_CORRUPTED) {
          // 🛡️ PROTECCIÓN: Verificar salud de WhatsApp antes de limpiar
          logger.info('🛡️ Verificando salud de WhatsApp antes de limpiar credenciales...');
          const healthCheck = await this.checkWhatsAppHealth();
          
          if (!healthCheck.available) {
            logger.warn('⚠️ WhatsApp no disponible - NO se limpiarán credenciales', {
              whatsappStatus: healthCheck.status,
              reason: healthCheck.message
            });
            
            this.markOperationEnd();
            
            return {
              success: false,
              status: 'whatsapp_unavailable',
              message: 'No se puede validar sesión: WhatsApp no responde. Credenciales preservadas.',
              requiresQR: false, // NO requiere QR, solo esperar
              whatsappHealth: healthCheck,
              recommendation: 'Reintentar cuando WhatsApp esté disponible'
            };
          }
          
          // WhatsApp está disponible, es seguro limpiar
          logger.info('🧹 WhatsApp disponible - Procediendo con auto-limpieza de credenciales corruptas');
          const cleanup = await this.cleanupCorruptedCredentials();
          
          this.markOperationEnd();
          
          return {
            success: false,
            status: 'credentials_cleaned',
            message: 'Credenciales corruptas eliminadas. Se requiere escanear nuevo QR.',
            requiresQR: true,
            cleanupResult: cleanup,
            whatsappHealth: healthCheck
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

      logger.info('✅ Credenciales válidas, procediendo con reconexión', {
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
        logger.info('✅ Reconexión exitosa');
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
          logger.error('⏱️ Timeout al intentar reconectar', { 
            timeout: CONFIG.RECONNECT_TIMEOUT 
          });
        } else {
          logger.error('❌ Error en reconexión', { 
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
      logger.error('❌ Error crítico en auto-refresh', { 
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
    logger.info('🔄 Estado del SessionManager reseteado');
  }
}

// ============================================
// EXPORTAR INSTANCIA SINGLETON
// ============================================

export default new SessionManager();
