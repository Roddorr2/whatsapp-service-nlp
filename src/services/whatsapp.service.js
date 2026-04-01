import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { interpolateMessage } from '../utils/messageUtils.js';
import { normalizePhone } from '../utils/normalizePhone.js';
import whatsappSessionLogger from '../utils/whatsappSessionLogger.js';
// Use console as fallback logger to avoid the custom logger dependency
const logger = console;
import { emitQrStatusUpdate } from '../app.js';
import { getWhatsAppConfig } from '../config/whatsapp.config.js';
//import { chatbotFlow } from '../chatbot/chatbotFlow.js';  # se ha deshabilitado el chatbot para este servicio
import sessionManager from './session.manager.js';
import { clearAuthContent } from '../triggers/clearAuthTrigger.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', {
    reason: reason?.message || reason,
    promise: promise,
    timestamp: new Date().toISOString()
  });
});

const connectionState = {
  socket: null,
  qrData: null,
  isConnecting: false,
  userConnections: new Map(),
  sentMessages: [],
  connectionStatus: 'disconnected',
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectTimer: null,
  isReconnecting: false,
  lastConnectionAttempt: 0,
  
  // Estado para health checks con backoff
  healthCheckAttempts: 0,
  lastHealthCheckTimestamp: 0,
  lastHealthCheckResult: null,
  healthCheckCacheDuration: 45000, // Cache de 45 segundos (más agresivo para evitar spam)

  //conversations: new Map(), // key: userId, value: { step: number, context: any }
};


function handleIncomingMessage(userId, message) {
  // let conv = connectionState.conversations.get(userId);
  // const now = Date.now();

  // if (!conv) {
  //   conv = { step: "start", lastInteraction: now, timeout: null };
  //   connectionState.conversations.set(userId, conv);
  //   return chatbotFlow.start.message;
  // }

  // if (conv.timeout) {
  //   clearTimeout(conv.timeout);
  // }

  // const currentStep = chatbotFlow[conv.step];
  // const option = message.trim();

  // if (currentStep.next[option]) {
  //   const nextStep = currentStep.next[option];
  //   const nextFlow = chatbotFlow[nextStep];

  //   if (nextStep === "cierre") {
  //     connectionState.socket.sendMessage(userId, { text: nextFlow.message });
  //     connectionState.conversations.delete(userId);
  //     return;
  //   }

  //   if (Object.keys(nextFlow.next).length === 0) {
  //     connectionState.socket.sendMessage(userId, { text: nextFlow.message });

  //     setTimeout(() => {
  //       connectionState.socket.sendMessage(userId, {
  //         text: "✅ Gracias por tu interés, un asesor se pondrá en contacto contigo."
  //       });
  //       connectionState.conversations.delete(userId);
  //     }, 1500); 

  //     return; 
  //   }

  //   conv.timeout = setTimeout(() => {
  //     connectionState.socket.sendMessage(userId, {
  //       text: "⌛ Como no interactuaste en el último minuto, voy a cerrar esta conversación.\n\n¡Hasta luego! 👋"
  //     });
  //     connectionState.conversations.delete(userId);
  //   }, 60 * 1000);

  //   connectionState.conversations.set(userId, { ...conv, step: nextStep });
  //   return nextFlow.message;
  // }

  // // 🚫 Si la opción no es válida
  // connectionState.conversations.set(userId, conv);
  // return `❌ Opción no válida.\n\n${currentStep.message}`;

  return null; // Chatbot deshabilitado
}

// // Notificar al backend (Laravel) vía webhook para monitoreo de campañas
// async function notifyBackendStatus(payload) {
//   const mainBackendUrl = process.env.MAIN_BACKEND_URL;
//   if (!mainBackendUrl) {
//     console.warn('MAIN_BACKEND_URL no configurado — se omite notificación al backend');
//     return;
//   }

//   const webhookUrl = `${mainBackendUrl.replace(/\/$/, '')}/api/whatsapp/webhook/status`;
//   const headers = {
//     'Content-Type': 'application/json'
//   };
//   if (process.env.WEBHOOK_API_KEY) headers['X-API-Key'] = process.env.WEBHOOK_API_KEY;

//   const maxAttempts = 3;
//   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//     try {
//       const resp = await fetch(webhookUrl, {
//         method: 'POST',
//         headers,
//         body: JSON.stringify(payload)
//       });

//       if (resp.ok) {
//         console.log(`✅ Webhook enviado al backend (${webhookUrl})`);
//         return;
//       }

//       const text = await resp.text();
//       console.error(`⚠️ Webhook fallido (${resp.status}): ${text}`);
//     } catch (err) {
//       console.error('⚠️ Error enviando webhook al backend:', err.message || err);
//     }

//     // Backoff simple
//     const backoffMs = attempt * 2000;
//     await new Promise(r => setTimeout(r, backoffMs));
//   }

//   console.error('❌ No se pudo entregar el webhook al backend tras varios intentos');
// }



export async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    mediaTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    ws: {
      timeout: 60000,
      keepalive: true,
      keepaliveInterval: 15000,
    },
  });

  sock.ev.on('connection.update', (update) => {
  const { connection, lastDisconnect } = update;
  console.log("📡 Estado de conexión:", connection);

  if (connection === 'open') {
    console.log("✅ Bot conectado correctamente a WhatsApp");
  } else if (connection === 'close') {
    console.log("❌ Se cerró la conexión:", lastDisconnect?.error);
  }
});

  connectionState.socket = sock;

  // 🔹 Ahora sí registramos los eventos
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message?.conversation || msg.key.fromMe) return;

    const userId = msg.key.remoteJid;
    const text = msg.message.conversation;

    const response = handleIncomingMessage(userId, text);

    if (response) {
      await sock.sendMessage(userId, { text: response });
    }
  });


  sock.ev.on('creds.update', saveCreds);

  console.info("✅ WhatsApp Bot iniciado y escuchando mensajes...");
}


// Función para limpiar completamente el estado
async function cleanupConnection() {
  if (connectionState.socket?.ev) {
    connectionState.socket.ev.removeAllListeners();
  }

  if (connectionState.socket) {
      try {
      await connectionState.socket.end();
      console.debug('Socket closed successfully');
    } catch (error) {
      console.debug('Socket already closed or error closing', { error: error.message });
    }
  }

  // Resetear estado (siempre se ejecuta)
  connectionState.socket = null;
  connectionState.qrData = null;
  connectionState.isConnecting = false;
  connectionState.connectionStatus = 'disconnected';
  connectionState.isReconnecting = false;
}

// Función para obtener estado del QR
function getQRStatus() {
  const now = Date.now();
  const hasActiveQR = !!connectionState.qrData && now < connectionState.qrData.expiresAt;

  let qrInfo = null;
  if (connectionState.qrData) {
    const timeRemaining = Math.floor((connectionState.qrData.expiresAt - now) / 1000);
    qrInfo = {
      ...connectionState.qrData,
      timeRemaining: timeRemaining > 0 ? timeRemaining : 0,
      isExpired: timeRemaining <= 0,
      age: Math.floor((now - new Date(connectionState.qrData.createdAt).getTime()) / 1000)
    };
  }

  return {
    hasActiveQR,
    qrData: qrInfo,
    isConnected: connectionState.connectionStatus === 'connected',
    connectionState: {
      isConnecting: connectionState.isConnecting,
      hasSocket: !!connectionState.socket,
      socketStatus: connectionState.connectionStatus,
      status: connectionState.connectionStatus,
      reconnectAttempts: connectionState.reconnectAttempts,
      isReconnecting: connectionState.isReconnecting
    },
    lastUpdated: new Date().toISOString()
  };
}

// Función para generar QR desde la actualización de conexión
async function generateQRFromUpdate(qrString) {
  try {
    // Generar QR en formato PNG optimizado para mejor compatibilidad
    const qrResult = await generateOptimalQR(qrString, 'PNG');

    connectionState.qrData = {
      image: qrResult.image,
      expiresAt: Date.now() + 120000, // 2 minutos
      createdAt: new Date().toISOString(),
      qrString: qrString,
      format: qrResult.format,
      size: qrResult.size,
      mimeType: qrResult.mimeType,
      fallback: qrResult.fallback || false
    };

    // Emitir actualización inmediata
      try {
      emitQrStatusUpdate(getQRStatus());
    } catch (emitError) {
      console.error('Error emitting QR status update', { error: emitError.message });
    }

    console.info('QR generated from connection update', {
      format: qrResult.format,
      size: qrResult.size,
      mimeType: qrResult.mimeType,
      fallback: qrResult.fallback || false
    });
  } catch (error) {
    console.error('Error generating QR from update', { error: error.message, stack: error.stack });
  }
}

// Función para generar QR con timeout
async function generateNewQR(session) {
  return new Promise((resolve, reject) => {
    try {
      const config = getWhatsAppConfig();
      const qrTimeout = config.stability?.qrTimeout || 15000;

      const timeoutId = setTimeout(() => {
        try {
          session.ev.off('connection.update', qrHandler);
        } catch (error) {
            console.error('Error removing QR handler', { error: error.message });
        }
        reject(new Error('Timeout al generar QR'));
      }, qrTimeout);

      const qrHandler = (update) => {
        if (update.qr) {
          try {
            clearTimeout(timeoutId);
            session.ev.off('connection.update', qrHandler);

            // Generar QR en formato PNG optimizado
            generateOptimalQR(update.qr, 'PNG')
              .then(qrResult => {
                try {
                  connectionState.qrData = {
                    image: qrResult.image,
                    expiresAt: Date.now() + 120000, // 2 minutos
                    createdAt: new Date().toISOString(),
                    qrString: update.qr,
                    format: qrResult.format,
                    size: qrResult.size,
                    mimeType: qrResult.mimeType,
                    fallback: qrResult.fallback || false
                  };
                  resolve(qrResult.image);
                } catch (error) {
                  console.error('Error setting QR data', { error: error.message });
                  reject(error);
                }
              })
              .catch(reject);
          } catch (error) {
            console.error('Error in QR handler', { error: error.message });
            reject(error);
          }
        }
      };

      session.ev.on('connection.update', qrHandler);
    } catch (error) {
      console.error('Error setting up QR generation', { error: error.message });
      reject(error);
    }
  });
}

// Función para reconexión automática con Health Check inteligente y backoff
async function attemptReconnect() {
  const config = getWhatsAppConfig();
  const maxAttempts = config.stability?.maxReconnectAttempts || 5;

  // GUARDIÁN: Verificar límite de intentos
  if (connectionState.isReconnecting || connectionState.reconnectAttempts >= maxAttempts) {
    console.warn('Max reconnection attempts reached or already reconnecting', {
      attempts: connectionState.reconnectAttempts,
      maxAttempts: maxAttempts,
      isReconnecting: connectionState.isReconnecting
    });
    return;
  }

  if (connectionState.reconnectTimer) {
    clearTimeout(connectionState.reconnectTimer);
  }

  connectionState.isReconnecting = true;
  
  // Calcular delay con backoff exponencial para reconexiones
  const reconnectDelays = [3000, 10000, 30000, 60000, 120000]; // 3s, 10s, 30s, 60s, 120s
  const reconnectIndex = Math.min(connectionState.reconnectAttempts, reconnectDelays.length - 1);
  const reconnectDelay = reconnectDelays[reconnectIndex];
  
  connectionState.reconnectTimer = setTimeout(async () => {
    try {
      const attemptNumber = connectionState.reconnectAttempts + 1;
      
      console.info('🔄 Attempting automatic reconnection', {
        attempt: attemptNumber,
        maxAttempts: maxAttempts,
        delay: `${reconnectDelay / 1000}s`
      });

      connectionState.reconnectAttempts++;

      // 🏥 HEALTH CHECK: Después del 2do intento fallido
      if (connectionState.reconnectAttempts >= 2) {
        // 💾 Verificar caché de health check (30 segundos)
        const now = Date.now();
        const cacheValid = connectionState.lastHealthCheckResult && 
                          (now - connectionState.lastHealthCheckTimestamp) < connectionState.healthCheckCacheDuration;
        
        let healthCheck;
        
        if (cacheValid) {
          console.info('💾 Usando resultado cacheado de health check', {
            age: `${Math.floor((now - connectionState.lastHealthCheckTimestamp) / 1000)}s`,
            status: connectionState.lastHealthCheckResult.status
          });
          healthCheck = connectionState.lastHealthCheckResult;
        } else {
          console.info('🏥 Verificando salud de WhatsApp antes de reintentar...');
          
          healthCheck = await sessionManager.checkWhatsAppHealth();
          
          // Guardar en caché
          connectionState.lastHealthCheckResult = healthCheck;
          connectionState.lastHealthCheckTimestamp = now;
        }
        
        if (!healthCheck.available) {
          connectionState.healthCheckAttempts++;
          
          // Backoff exponencial inteligente: 1m → 2m → 5m → 10m → 15m → MANTENIMIENTO (15m indefinido)
          const healthCheckDelays = [60000, 120000, 300000, 600000, 900000]; // 1m, 2m, 5m, 10m, 15m
          const healthCheckIndex = Math.min(connectionState.healthCheckAttempts - 1, healthCheckDelays.length - 1);
          const healthCheckDelay = healthCheckDelays[healthCheckIndex];
          
          // Determinar si estamos en modo mantenimiento (después del 5to intento)
          const isMaintenanceMode = connectionState.healthCheckAttempts > healthCheckDelays.length;
          
          console.warn('⚠️ WhatsApp no disponible - esperando con backoff exponencial', {
            status: healthCheck.status,
            message: healthCheck.message,
            attempt: connectionState.reconnectAttempts,
            healthCheckAttempt: connectionState.healthCheckAttempts,
            nextCheckIn: `${healthCheckDelay / 1000}s`,
            mode: isMaintenanceMode ? 'maintenance' : 'backoff',
            note: isMaintenanceMode ? 'Verificación periódica cada 15 minutos' : 'Escalando tiempo de espera'
          });
          
          connectionState.isReconnecting = false;
          connectionState.connectionStatus = 'waiting_for_service';
          
          // Aplicar backoff exponencial o modo mantenimiento
          setTimeout(() => {
            if (isMaintenanceMode) {
              console.info('🔧 Modo mantenimiento: Verificación periódica de WhatsApp...');
            } else {
              console.info('⏰ Reintentando verificación de WhatsApp después de backoff...');
            }
            
            // No incrementar reconnectAttempts aquí, solo healthCheckAttempts
            connectionState.reconnectAttempts--; // Compensar el incremento anterior
            attemptReconnect();
          }, healthCheckDelay);
          
          return;
        }
        
        // WhatsApp está disponible, resetear contador de health checks
        console.info('✅ WhatsApp disponible - procediendo con reconexión');
        connectionState.healthCheckAttempts = 0;
        
        // 🔍 VALIDACIÓN DE CREDENCIALES: Si WhatsApp está OK
        const validation = await sessionManager.validateCredentials();
        
        if (!validation.valid) {
          console.warn('⚠️ Credenciales detectadas como inválidas', {
            status: validation.status,
            reason: validation.reason
          });
          
          // Si están CORRUPTAS y WhatsApp está online, es seguro limpiar
          if (validation.status === 'corrupted') {
              console.warn('⚠️ Credenciales corruptas detectadas - no se realizará limpieza automática', {
                reason: validation.reason
              });

              connectionState.isReconnecting = false;
              connectionState.connectionStatus = 'credentials_corrupt_manual_action_required';

              // Notificar UI/admin que se requiere intervención manual
              try {
                emitQrStatusUpdate({
                  requiresManualIntervention: true,
                  reason: 'corrupted_credentials_detected',
                  message: 'Credenciales corruptas detectadas. Restaurar backup o usar endpoint admin para resetear auth_info.'
                });
              } catch (emitError) {
                console.error('Error emitting QR status update for corrupted credentials', { error: emitError.message });
              }

              return;
            }

            // Si son inválidas pero no corruptas, continuar intentando
            console.warn('Credenciales inválidas pero no corruptas - continuando reintentos');
        }
      }

      // Proceder con reconexión normal
      connectionState.connectionStatus = 'connecting';

      await cleanupConnection();
      connectionState.socket = await createNewSession();

      console.info('✅ Reconnection successful');
      connectionState.reconnectAttempts = 0;
      connectionState.healthCheckAttempts = 0;
      connectionState.isReconnecting = false;
      
      // Resetear contador de fallos en SessionManager
      sessionManager.resetFailureCounter();

    } catch (error) {
      console.error('❌ Reconnection failed', {
        error: error.message,
        attempt: connectionState.reconnectAttempts,
        stack: error.stack
      });

      connectionState.isReconnecting = false;
      
      // Registrar fallo en SessionManager
      sessionManager.recordFailedAttempt();

      // Intentar de nuevo si no se alcanzó el límite
      if (connectionState.reconnectAttempts < maxAttempts) {
        console.info(`🔄 Programando reintento ${connectionState.reconnectAttempts + 1}/${maxAttempts}`);
        attemptReconnect();
      } else {
        console.error('🛑 Límite de reintentos alcanzado - se requiere intervención manual');
        connectionState.connectionStatus = 'failed';
        connectionState.healthCheckAttempts = 0;
        
        emitQrStatusUpdate({
          requiresManualIntervention: true,
          reason: 'max_reconnect_attempts_reached',
          message: 'No se pudo reconectar después de múltiples intentos. Verifica la conexión.'
        });
      }
    }
  }, reconnectDelay);
}

// Función para manejar errores de stream específicamente
function handleStreamError(error, update) {
  const config = getWhatsAppConfig();

  console.warn('Stream error detected', {
    error: error.message,
    code: update?.lastDisconnect?.error?.data?.attrs?.code,
    statusCode: update?.lastDisconnect?.statusCode
  });

  // Si es un error de stream que requiere restart (código 515)
  if (update?.lastDisconnect?.error?.data?.attrs?.code === '515' ||
    error.message?.includes('Stream Errored') ||
    update?.lastDisconnect?.error?.message?.includes('restart required')) {

    console.info('Stream error requires restart, attempting reconnection');

    // Limpiar estado actual
    connectionState.connectionStatus = 'disconnected';
    connectionState.isConnecting = false;

    // Intentar reconexión automática
    if (config.stability?.autoReconnect !== false) {
      attemptReconnect();
    }
  }
}

// Función principal para crear nueva sesión
async function createNewSession() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const config = getWhatsAppConfig();

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: config.security?.printQRInTerminal || false,
      connectTimeoutMs: config.stability?.connectionTimeout || config.connection?.connectTimeoutMs || 30000,
      browser: [config.browser?.name || 'Chrome', config.browser?.version || '120.0.0.0', config.browser?.os || 'Windows'],
      keepAliveIntervalMs: config.connection?.keepAliveIntervalMs || 60000,
      markOnlineOnConnect: config.security?.markOnlineOnConnect !== false,
      syncFullHistory: false,
      retryRequestDelayMs: config.connection?.retryRequestDelayMs || 1000,
      maxRetries: config.connection?.maxRetries || 5,
      emitOwnEvents: false,
      shouldIgnoreJid: (jid) => jid.includes('@broadcast'),
      patchMessageBeforeSending: (msg) => {
        if (msg.message) {
          msg.messageTimestamp = Date.now();
        }
        return msg;
      },
      ws: {
        timeout: config.stability?.networkTimeout || config.websocket?.timeout || 30000,
        keepalive: true,
        keepaliveInterval: config.websocket?.keepaliveInterval || 15000,
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Configurar event handlers para mejor manejo de conexión
    sock.ev.on('connection.update', async (update) => {
      try {
        logger.info('Connection update', {
          connection: update.connection,
          lastDisconnect: update.lastDisconnect,
          qr: update.qr ? 'present' : 'absent'
        });

        // Delegate to session manager for debounce/verification and potential auth_info cleanup
        try { sessionManager.handleConnectionUpdate(update); } catch (e) { logger.error('sessionManager.handleConnectionUpdate failed', { error: e?.message }); }

        // Manejar cambios de estado de conexión (vista local para UI/estado)
        if (update.connection === 'connecting') {
          connectionState.connectionStatus = 'connecting';
          connectionState.isConnecting = true;
          connectionState.reconnectAttempts = 0;
          connectionState.lastConnectionAttempt = Date.now();
        } else if (update.connection === 'open') {
          connectionState.connectionStatus = 'connected';
          connectionState.isConnecting = false;
          connectionState.reconnectAttempts = 0;
          connectionState.isReconnecting = false;
          logger.info('✅ WhatsApp connected successfully');

          // Emitir estado actualizado inmediatamente
          const currentStatus = getQRStatus();
          console.log('📡 Emitiendo estado de conexión al frontend:', {
            isConnected: currentStatus.isConnected,
            hasSocket: currentStatus.connectionState.hasSocket,
            status: currentStatus.connectionState.status,
            timestamp: new Date().toISOString()
          });
          emitQrStatusUpdate(currentStatus);
        } else if (update.connection === 'close') {
          connectionState.connectionStatus = 'disconnected';
          connectionState.isConnecting = false;

          logger.warn('Connection closed', {
            reason: update.lastDisconnect?.error?.message || 'unknown',
            statusCode: update.lastDisconnect?.statusCode
          });

          // Manejar errores de stream específicamente (restart required)
          if (update.lastDisconnect?.error?.data?.attrs?.code === '515' ||
            update.lastDisconnect?.error?.message?.includes('Stream Errored') ||
            update.lastDisconnect?.error?.message?.includes('restart required')) {
            handleStreamError(update.lastDisconnect.error, update);
          }

          try {
            emitQrStatusUpdate(getQRStatus());
          } catch (emitError) {
            logger.error('Error emitting disconnection status', { error: emitError.message });
          }
        }

        // Manejar QR
        if (update.qr) {
          logger.info('New QR received');
          generateQRFromUpdate(update.qr);
        }
      } catch (error) {
        logger.error('Error handling connection update', { error: error.message, stack: error.stack });
      }
    });

    return sock;
  } catch (error) {
    logger.error('Error creating new session', { error: error.message, stack: error.stack });
    throw error;
  }
}

// Función para generar QR en el formato óptimo
async function generateOptimalQR(qrString, format = 'PNG') {
  try {
    let qrImage;
    let qrConfig;

    switch (format.toUpperCase()) {
      case 'PNG':
        // PNG es el más compatible y estable para WhatsApp
        qrConfig = {
          type: 'image/png',
          quality: 0.92,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 256,
          errorCorrectionLevel: 'M'
        };
        break;

      case 'JPEG':
        // JPEG como alternativa más ligera
        qrConfig = {
          type: 'image/jpeg',
          quality: 0.9,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 256,
          errorCorrectionLevel: 'M'
        };
        break;

      case 'SVG':
        // SVG para máxima calidad (pero puede causar problemas de compatibilidad)
        qrConfig = {
          type: 'svg',
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 256,
          errorCorrectionLevel: 'M'
        };
        break;

      default:
        // PNG por defecto (más compatible)
        qrConfig = {
          type: 'image/png',
          quality: 0.92,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 256,
          errorCorrectionLevel: 'M'
        };
    }

    qrImage = await QRCode.toDataURL(qrString, qrConfig);

    return {
      image: qrImage,
      format: format.toUpperCase(),
      mimeType: qrConfig.type,
      size: `${qrConfig.width}x${qrConfig.width}`,
      config: qrConfig
    };

  } catch (error) {
    logger.error('Error generating optimal QR', { error: error.message, format });

    // Fallback a PNG básico si falla el formato especificado
    try {
      const fallbackQR = await QRCode.toDataURL(qrString, {
        type: 'image/png',
        width: 256,
        margin: 1
      });

      return {
        image: fallbackQR,
        format: 'PNG',
        mimeType: 'image/png',
        size: '256x256',
        config: { type: 'image/png', width: 256, margin: 1 },
        fallback: true
      };
    } catch (fallbackError) {
      throw new Error(`Failed to generate QR in any format: ${error.message}`);
    }
  }
}

/**
 * Descarga imagen desde URL o ruta local y retorna Buffer
 * Soporta: URLs externas (http/https), rutas locales relativas a src/public/, y URLs BASE_URL
 * @param {string} imgPath - Ruta o URL de imagen
 * @returns {Promise<Buffer|null>} - Buffer de imagen o null si falla
 */
export async function getImageBase64(imgPath) {
  try {
    // Para cualquier URL (http/https), usar fetch con timeout
    if (imgPath.startsWith("http")) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(imgPath, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} al descargar ${imgPath}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else {
      // Para rutas locales directas (relativas a src/public/)
      const fullPath = path.resolve(process.cwd(), 'src', 'public', imgPath);
      logger.info('Leyendo imagen localmente desde ruta relativa', { imgPath, fullPath });
      return await fs.promises.readFile(fullPath);
    }
  } catch (error) {
    console.error(`Error obteniendo imagen desde ${imgPath}:`, error.message);
    return null;
  }
}

// Re-export normalizePhone from utils
export { normalizePhone } from '../utils/normalizePhone.js';

/**
 * Envía un webhook por-recipient al backend Laravel
 * Estrategia granular: un webhook individual por cada recipients con delay de 2-4 segundos
 * @param {Object} webhookPayload - Datos del webhook (campania_id, chunk_id, id_modalservicio, status, etc)
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function notifyBackendStatus(webhookPayload) {
  try {
    const backendUrl = `${process.env.MAIN_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:8000'}/api/whatsapp/webhook/status`;
    const apiKey = process.env.WHATSAPP_API_KEY || process.env.API_KEY;

    if (!apiKey) {
      console.warn('⚠️ API_KEY no configurada. Webhook no se enviará al backend.');
      return {
        success: false,
        error: 'API_KEY no configurada en variables de entorno'
      };
    }

    console.log(`\n🔔 Enviando webhook a ${backendUrl}`);
    console.log(`📋 Payload del webhook:`);
    console.log(JSON.stringify(webhookPayload, null, 2));

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(webhookPayload),
      timeout: 10000 // 10s timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseData = await response.json();
    console.log(`✅ Webhook entregado exitosamente.`);
    console.log(`📦 Response desde Laravel:`, JSON.stringify(responseData, null, 2));

    return {
      success: true,
      message: 'Webhook enviado correctamente',
      response: responseData
    };
  } catch (error) {
    console.error(`❌ Error enviando webhook al backend:`, {
      error: error.message,
      recipient: webhookPayload?.recipient?.nombre || webhookPayload?.id_modalservicio,
      status: webhookPayload?.status,
      timestamp: new Date().toISOString()
    });

    // Retornar error pero no lanzar excepción para no interrumpir el flujo
    return {
      success: false,
      error: error.message
    };
  }
}

// API Pública
export default {
  async requestQR(userId) {
      whatsappSessionLogger.logQrRequest(userId);
      whatsappSessionLogger.logQrStatus('system', connectionState.connectionStatus);
    
    logger.info('Requesting new QR code', { userId });    
    // GUARDÍAN: Si ya estamos conectando o reconectando, no hacer nada.
    if (connectionState.isConnecting || connectionState.isReconnecting) {
      logger.warn('Ignoring QR request: A connection attempt is already in progress.');
      throw {
        code: 'CONNECTION_IN_PROGRESS',
        message: 'Ya se está intentando conectar o reconectar. Por favor, espera unos segundos.'
      };
    }
    
    try {
      if (connectionState.connectionStatus === 'connected') {
        return {
          success: false,
          message: 'Ya estás conectado a WhatsApp. No es necesario escanear otro QR.',
          isConnected: true
        };
      }

      // Si hay un QR activo que aún no expiró, no generes otro
      if (connectionState.qrData && Date.now() < connectionState.qrData.expiresAt) {
        throw {
          code: 'QR_ACTIVE',
          message: 'Ya hay un QR activo',
          expiresAt: connectionState.qrData.expiresAt
        };
      }

      // Rate limiting
      const now = Date.now();
      const userHistory = connectionState.userConnections.get(userId) || [];
      const recentAttempts = userHistory.filter(t => now - t < 3600000).length;

      if (recentAttempts >= 100) {
        throw {
          code: 'RATE_LIMITED',
          message: 'Límite de solicitudes alcanzado',
          resetTime: userHistory[0] + 3600000
        };
      }

      connectionState.isConnecting = true;
      connectionState.connectionStatus = 'connecting';

      // Definir el delay para forzar el QR (en milisegundos)
      const forceQrDelay = 1000; // 3 segundos, ajusta según tu lógica

      try {
        await cleanupConnection();
      } catch (cleanupError) {
        logger.error('Error during cleanup', { error: cleanupError.message });
      }

      try {
        connectionState.socket = await createNewSession();
      } catch (sessionError) {
        logger.error('Error creating new session', { error: sessionError.message });
        throw {
          code: 'SESSION_ERROR',
          message: 'Error al crear nueva sesión',
          error: sessionError.message
        };
      }

      connectionState.userConnections.set(userId, [...userHistory, now].slice(-10));

      return {
        success: true,
        message: `Solicitud de QR procesada. El QR se generará automáticamente en ${forceQrDelay / 1000} segundos.`,
        status: 'processing'
      };
    } catch (error) {
      logger.error('Error generating QR', {
        userId,
        error: error.message,
        code: error.code,
        stack: error.stack
      });

      try {
        // Reseteamos el estado si el error NO fue nuestro bloqueo
        if (error.code !== 'CONNECTION_IN_PROGRESS') {
          connectionState.isConnecting = false;
          connectionState.connectionStatus = 'disconnected';
        }
      } catch (resetError) {
        logger.error('Error resetting state', { error: resetError.message });
      }

      throw error;
    }
  },

  async expireQR(reason, userId) {
      whatsappSessionLogger.logRestart(userId);
      whatsappSessionLogger.logQrCode('system', { qrString });
    logger.info('Expiring QR code', { reason, userId });

    if (connectionState.qrData) {
      connectionState.qrData.expiresAt = Date.now();
      this.updateQrStatus();
      return true;
    }
    return false;
  },

  getQRStatus() {
    return getQRStatus();
  },

  isConnected() {
    return connectionState.connectionStatus === 'connected';
  },

  async sendMessage({ telefono, templateOption, nombre, fecha, hora, productoName }) {
    if (!connectionState.socket?.user) {
      throw new Error("No conectado a WhatsApp. Por favor, escanea el código QR primero.");
    }

    // Normalizar y aceptar números locales (ej. 9 dígitos). Prepend DEFAULT_COUNTRY_CODE si falta.
    let rawPhone = telefono;
    if (typeof rawPhone !== 'string') rawPhone = String(rawPhone || '');
    // Use centralized normalizer
    var formattedPhone = normalizePhone(rawPhone);

    // [DEPRECATED] plantillas eliminadas - código comentado
    // 🔹 Obtiene la plantilla (objeto con text + image)
    // const plantilla = getTemplate(productoName, templateOption, { nombre});
    
    // if (!plantilla || !plantilla.text) {
    //   throw new Error("Plantilla de mensaje no válida");
    // }
    
    // let messagePayload = { text: plantilla.text };

    // Si la plantilla tiene imagen, descargarla localmente como buffer
    if (plantilla.image) {
      const imageBuffer = await getImageBase64(plantilla.image);
      if (!imageBuffer) {
        throw new Error(`No se pudo cargar la imagen: ${plantilla.image}`);
      }
      messagePayload = {
        image: imageBuffer,
        caption: plantilla.text
      };
    }

    try {
      logger.info("Enviando mensaje WhatsApp", {
        telefono: formattedPhone,
        template: templateOption,
        nombre,
        fecha,
        hora,
        messageLength: plantilla.text.length,
        hasImage: !!plantilla.image
      });

      const result = await connectionState.socket.sendMessage(formattedPhone, messagePayload);

      logger.info("Mensaje enviado exitosamente", {
        telefono: formattedPhone,
        messageId: result.key.id,
        timestamp: new Date().toISOString(),
      });

      // Guarda historial
      const sentMessage = {
        telefono: formattedPhone,
        template: templateOption,
        nombre,
        fecha,
        hora,
        messageId: result.key.id,
        sentAt: new Date().toISOString(),
        messagePreview: plantilla.text.substring(0, 100) + (plantilla.text.length > 100 ? "..." : ""),
        status: "sent",
        hasImage: !!plantilla.image
      };

      connectionState.sentMessages.push(sentMessage);

      const config = getWhatsAppConfig();
      if (connectionState.sentMessages.length > (config.messages?.maxHistorySize || 100)) {
        connectionState.sentMessages = connectionState.sentMessages.slice(
          -(config.messages?.maxHistorySize || 100)
        );
      }

      return {
        success: true,
        messageId: result.key.id,
        telefono: formattedPhone,
        template: templateOption,
        sentAt: new Date().toISOString(),
        messagePreview: sentMessage.messagePreview,
      };
    } catch (error) {
      logger.error("Error enviando mensaje WhatsApp", {
        telefono: formattedPhone,
        error: error.message,
        stack: error.stack,
      });

      if (error.message.includes("disconnected")) {
        await cleanupConnection();
        throw new Error("Conexión perdida con WhatsApp. Por favor, escanea el código QR nuevamente.");
      }

      if (error.message.includes("not-authorized")) {
        throw new Error("No tienes autorización para enviar mensajes a este número.");
      }

      if (error.message.includes("forbidden")) {
        throw new Error("No se puede enviar mensajes a este número. Verifica que el número sea válido.");
      }

      if (error.message.includes("rate limit")) {
        throw new Error("Límite de mensajes alcanzado. Espera un momento antes de enviar más mensajes.");
      }

      throw new Error(`Error al enviar mensaje: ${error.message}`);
    }
  },


  async sendMessageImageDashboard({
  telefono,
  templateOption, 
  nombre,
  image,
  text 
}) {
  if (!connectionState.socket?.user) {
    throw new Error("No conectado a WhatsApp. Escanea el QR primero.");
  }

  if (!text) {
    throw new Error("El texto del mensaje es obligatorio");
  }

  /* =========================
     1️⃣ VALIDAR TELÉFONO
  ========================= */
  // Use centralized normalizer
  const formattedPhone = normalizePhone(telefono);

  /* =========================
     2️⃣ OBTENER IMAGEN REAL
========================= */
  // Si image es un Buffer (ya descargado desde controller), usarlo directamente
  // Si es string (URL/ruta), descargarlo ahora
  let imageBuffer;
  if (Buffer.isBuffer(image)) {
    imageBuffer = image;
    logger.info("Detectado Buffer de imagen en service", { tamaño: imageBuffer.length });
    console.log(`✅ Buffer de imagen recibido en service: ${imageBuffer.length} bytes`);
  } else if (image) {
    console.log(`📥 Descargando imagen desde string en service: ${image}`);
    imageBuffer = await getImageBase64(image);
    if (!imageBuffer) {
      console.error("Ruta de imagen no encontrada:", image);
      throw new Error("No se pudo cargar la imagen seleccionada. Verifique que el archivo exista en el servidor.");
    }
    console.log(`✅ Imagen descargada en service: ${imageBuffer.length} bytes`);
  } else {
    imageBuffer = null;
    console.log("⏭️ Sin imagen para este envío");
  }

  /* =========================
     3️⃣ PAYLOAD EXACTO
  ========================= */
  // Crear una copia del buffer para este envío (evita mezclas si hay concurrencia)
  let messagePayload;
  if (imageBuffer) {
    const bufferToSend = Buffer.from(imageBuffer);
    messagePayload = {
      image: bufferToSend,
      caption: text
    };
    console.log(`✅ Payload CON imagen: ${bufferToSend.length} bytes + caption`);
  } else {
    messagePayload = {
      text: text
    };
    console.log(`✅ Payload SIN imagen: solo texto`);
  }

  try {
    console.log(`\n📤 Enviando mensaje a WhatsApp...`);
    console.log(`   Teléfono: ${formattedPhone}`);
    console.log(`   Tipo de payload: ${imageBuffer ? 'image+caption' : 'text-only'}`);

    const result = await connectionState.socket.sendMessage(
      formattedPhone,
      messagePayload
    );

    console.log(`✅ Mensaje enviado a WhatsApp exitosamente`);
    console.log(`   Message ID: ${result.key.id}`);
    console.log(`   Con imagen: ${!!imageBuffer}`);

    /* =========================
       4️⃣ HISTORIAL
    ========================= */
    connectionState.sentMessages.push({
      telefono: formattedPhone,
      template: templateOption,
      nombre,
      messageId: result.key.id,
      sentAt: new Date().toISOString(),
      messagePreview: text.substring(0, 100),
      hasImage: true,
      status: "sent"
    });

    return {
      success: true,
      messageId: result.key.id,
      telefono: formattedPhone,
      messagePreview: text.substring(0, 100)
    };

  } catch (error) {
    logger.error("❌ Error enviando mensaje dashboard", {
      telefono: formattedPhone,
      error: error.message
    });

    throw new Error("Error al enviar el mensaje con imagen");
  }
}
,
  async sendMessageWithImage({ imageData, phone, caption }) {
    if (!connectionState.socket?.user) {
      throw new Error('No conectado a WhatsApp. Por favor, escanea el código QR primero.');
    }

    // Normalizar y aceptar números locales (ej. 9 dígitos). Prepend DEFAULT_COUNTRY_CODE si falta.
    // Centralized normalizer
    const formattedPhone = normalizePhone(phone);

    // Validar datos de imagen
    if (!imageData) {
      throw new Error('Los datos de la imagen son requeridos');
    }

    let imageBuffer;
    try {
      // Remover prefijo data:image si existe
      const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');

      // Validar tamaño de imagen (máximo 16MB para WhatsApp)
      const maxSize = 16 * 1024 * 1024; // 16MB
      if (imageBuffer.length > maxSize) {
        throw new Error('La imagen es demasiado grande. El tamaño máximo es 16MB');
      }
    } catch (error) {
      throw new Error('Formato de imagen base64 inválido');
    }

    try {
      const captionText = caption || 'Imagen enviada';
      logger.info('Enviando mensaje con imagen WhatsApp', {
        phone: formattedPhone,
        imageSize: imageBuffer.length,
        captionLength: captionText.length
      });

      // Preparar mensaje con imagen — usar copia del buffer para evitar mezclas
      const messageOptions = {
        image: Buffer.from(imageBuffer),
        caption: captionText,
        jpegThumbnail: null,
      };

      const result = await connectionState.socket.sendMessage(formattedPhone, messageOptions);

      logger.info('Mensaje enviado exitosamente', {
        phone: formattedPhone,
        messageId: result.key.id,
        timestamp: new Date().toISOString()
      });

      const sentMessage = {
        phone: formattedPhone,
        messageId: result.key.id,
        sentAt: new Date().toISOString(),
        messagePreview: captionText.substring(0, 100) + (captionText.length > 100 ? '...' : ''),
        type: 'image',
        imageSize: imageBuffer.length,
        status: 'sent'
      };

      connectionState.sentMessages.push(sentMessage);

      const config = getWhatsAppConfig();
      if (connectionState.sentMessages.length > (config.messages?.maxHistorySize || 100)) {
        connectionState.sentMessages = connectionState.sentMessages.slice(-(config.messages?.maxHistorySize || 100));
      }

      return {
        success: true,
        messageId: result.key.id,
        phone: formattedPhone,
        sentAt: new Date().toISOString(),
        messagePreview: captionText.substring(0, 100) + (captionText.length > 100 ? '...' : ''),
        type: 'image',
        imageSize: imageBuffer.length
      };

    } catch (error) {
      logger.error('Error enviando mensaje WhatsApp', {
        phone: formattedPhone,
        error: error.message,
        stack: error.stack
      });

      if (error.message.includes('disconnected')) {
        await cleanupConnection();
        throw new Error('Conexión perdida con WhatsApp. Por favor, escanea el código QR nuevamente.');
      }

      if (error.message.includes('not-authorized')) {
        throw new Error('No tienes autorización para enviar mensajes a este número.');
      }

      if (error.message.includes('forbidden')) {
        throw new Error('No se puede enviar mensajes a este número. Verifica que el número sea válido.');
      }

      if (error.message.includes('rate limit')) {
        throw new Error('Límite de mensajes alcanzado. Espera un momento antes de enviar más mensajes.');
      }

      throw new Error(`Error al enviar mensaje: ${error.message}`);
    }
  },

  // Función auxiliar para generar thumbnail (opcional)
  async generateThumbnail(imageBuffer) {
    try {
      // Si tienes sharp instalado, puedes usar esto para generar un thumbnail
      // const sharp = require('sharp');
      // return await sharp(imageBuffer)
      //   .resize(100, 100, { fit: 'cover' })
      //   .jpeg({ quality: 50 })
      //   .toBuffer();

      // Si no tienes sharp, puedes retornar null o el buffer original redimensionado
      return null;
    } catch (error) {
      logger.warn('Error generando thumbnail', { error: error.message });
      return null;
    }
  },

  // Función auxiliar mejorada para sendMessageWithRetry si no existe
  async sendMessageImageWithRetry(jid, content, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Intento ${attempt} de envío de mensaje`, { jid, attempt, maxRetries });

        const result = await connectionState.socket.sendMessage(jid, content);

        if (result) {
          logger.debug('Mensaje enviado exitosamente', { jid, attempt, messageId: result.key?.id });
          return result;
        }
      } catch (error) {
        lastError = error;
        logger.warn(`Error en intento ${attempt}`, {
          jid,
          attempt,
          maxRetries,
          error: error.message
        });

        // Si es el último intento, no esperar
        if (attempt === maxRetries) {
          break;
        }

        // Esperar antes del siguiente intento (backoff exponencial)
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
        logger.debug(`Esperando ${delay}ms antes del siguiente intento`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Error desconocido al enviar mensaje');
  },

  async sendMessageWithRetry(phone, messageText, maxRetries = null) {
    const config = getWhatsAppConfig();
    const retries = maxRetries || config.messages?.maxRetries || 3;
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await connectionState.socket.sendMessage(phone, {
          text: messageText,
          timestamp: Date.now()
        });
        return result;
      } catch (error) {
        lastError = error;
        logger.warn(`Intento ${attempt} fallido al enviar mensaje`, {
          phone,
          error: error.message,
          attempt
        });

        if (attempt < retries) {
          const delay = Math.min((config.messages?.retryDelay || 2000) * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  },

  getQrCode() {
    const now = Date.now();

    if (!connectionState.qrData || now >= connectionState.qrData.expiresAt) {
      return null;
    }

    const timeRemaining = Math.floor((connectionState.qrData.expiresAt - now) / 1000);

    return {
      ...connectionState.qrData,
      timeRemaining,
      timeRemainingFormatted: `${Math.floor(timeRemaining / 60)}:${(timeRemaining % 60).toString().padStart(2, '0')}`,
      percentageRemaining: Math.round((timeRemaining / 60) * 100),
      isExpired: false,
      age: Math.floor((now - new Date(connectionState.qrData.createdAt).getTime()) / 1000)
    };
  },

  updateQrStatus() {
    const status = this.getQRStatus();
    emitQrStatusUpdate(status);
  },

  getSentMessages() {
    return connectionState.sentMessages.slice().reverse();
  },

  clearSentMessages() {
    connectionState.sentMessages = [];
    logger.info('Historial de mensajes enviados limpiado');
    return true;
  },

  // Nuevo método para forzar reconexión manual
  async forceReconnect() {
    logger.info('Forcing manual reconnection');
    connectionState.reconnectAttempts = 0;
    connectionState.isReconnecting = false;
    await attemptReconnect();
  },

  // Método para obtener estado de reconexión
  getReconnectionStatus() {
    return {
      isReconnecting: connectionState.isReconnecting,
      reconnectAttempts: connectionState.reconnectAttempts,
      maxReconnectAttempts: connectionState.maxReconnectAttempts,
      lastConnectionAttempt: connectionState.lastConnectionAttempt
    };
  },

  // Método para generar QR en formato específico
  async generateQRInFormat(qrString, format = 'PNG') {
    try {
      const qrResult = await generateOptimalQR(qrString, format);
      logger.info('QR generated in specific format', {
        format: qrResult.format,
        size: qrResult.size,
        mimeType: qrResult.mimeType
      });
      return qrResult;
    } catch (error) {
      logger.error('Error generating QR in specific format', { error: error.message, format });
      throw error;
    }
  },

  // Método para obtener información del formato del QR actual
  getQRFormatInfo() {
    if (!connectionState.qrData) {
      return null;
    }

    return {
      format: connectionState.qrData.format,
      size: connectionState.qrData.size,
      mimeType: connectionState.qrData.mimeType,
      fallback: connectionState.qrData.fallback || false,
      createdAt: connectionState.qrData.createdAt,
      expiresAt: connectionState.qrData.expiresAt
    };
  },

  // Método para cambiar formato del QR actual
  async changeQRFormat(format) {
    try {
      if (!connectionState.qrData?.qrString) {
        throw new Error('No hay QR activo para cambiar formato');
      }

      const qrResult = await generateOptimalQR(connectionState.qrData.qrString, format);

      // Actualizar el QR existente con el nuevo formato
      connectionState.qrData = {
        ...connectionState.qrData,
        image: qrResult.image,
        format: qrResult.format,
        size: qrResult.size,
        mimeType: qrResult.mimeType,
        fallback: qrResult.fallback || false
      };

      // Emitir actualización
      try {
        emitQrStatusUpdate(getQRStatus());
      } catch (emitError) {
        logger.error('Error emitting QR format change', { error: emitError.message });
      }

      logger.info('QR format changed successfully', {
        newFormat: qrResult.format,
        size: qrResult.size,
        mimeType: qrResult.mimeType
      });

      return qrResult;
    } catch (error) {
      logger.error('Error changing QR format', { error: error.message, format });
      throw error;
    }
  },

  // ===============================
  // CAMPAÑA BATCH - Envío masivo
  // ===============================

  /**
   * Valida si una imagen existe y es accesible
   * @param {string} imagePath - Ruta de la imagen (URL o path local)
   * @returns {Promise<{valid: boolean, buffer?: Buffer, error?: string}>}
   */
  async validateImage(imagePath) {
    try {
      if (!imagePath) {
        return { valid: false, error: 'Ruta de imagen no proporcionada' };
      }

      const imageBuffer = await getImageBase64(imagePath);
      
      if (!imageBuffer) {
        return { valid: false, error: 'No se pudo cargar la imagen' };
      }

      // Validar tamaño máximo (16MB para WhatsApp)
      const maxSize = 16 * 1024 * 1024;
      if (imageBuffer.length > maxSize) {
        return { valid: false, error: 'La imagen excede el tamaño máximo de 16MB' };
      }

      // Validar que sea un buffer válido de imagen
      const isValidImage = this.isValidImageBuffer(imageBuffer);
      if (!isValidImage) {
        return { valid: false, error: 'El archivo no es una imagen válida' };
      }

      return { valid: true, buffer: imageBuffer, size: imageBuffer.length };
    } catch (error) {
      logger.error('Error validando imagen', { imagePath, error: error.message });
      return { valid: false, error: error.message };
    }
  },

  /**
   * Verifica si un buffer es una imagen válida basándose en magic bytes
   */
  isValidImageBuffer(buffer) {
    if (!buffer || buffer.length < 4) return false;
    
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
    
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
    
    // GIF: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
    
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return true;
      }
    }
    
    return false;
  },

  /**
   * Envía una campaña en batch con rate limiting
   * @param {Object} params - Parámetros de la campaña
   * @returns {Promise<Object>} Resultado del envío
   */
  async sendCampaignBatch({ campania_id, chunk_id, chunk_number, recipients, message, image_url, id_servicio }) {
    const results = {};
    let successful = 0;
    let failed = 0;

    const resolvedCampaignId = campania_id ?? null;
    const resolvedChunkId = chunk_id ?? chunk_number ?? 1;
    const resolvedChunkNumber = chunk_number ?? chunk_id ?? 1;

    console.log(`\n🚀 [Campaña ${resolvedCampaignId}] Iniciando chunk id=${resolvedChunkId} (#${resolvedChunkNumber}) con ${recipients.length} destinatarios`);
    
    // Verificar conexión con contexto del estado actual
    const currentStatus = connectionState.connectionStatus;
    const hasSocket = !!connectionState.socket;
    
    if (currentStatus === 'connecting' || connectionState.isConnecting) {
      const error = new Error('WhatsApp se está conectando. Por favor, intenta en unos segundos.');
      error.code = 'SERVICE_UNAVAILABLE';
      error.statusCode = 503;
      error.retryable = true;
      throw error;
    }
    
    if (!hasSocket || currentStatus !== 'connected') {
      const error = new Error(`WhatsApp no disponible (estado: ${currentStatus}). Escanea el código QR o reconecta.`);
      error.code = 'SERVICE_UNAVAILABLE';
      error.statusCode = 503;
      error.currentState = {
        status: currentStatus,
        hasSocket: hasSocket,
        isConnecting: connectionState.isConnecting,
        isReconnecting: connectionState.isReconnecting
      };
      throw error;
    }

    // Obtener/leer imagen una sola vez reutilizando getImageBase64
    let imageBuffer = null;
    if (image_url) {
      try {
        console.log(`📥 Obteniendo imagen desde: ${image_url}`);
        const downloaded = await getImageBase64(image_url);

        if (!downloaded) {
          throw new Error('No se pudo obtener la imagen desde la ruta proporcionada');
        }

        // Asegurar que disponemos de un Buffer (copiar para seguridad)
        imageBuffer = Buffer.from(downloaded);
        console.log(`✅ Imagen obtenida: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
      } catch (error) {
        console.error(`❌ Error obteniendo imagen:`, error.message);
        throw new Error(`No se pudo descargar la imagen de la campaña: ${error.message}`);
      }
    }

    // Procesar cada destinatario con rate limiting
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const { id_modalservicio, nombre, telefono } = recipient;

      try {
        // Normalizar teléfono usando util centralizado
        const formattedPhone = normalizePhone(telefono);
        const displayName = nombre || telefono || id_modalservicio;
        console.log(`\n📤 [${i + 1}/${recipients.length}] Enviando a ${displayName} (${formattedPhone})...`);

        // Interpolar nombre si existe {nombre} en el mensaje
        const textoInterpolado = interpolateMessage(message, nombre);

        // Preparar mensaje
        let messagePayload;
        if (imageBuffer) {
          messagePayload = {
            image: Buffer.from(imageBuffer),
            caption: `${textoInterpolado}`
          };
        } else {
          messagePayload = {
            text: `${textoInterpolado}`
          };
        }

        // Enviar mensaje
        const result = await connectionState.socket.sendMessage(formattedPhone, messagePayload);

        results[id_modalservicio] = {
          success: true,
          messageId: result.key.id,
          sentAt: new Date().toISOString()
        };

        successful++;
        console.log(`✅ Enviado exitosamente a ${displayName}`);

        // Preparar y notificar al backend inmediatamente (fire-and-forget)
        try {
          const recipientWebhook = {
            provider_message_id: result.key.id,
            status: 'sent',
            campania_id: resolvedCampaignId,
            chunk_id: resolvedChunkId,
            id_modalservicio: id_modalservicio
          };

          // Fire-and-forget para no bloquear el loop de envíos
          notifyBackendStatus(recipientWebhook)
            .then(() => console.log(`🔔 Webhook entregado para ${displayName} (${cleanPhone})`))
            .catch((webhookErr) => console.error(`⚠️ Error entregando webhook para ${nombre}:`, webhookErr.message));
        } catch (webhookErr) {
          console.error(`⚠️ Error preparando webhook para ${nombre}:`, webhookErr.message);
        }

        // Rate limiting: usar delay fijo de 4 segundos entre envíos
        if (i < recipients.length - 1) {
          const messageDelay = 4000; // 4 segundos
          console.log(`⏳ Esperando ${(messageDelay / 1000).toFixed(1)}s antes del siguiente envío...`);
          await new Promise(resolve => setTimeout(resolve, messageDelay));
        }

      } catch (error) {
        console.error(`❌ Error enviando a ${nombre} (${telefono}):`, error.message);
        
        results[id_modalservicio] = {
          success: false,
          error: error.message || 'Error desconocido',
          sentAt: new Date().toISOString()
        };

        failed++;

        // Notificar error al backend inmediatamente (fire-and-forget)
        try {
          const failureWebhook = {
            provider_message_id: null,
            status: 'failed',
            campania_id: resolvedCampaignId,
            chunk_id: resolvedChunkId,
            id_modalservicio: id_modalservicio,
            error: error.message
          };

          notifyBackendStatus(failureWebhook)
            .then(() => console.log(`🔔 Webhook de error entregado para ${nombre}`))
            .catch((webhookErr) => console.error(`⚠️ Error entregando webhook de error:`, webhookErr.message));
        } catch (webhookErr) {
          console.error(`⚠️ Error preparando webhook de error:`, webhookErr.message);
        }

        // Si hay error de conexión, detener el batch
        if (error.message.includes('disconnected') || error.message.includes('not-authorized')) {
          console.error(`🛑 Error crítico de conexión. Deteniendo batch.`);
          
          // Marcar los restantes como fallidos
          for (let j = i + 1; j < recipients.length; j++) {
            results[recipients[j].id_modalservicio] = {
              success: false,
              error: 'Batch detenido por error de conexión',
              sentAt: new Date().toISOString()
            };
            failed++;
          }
          
          break;
        }

        // Continuar con el siguiente destinatario
        // Pequeña pausa adicional después de un error
        if (i < recipients.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    console.log(`\n📊 [Campaña ${resolvedCampaignId}] Chunk id=${resolvedChunkId} (#${resolvedChunkNumber}) completado:`);
    console.log(`   ✅ Exitosos: ${successful}`);
    console.log(`   ❌ Fallidos: ${failed}`);
    console.log(`   📢 Webhooks per-recipient despachados con delays de 2-4 segundos`);

    // Retornar resultado sin esperar webhooks (se envían de forma asíncrona)
    return {
      campania_id: resolvedCampaignId,
      chunk_id: resolvedChunkId,
      chunk_number: resolvedChunkNumber,
      id_servicio,
      total: recipients.length,
      successful,
      failed,
      results,
      webhookStrategy: 'per-recipient-granular',
      note: 'Webhooks per-recipient se envían de forma asíncrona con delays de 2-4 segundos'
    };
  },

  // Método para enviar mensajes simples (aceptación/rechazo)
  async sendSimpleMessage({ phone, message, type, useTemplate = false }) {
    if (!connectionState.socket?.user) {
      throw new Error('No conectado a WhatsApp. Por favor, escanea el código QR primero.');
    }
    // Normalizar y aceptar números locales (ej. 9 dígitos). Prepend DEFAULT_COUNTRY_CODE si falta.
    let rawPhone = phone;
    if (typeof rawPhone !== 'string') rawPhone = String(rawPhone || '');
    const formattedPhone = normalizePhone(rawPhone);

    // [DEPRECATED] Importación de templates eliminada - ya no se usan plantillas
    // const { getAcceptanceTemplate, getRejectionTemplate } = await import('../templates.js');
    
    let finalMessage = message;
    
    // [DEPRECATED] Lógica de template comentada - useTemplate ya no tiene efecto
    // Si se debe usar template, aplicar el correspondiente según el tipo
    // if (useTemplate) {
    //   if (type === 'accept') {
    //     finalMessage = getAcceptanceTemplate(message);
    //   } else if (type === 'reject') {
    //     finalMessage = getRejectionTemplate(message);
    //   }
    // }

    try {
      logger.info('Enviando mensaje simple WhatsApp', {
        phone: formattedPhone,
        type: type,
        useTemplate: useTemplate,
        messageLength: finalMessage.length
      });

      const result = await this.sendMessageWithRetry(formattedPhone, finalMessage);

      logger.info('Mensaje simple enviado exitosamente', {
        phone: formattedPhone,
        type: type,
        useTemplate: useTemplate,
        messageId: result.key.id,
        timestamp: new Date().toISOString()
      });

      const sentMessage = {
        phone: formattedPhone,
        type: type,
        message: message, // Guardar el comentario original
        finalMessage: finalMessage, // Guardar el mensaje final con template
        useTemplate: useTemplate,
        messageId: result.key.id,
        sentAt: new Date().toISOString(),
        messagePreview: finalMessage.substring(0, 100) + (finalMessage.length > 100 ? '...' : ''),
        status: 'sent'
      };

      connectionState.sentMessages.push(sentMessage);

      const config = getWhatsAppConfig();
      if (connectionState.sentMessages.length > (config.messages?.maxHistorySize || 100)) {
        connectionState.sentMessages = connectionState.sentMessages.slice(-(config.messages?.maxHistorySize || 100));
      }

      return {
        success: true,
        messageId: result.key.id,
        phone: formattedPhone,
        type: type,
        useTemplate: useTemplate,
        sentAt: new Date().toISOString(),
        messagePreview: finalMessage.substring(0, 100) + (finalMessage.length > 100 ? '...' : ''),
        originalComment: message
      };

    } catch (error) {
      logger.error('Error enviando mensaje simple WhatsApp', {
        phone: formattedPhone,
        type: type,
        useTemplate: useTemplate,
        error: error.message,
        stack: error.stack
      });

      if (error.message.includes('disconnected')) {
        await cleanupConnection();
        throw new Error('Conexión perdida con WhatsApp. Por favor, escanea el código QR nuevamente.');
      }

      if (error.message.includes('not-authorized')) {
        throw new Error('No tienes autorización para enviar mensajes a este número.');
      }

      if (error.message.includes('forbidden')) {
        throw new Error('No se puede enviar mensajes a este número. Verifica que el número sea válido.');
      }

      if (error.message.includes('rate limit')) {
        throw new Error('Límite de mensajes alcanzado. Espera un momento antes de enviar más mensajes.');
      }

      throw new Error(`Error al enviar mensaje: ${error.message}`);
    }
  },

  /**
   * Espera hasta que WhatsApp esté conectado o timeout
   * @param {number} timeoutMs - Timeout en ms (default 60s)
   * @returns {Promise<{success: boolean, connected: boolean, elapsedMs: number, message: string}>}
   */
  async waitForConnection(timeoutMs = 60000) {
    const startTime = Date.now();
    const pollInterval = 500; // Poll cada 500ms

    return new Promise((resolve) => {
      const pollConnection = () => {
        if (connectionState.connectionStatus === 'connected') {
          resolve({
            success: true,
            connected: true,
            elapsedMs: Date.now() - startTime,
            message: 'WhatsApp conectado exitosamente'
          });
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          resolve({
            success: false,
            connected: false,
            elapsedMs: elapsed,
            message: `Timeout esperando conexión (${(elapsed / 1000).toFixed(1)}s)`,
            currentStatus: connectionState.connectionStatus
          });
          return;
        }

        // Continuar esperando
        setTimeout(pollConnection, pollInterval);
      };

      // Iniciar polling
      pollConnection();
    });
  },

  /**
   * Intenta iniciar la conexión de WhatsApp usando las credenciales existentes.
   * - Si ya está conectado, retorna success=true y alreadyConnected=true
   * - Si no hay credenciales válidas, retorna success=false con mensaje
   * - Intenta crear una nueva sesión llamando a createNewSession()
   */
  async startConnection(timeoutMs = 30000) {
    try {
      if (connectionState.connectionStatus === 'connected' && connectionState.socket) {
        return { success: true, message: 'Ya conectado', alreadyConnected: true };
      }

      // Validar credenciales disponibles
      const validation = await sessionManager.validateCredentials();
      if (!validation.valid) {
        return { success: false, message: 'No hay credenciales válidas en auth_info', error: validation.reason || 'no_credentials' };
      }

      // Marcar estado y limpiar conexión previa
      connectionState.isConnecting = true;
      connectionState.connectionStatus = 'connecting';

      try {
        await cleanupConnection();
      } catch (cleanupErr) {
        console.warn('Advertencia al limpiar conexión previa antes de startConnection', { error: cleanupErr.message });
      }

      // Intentar crear nueva sesión inmediatamente
      try {
        connectionState.socket = await createNewSession();

        // Esperar hasta connected o timeout
        const waitResult = await this.waitForConnection(timeoutMs).catch(() => null);

        // Actualizar estado final
        const finalStatus = connectionState.connectionStatus === 'connected';
        return {
          success: finalStatus,
          message: finalStatus ? 'Conexión establecida' : 'Sesión creada pero no se alcanzó estado connected dentro del timeout',
          alreadyConnected: false,
          connected: finalStatus
        };
      } catch (sessionErr) {
        connectionState.isConnecting = false;
        connectionState.connectionStatus = 'disconnected';
        console.error('Error creando nueva sesión en startConnection', { error: sessionErr.message });
        return { success: false, message: 'Error al crear nueva sesión', error: sessionErr.message };
      }
    } catch (err) {
      console.error('Error en startConnection:', { error: err.message });
      return { success: false, message: 'Error interno', error: err.message };
    }
  },

 
};

//funcion para llegada de mensajes
 
