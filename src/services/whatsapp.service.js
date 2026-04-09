import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { interpolateMessage } from '../utils/messageUtils.js';
import { normalizePhone } from '../utils/normalizePhone.js';
import { downloadImageFromUrl } from '../utils/imageProcessor.js';
import { IMAGE_CONFIG, TIMING_CONFIG } from '../config/constants.js';
import whatsappSessionLogger from '../utils/whatsappSessionLogger.js';
import logger from '../utils/logger.js';
// Local console shadow that routes module-level console.* calls to centralized logger
const console = {
  log: (...args) => logger.info(typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]), args[1] || {}),
  info: (...args) => logger.info(typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]), args[1] || {}),
  warn: (...args) => logger.warn(typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]), args[1] || {}),
  error: (...args) => logger.error(typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]), args[1] || {}),
  debug: (...args) => logger.debug(typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]), args[1] || {})
};
import { emitQrStatusUpdate } from '../app.js';
import { getWhatsAppConfig } from '../config/whatsapp.config.js';
//import { chatbotFlow } from '../chatbot/chatbotFlow.js';  # se ha deshabilitado el chatbot para este servicio
import sessionManager from './session.manager.js';
import { clearAuthContent } from '../triggers/clearAuthTrigger.js';
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
  const config = getWhatsAppConfig();

  const sock = makeWASocket({
    printQRInTerminal: config.security?.printQRInTerminal || false,
    auth: state,
    mediaTimeoutMs: TIMING_CONFIG.CONNECTION_TIMEOUT_MS,
    connectTimeoutMs: TIMING_CONFIG.CONNECTION_TIMEOUT_MS,
    // Create Pino logger instance that writes directly to logs/baileys.log
    // All Baileys events (level 20-50) go to file; summaries emitted to main logger
    logger: (() => {
      const baileyLogFile = process.env.BAILEYS_LOG_FILE || path.join(process.cwd(), 'logs', 'baileys.log');
      const demoteLevel = (process.env.BAILEYS_DEMOTE_LEVEL || 'warn');
      const showGroups = process.env.LOG_GROUP_MESSAGES === 'true';
      const logToFile = process.env.BAILEYS_LOG_TO_FILE !== 'false';

      // Ensure log directory exists
      try { fs.mkdirSync(path.dirname(baileyLogFile), { recursive: true }); } catch (e) { /* ignore */ }

      // Create Pino instance that writes to baileys.log using native destination (with sync: true for reliability)
      const pinoInstance = logToFile ? pino(
        { level: 'debug' },
        pino.destination({ dest: baileyLogFile, sync: true })
      ) : pino({ level: 'debug' });
      
      // Write initialization marker to verify pino is working
      if (logToFile) {
        pinoInstance.info({ ts: new Date().toISOString() }, 'Baileys logger initialized');
      }

      function isGroupMeta(obj) {
        try {
          const jid = obj?.msgAttrs?.from || obj?.key?.remoteJid || obj?.meta?.key?.remoteJid || obj?.key?.participant;
          return typeof jid === 'string' && jid.endsWith('@g.us');
        } catch (_) { return false; }
      }

      // Aggregation state for log deduplication during time window
      const aggregateWindow = process.env.BAILEYS_AGGREGATE_WINDOW_MS || 12000;
      const aggregateActive = process.env.BAILEYS_AGGREGATE_ACTIVE === 'true';
      const aggregation = {
        errors: new Map(), // { errorName: count }
        infos: new Map(),
        warns: new Map(),
        firstTimestamp: null,
        timeoutId: null
      };

      function flushAggregation() {
        if (aggregation.errors.size > 0 || aggregation.warns.size > 0) {
          const entries = [];
          for (const [name, count] of aggregation.errors) {
            entries.push(`${name} (${count}x)`);
          }
          for (const [name, count] of aggregation.warns) {
            entries.push(`${name} (${count}x)`);
          }
          const summary = entries.join(', ');
          try { logger[demoteLevel](`[Baileys Aggregated] ${summary} - See baileys.log for details`, { source: 'baileys' }); } catch (e) {}
        }
        aggregation.errors.clear();
        aggregation.warns.clear();
        aggregation.infos.clear();
        aggregation.firstTimestamp = null;
      }

      function scheduleFlush() {
        if (aggregation.timeoutId) clearTimeout(aggregation.timeoutId);
        aggregation.timeoutId = setTimeout(() => {
          flushAggregation();
        }, aggregateWindow);
      }

      function extractErrorName(msg, obj) {
        // Check obj.err first (Baileys structure)
        if (obj?.err?.name) {
          const name = obj.err.name;
          // Handle "Bad MAC" and similar cryptographic errors
          if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
          return name;
        }
        if (obj?.error?.name) {
          const name = obj.error.name;
          if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
          return name;
        }
        
        // Check msg parameter (sometimes error info comes here)
        if (typeof msg === 'object') {
          if (msg?.err?.name) {
            const name = msg.err.name;
            if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
            return name;
          }
          if (msg?.name) {
            const name = msg.name;
            if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
            return name;
          }
        }
        
        // Check string message
        if (typeof msg === 'string') {
          // Normalize "Bad MAC" errors
          if (msg.includes('Bad MAC')) return 'BadMacError';
          // Filter out random/junk messages (too short or random hex/noise)
          if (msg.length > 200 || /^[0-9a-f]{32,}$/.test(msg)) return 'NoiseError';
          // Keep readable short messages
          if (msg.length < 100) return msg;
        }
        
        return 'Unknown';
      }

      // Wrapper to emit summaries to main logger while Pino writes full details to file
      const loggerWrapper = {
        level: 'debug',
        info: (msg, obj) => {
          if (!isGroupMeta(obj) || showGroups) {
            pinoInstance.info(obj || {}, msg);
          }
        },
        warn: (msg, obj) => {
          if (!isGroupMeta(obj) || showGroups) {
            // If aggregation active, accumulate instead of emitting immediately
            if (aggregateActive) {
              const errName = extractErrorName(msg, obj);
              aggregation.warns.set(errName, (aggregation.warns.get(errName) || 0) + 1);
              if (!aggregation.firstTimestamp) aggregation.firstTimestamp = Date.now();
              // Write to file always, but only suppress console output during window
              pinoInstance.warn(obj || {}, msg);
              scheduleFlush();
            } else {
              // No aggregation, emit directly
              pinoInstance.warn(obj || {}, msg);
            }
          }
        },
        error: (msg, obj) => {
          if (!isGroupMeta(obj) || showGroups) {
            // If aggregation active, only accumulate - don't write immediately
            if (aggregateActive) {
              const errName = extractErrorName(msg, obj);
              aggregation.errors.set(errName, (aggregation.errors.get(errName) || 0) + 1);
              if (!aggregation.firstTimestamp) aggregation.firstTimestamp = Date.now();
              // Only flush summary to console, details already in pinoInstance
              scheduleFlush();
            } else {
              // No aggregation, emit directly to both file and console
              pinoInstance.error(obj || {}, msg);
            }
          }
        },
        debug: (msg, obj) => {
          if (!isGroupMeta(obj) || showGroups) {
            pinoInstance.debug(obj || {}, msg);
          }
        },
        trace: (msg, obj) => {
          if (!isGroupMeta(obj) || showGroups) {
            pinoInstance.trace(obj || {}, msg);
          }
        },
        // Baileys uses child() to create child loggers; return self to maintain reference
        child: () => loggerWrapper
      };
      return loggerWrapper;
    })(),
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
    // Ignore messages without a conversation or messages sent by this bot
    if (!msg.message?.conversation || msg.key.fromMe) return;

    const remote = String(msg.key.remoteJid || '');
    // By default ignore group messages to reduce terminal noise. To enable
    // group message processing set `LOG_GROUP_MESSAGES=true` in environment.
    if (remote.endsWith('@g.us') && process.env.LOG_GROUP_MESSAGES !== 'true') {
      // Optionally log a single-line debug when first ignoring groups (commented)
      // logger.debug('Ignored group message', { from: remote, id: msg.key.id });
      return;
    }

    const userId = remote;
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
      console.debug('Socket already closed or error closing', { err: error });
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
      expiresAt: Date.now() + TIMING_CONFIG.QR_EXPIRY_MS, // 4 minutos
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
      console.error('Error emitting QR status update', { err: emitError });
    }

    console.info('QR generated from connection update', {
      format: qrResult.format,
      size: qrResult.size,
      mimeType: qrResult.mimeType,
      fallback: qrResult.fallback || false
    });
  } catch (error) {
    console.error('Error generating QR from update', { err: error });
  }
}

// Función para generar QR con timeout
async function generateNewQR(session) {
  return new Promise((resolve, reject) => {
    try {
      const config = getWhatsAppConfig();
      const qrTimeout = TIMING_CONFIG.QR_TIMEOUT_MS;

      const timeoutId = setTimeout(() => {
        try {
          session.ev.off('connection.update', qrHandler);
        } catch (error) {
          console.error('Error removing QR handler', { err: error });
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
                    expiresAt: Date.now() + TIMING_CONFIG.QR_EXPIRY_MS, // 4 minutos
                    createdAt: new Date().toISOString(),
                    qrString: update.qr,
                    format: qrResult.format,
                    size: qrResult.size,
                    mimeType: qrResult.mimeType,
                    fallback: qrResult.fallback || false
                  };
                  resolve(qrResult.image);
                } catch (error) {
                  console.error('Error setting QR data', { err: error });
                  reject(error);
                }
              })
              .catch(reject);
          } catch (error) {
            console.error('Error in QR handler', { err: error });
            reject(error);
          }
        }
      };

      session.ev.on('connection.update', qrHandler);
    } catch (error) {
      console.error('Error setting up QR generation', { err: error });
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
                  console.error('Error emitting QR status update for corrupted credentials', { err: emitError });
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
      // Create Pino logger instance that writes directly to logs/baileys.log
      // All Baileys events (level 20-50) go to file; summaries emitted to main logger
      logger: (() => {
        const baileyLogFile = process.env.BAILEYS_LOG_FILE || path.join(process.cwd(), 'logs', 'baileys.log');
        const demoteLevel = (process.env.BAILEYS_DEMOTE_LEVEL || 'warn');
        const showGroups = process.env.LOG_GROUP_MESSAGES === 'true';
        const logToFile = process.env.BAILEYS_LOG_TO_FILE !== 'false';

        // Ensure log directory exists
        try { fs.mkdirSync(path.dirname(baileyLogFile), { recursive: true }); } catch (e) { /* ignore */ }

        // Create Pino instance that writes to baileys.log using native destination (with sync: true for reliability)
        const pinoInstance = logToFile ? pino(
          { level: 'debug' },
          pino.destination({ dest: baileyLogFile, sync: true })
        ) : pino({ level: 'debug' });
        
        // Write initialization marker to verify pino is working
        if (logToFile) {
          pinoInstance.info({ ts: new Date().toISOString() }, 'Baileys logger initialized');
        }

        function isGroupMeta(obj) {
          try {
            const jid = obj?.msgAttrs?.from || obj?.key?.remoteJid || obj?.meta?.key?.remoteJid || obj?.key?.participant;
            return typeof jid === 'string' && jid.endsWith('@g.us');
          } catch (_) { return false; }
        }

        // Aggregation state for log deduplication during time window
        const aggregateWindow = process.env.BAILEYS_AGGREGATE_WINDOW_MS || 12000;
        const aggregateActive = process.env.BAILEYS_AGGREGATE_ACTIVE === 'true';
        const aggregation = {
          errors: new Map(), // { errorName: count }
          infos: new Map(),
          warns: new Map(),
          firstTimestamp: null,
          timeoutId: null
        };

        function flushAggregation() {
          if (aggregation.errors.size > 0 || aggregation.warns.size > 0) {
            const entries = [];
            for (const [name, count] of aggregation.errors) {
              entries.push(`${name} (${count}x)`);
            }
            for (const [name, count] of aggregation.warns) {
              entries.push(`${name} (${count}x)`);
            }
            const summary = entries.join(', ');
            try { logger[demoteLevel](`[Baileys Aggregated] ${summary} - See baileys.log for details`, { source: 'baileys' }); } catch (e) {}
          }
          aggregation.errors.clear();
          aggregation.warns.clear();
          aggregation.infos.clear();
          aggregation.firstTimestamp = null;
        }

        function scheduleFlush() {
          if (aggregation.timeoutId) clearTimeout(aggregation.timeoutId);
          aggregation.timeoutId = setTimeout(() => {
            flushAggregation();
          }, aggregateWindow);
        }

        function extractErrorName(msg, obj) {
          // Check obj.err first (Baileys structure)
          if (obj?.err?.name) {
            const name = obj.err.name;
            // Handle "Bad MAC" and similar cryptographic errors
            if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
            return name;
          }
          if (obj?.error?.name) {
            const name = obj.error.name;
            if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
            return name;
          }
          
          // Check msg parameter (sometimes error info comes here)
          if (typeof msg === 'object') {
            if (msg?.err?.name) {
              const name = msg.err.name;
              if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
              return name;
            }
            if (msg?.name) {
              const name = msg.name;
              if (name.includes('Bad MAC') || name.includes('BadMac')) return 'BadMacError';
              return name;
            }
          }
          
          // Check string message
          if (typeof msg === 'string') {
            // Normalize "Bad MAC" errors
            if (msg.includes('Bad MAC')) return 'BadMacError';
            // Filter out random/junk messages (too short or random hex/noise)
            if (msg.length > 200 || /^[0-9a-f]{32,}$/.test(msg)) return 'NoiseError';
            // Keep readable short messages
            if (msg.length < 100) return msg;
          }
          
          return 'Unknown';
        }

        // Wrapper to emit summaries to main logger while Pino writes full details to file
        const loggerWrapper = {
          level: 'debug',
          info: (msg, obj) => {
            if (!isGroupMeta(obj) || showGroups) {
              pinoInstance.info(obj || {}, msg);
            }
          },
          warn: (msg, obj) => {
            if (!isGroupMeta(obj) || showGroups) {
              if (aggregateActive) {
                const errName = extractErrorName(msg, obj);
                aggregation.warns.set(errName, (aggregation.warns.get(errName) || 0) + 1);
                if (!aggregation.firstTimestamp) aggregation.firstTimestamp = Date.now();
                pinoInstance.warn(obj || {}, msg);
                scheduleFlush();
              } else {
                pinoInstance.warn(obj || {}, msg);
              }
            }
          },
          error: (msg, obj) => {
            if (!isGroupMeta(obj) || showGroups) {
              if (aggregateActive) {
                const errName = extractErrorName(msg, obj);
                aggregation.errors.set(errName, (aggregation.errors.get(errName) || 0) + 1);
                if (!aggregation.firstTimestamp) aggregation.firstTimestamp = Date.now();
                scheduleFlush();
              } else {
                pinoInstance.error(obj || {}, msg);
              }
            }
          },
          debug: (msg, obj) => {
            if (!isGroupMeta(obj) || showGroups) {
              pinoInstance.debug(obj || {}, msg);
            }
          },
          trace: (msg, obj) => {
            if (!isGroupMeta(obj) || showGroups) {
              pinoInstance.trace(obj || {}, msg);
            }
          },
          // Baileys uses child() to create child loggers; return self to maintain reference
          child: () => loggerWrapper
        };
        return loggerWrapper;
      })(),
      connectTimeoutMs: TIMING_CONFIG.CONNECTION_TIMEOUT_MS,
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
      // NOTE: previously there was an emitQrStatusUpdate try/catch here by
      // mistake which resulted in a syntax error. That block has been removed
      // (it was duplicated from the reconnection logic). Emission of QR
      // updates should happen in the reconnection/backoff flow where needed.
    });

    // Configurar event handlers para mejor manejo de conexión
    sock.ev.on('connection.update', async (update) => {
      try {
        logger.info('Connection update', {
          connection: update.connection,
          lastDisconnect: update.lastDisconnect,
          qr: update.qr ? 'present' : 'absent'
        });

        // Delegate to session manager for debounce/verification and potential auth_info cleanup
        try { sessionManager.handleConnectionUpdate(update); } catch (e) { logger.error('sessionManager.handleConnectionUpdate failed', { err: e }); }

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
              logger.error('Error emitting disconnection status', { err: emitError });
          }
        }

        // Manejar QR
        if (update.qr) {
          logger.info('New QR received');
          generateQRFromUpdate(update.qr);
        }
      } catch (error) {
        logger.error('Error handling connection update', { err: error });
      }
    });

    // Registrar escuchador para guardado de credenciales
    sock.ev.on('creds.update', saveCreds);

    return sock;
  } catch (error) {
    logger.error('Error creating new session', { err: error });
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
    logger.error('Error generating optimal QR', { err: error, format });

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

/*
[DEPRECATED - USE imageProcessor.js INSTEAD]
Descarga imagen desde URL o ruta local y retorna Buffer
Reemplazada por downloadImageFromUrl() y readImageFromLocal() en src/utils/imageProcessor.js

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
*/

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

    const webhookLogger = logger.child('WEBHOOK');
    webhookLogger.formatted(`Enviando webhook a ${backendUrl}`, '🔔', { payload: webhookPayload });

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
    webhookLogger.formatted('Webhook entregado exitosamente', '✅', { status: response.status, response: responseData });

    return {
      success: true,
      message: 'Webhook enviado correctamente',
      response: responseData
    };
  } catch (error) {
    const webhookLogger = logger.child('WEBHOOK');
    webhookLogger.formatted('Error entregando webhook', '❌', {
      error: error.message,
      recipient: webhookPayload?.recipient?.nombre || webhookPayload?.id_modalservicio,
      status: webhookPayload?.status
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
        logger.error('Error during cleanup', { err: cleanupError });
      }

      try {
        connectionState.socket = await createNewSession();
      } catch (sessionError) {
        logger.error('Error creating new session', { err: sessionError });
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
        logger.error('Error resetting state', { err: resetError });
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
  let imageBuffer = null;
  if (image) {
    if (Buffer.isBuffer(image)) {
      // Ya es Buffer (descargado en controller)
      imageBuffer = image;
      logger.info("Buffer de imagen recibido en service", { tamaño: imageBuffer.length });
    } else {
      // Es string (ruta/URL), descargar aquí
      try {
        console.log(`📥 Descargando imagen desde: ${image}`);
        imageBuffer = await downloadImageFromUrl(image, { validate: true, strict: false });
        if (!imageBuffer) {
          console.warn("⚠️ No se pudo descargar imagen, continuando sin ella");
        } else {
          console.log(`✅ Imagen descargada: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
        }
      } catch (error) {
        // Modal WAT es lenient (continúa sin imagen)
        console.warn(`⚠️ Error descargando imagen: ${error.message}`);
        imageBuffer = null;
      }
    }
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
  async sendMessageWithImage({ imageUrl, phone, caption }) {
    if (!connectionState.socket?.user) {
      throw new Error('No conectado a WhatsApp. Por favor, escanea el código QR primero.');
    }

    // Normalizar y aceptar números locales (ej. 9 dígitos). Prepend DEFAULT_COUNTRY_CODE si falta.
    // Centralized normalizer
    const formattedPhone = normalizePhone(phone);

    // Validar URL de imagen
    if (!imageUrl) {
      throw new Error('La URL de la imagen es requerida');
    }

    let imageBuffer;
    try {
      imageBuffer = await downloadImageFromUrl(imageUrl, { validate: true, strict: true });
    } catch (error) {
      throw new Error(`No se pudo descargar la imagen: ${error.message}`);
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
      logger.warn('Error generando thumbnail', { err: error });
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
      logger.error('Error generating QR in specific format', { err: error, format });
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
        logger.error('Error emitting QR format change', { err: emitError });
      }

      logger.info('QR format changed successfully', {
        newFormat: qrResult.format,
        size: qrResult.size,
        mimeType: qrResult.mimeType
      });

      return qrResult;
    } catch (error) {
      logger.error('Error changing QR format', { err: error, format });
      throw error;
    }
  },

  // ===============================
  // CAMPAÑA BATCH - Envío masivo
  // ===============================
  // [DEPRECATED] validateImage() y isValidImageBuffer() están comentados
  // Usar imageValidator.js en su lugar: validateImageMagicBytes(), validateImageBuffer(), validateImagePath()
  // async validateImage(imagePath) { ... }
  // isValidImageBuffer(buffer) { ... }

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

    // Obtener/leer imagen una sola vez (reutilizar para todos los recipients)
    let imageBuffer = null;
    if (image_url) {
      try {
        console.log(`📥 Obteniendo imagen desde: ${image_url}`);
        imageBuffer = await downloadImageFromUrl(image_url, { validate: true, strict: true });
        console.log(`✅ Imagen obtenida: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
      } catch (error) {
        console.error(`❌ Error obteniendo imagen:`, error.message);
        // En batch, el error es CRÍTICO (strict: true arriba lo lanza)
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
            .then(() => logger.child('WEBHOOK').formatted(`Webhook entregado para ${displayName}`, '✅', { recipient: cleanPhone, campaign_id: resolvedCampaignId }))
            .catch((webhookErr) => logger.child('WEBHOOK').formatted(`Error entregando webhook`, '❌', { recipient: nombre, error: webhookErr.message, campaign_id: resolvedCampaignId }));
        } catch (webhookErr) {
          logger.child('WEBHOOK').formatted(`Error preparando webhook`, '⚠️', { recipient: nombre, error: webhookErr.message });
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
            .then(() => logger.child('WEBHOOK').formatted(`Webhook de error entregado`, '✅', { recipient: nombre, campaign_id: resolvedCampaignId }))
            .catch((webhookErr) => logger.child('WEBHOOK').formatted(`Error entregando webhook de error`, '❌', { recipient: nombre, error: webhookErr.message }));
        } catch (webhookErr) {
          logger.child('WEBHOOK').formatted(`Error preparando webhook de error`, '⚠️', { recipient: nombre, error: webhookErr.message });
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
        console.warn('Advertencia al limpiar conexión previa antes de startConnection', { err: cleanupErr });
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
        console.error('Error creando nueva sesión en startConnection', { err: sessionErr });
        return { success: false, message: 'Error al crear nueva sesión', error: sessionErr.message };
      }
    } catch (err) {
      console.error('Error en startConnection:', { err: err });
      return { success: false, message: 'Error interno', error: err.message };
    }
  },

 
};

//funcion para llegada de mensajes
 
