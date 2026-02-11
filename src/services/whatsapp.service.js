import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { getTemplate, getTemplateMessage } from '../templates.js';
import logger from '../utils/logger.js';
import { emitQrStatusUpdate } from '../app.js';
import { getWhatsAppConfig } from '../config/whatsapp.config.js';
//import { chatbotFlow } from '../chatbot/chatbotFlow.js';  # se ha deshabilitado el chatbot para este servicio
import sessionManager from './session.manager.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  // No cerrar el proceso, solo loggear el error
  console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason: reason?.message || reason,
    promise: promise,
    timestamp: new Date().toISOString()
  });

  // No cerrar el proceso, solo loggear el error
  console.error('❌ Unhandled Rejection:', reason);
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

  logger.info("✅ WhatsApp Bot iniciado y escuchando mensajes...");
}


// Función para limpiar completamente el estado
async function cleanupConnection() {
  if (connectionState.socket?.ev) {
    connectionState.socket.ev.removeAllListeners();
  }

  if (connectionState.socket) {
    try {
      await connectionState.socket.end();
      logger.debug('Socket closed successfully');
    } catch (error) {
      logger.debug('Socket already closed or error closing', { error: error.message });
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
      expiresAt: Date.now() + (100 * 365 * 24 * 60 * 60 * 1000), // permanente (~100 años)
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
      logger.error('Error emitting QR status update', { error: emitError.message });
    }

    logger.info('QR generated from connection update', {
      format: qrResult.format,
      size: qrResult.size,
      mimeType: qrResult.mimeType,
      fallback: qrResult.fallback || false
    });
  } catch (error) {
    logger.error('Error generating QR from update', { error: error.message, stack: error.stack });
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
          logger.error('Error removing QR handler', { error: error.message });
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
                    expiresAt: Date.now() + (100 * 365 * 24 * 60 * 60 * 1000), // permanente (~100 años)
                    createdAt: new Date().toISOString(),
                    qrString: update.qr,
                    format: qrResult.format,
                    size: qrResult.size,
                    mimeType: qrResult.mimeType,
                    fallback: qrResult.fallback || false
                  };
                  resolve(qrResult.image);
                } catch (error) {
                  logger.error('Error setting QR data', { error: error.message });
                  reject(error);
                }
              })
              .catch(reject);
          } catch (error) {
            logger.error('Error in QR handler', { error: error.message });
            reject(error);
          }
        }
      };

      session.ev.on('connection.update', qrHandler);
    } catch (error) {
      logger.error('Error setting up QR generation', { error: error.message });
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
    logger.warn('Max reconnection attempts reached or already reconnecting', {
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
      
      logger.info('🔄 Attempting automatic reconnection', {
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
          logger.info('💾 Usando resultado cacheado de health check', {
            age: `${Math.floor((now - connectionState.lastHealthCheckTimestamp) / 1000)}s`,
            status: connectionState.lastHealthCheckResult.status
          });
          healthCheck = connectionState.lastHealthCheckResult;
        } else {
          logger.info('🏥 Verificando salud de WhatsApp antes de reintentar...');
          
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
          
          logger.warn('⚠️ WhatsApp no disponible - esperando con backoff exponencial', {
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
              logger.info('🔧 Modo mantenimiento: Verificación periódica de WhatsApp...');
            } else {
              logger.info('⏰ Reintentando verificación de WhatsApp después de backoff...');
            }
            
            // No incrementar reconnectAttempts aquí, solo healthCheckAttempts
            connectionState.reconnectAttempts--; // Compensar el incremento anterior
            attemptReconnect();
          }, healthCheckDelay);
          
          return;
        }
        
        // WhatsApp está disponible, resetear contador de health checks
        logger.info('✅ WhatsApp disponible - procediendo con reconexión');
        connectionState.healthCheckAttempts = 0;
        
        // 🔍 VALIDACIÓN DE CREDENCIALES: Si WhatsApp está OK
        const validation = await sessionManager.validateCredentials();
        
        if (!validation.valid) {
          logger.warn('⚠️ Credenciales detectadas como inválidas', {
            status: validation.status,
            reason: validation.reason
          });
          
          // Si están CORRUPTAS y WhatsApp está online, es seguro limpiar
          if (validation.status === 'corrupted') {
              logger.warn('⚠️ Credenciales corruptas detectadas - no se realizará limpieza automática', {
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
                logger.error('Error emitting QR status update for corrupted credentials', { error: emitError.message });
              }

              return;
            }

            // Si son inválidas pero no corruptas, continuar intentando
            logger.warn('Credenciales inválidas pero no corruptas - continuando reintentos');
        }
      }

      // Proceder con reconexión normal
      connectionState.connectionStatus = 'connecting';

      await cleanupConnection();
      connectionState.socket = await createNewSession();

      logger.info('✅ Reconnection successful');
      connectionState.reconnectAttempts = 0;
      connectionState.healthCheckAttempts = 0;
      connectionState.isReconnecting = false;
      
      // Resetear contador de fallos en SessionManager
      sessionManager.resetFailureCounter();

    } catch (error) {
      logger.error('❌ Reconnection failed', {
        error: error.message,
        attempt: connectionState.reconnectAttempts,
        stack: error.stack
      });

      connectionState.isReconnecting = false;
      
      // Registrar fallo en SessionManager
      sessionManager.recordFailedAttempt();

      // Intentar de nuevo si no se alcanzó el límite
      if (connectionState.reconnectAttempts < maxAttempts) {
        logger.info(`🔄 Programando reintento ${connectionState.reconnectAttempts + 1}/${maxAttempts}`);
        attemptReconnect();
      } else {
        logger.error('🛑 Límite de reintentos alcanzado - se requiere intervención manual');
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

  logger.warn('Stream error detected', {
    error: error.message,
    code: update?.lastDisconnect?.error?.data?.attrs?.code,
    statusCode: update?.lastDisconnect?.statusCode
  });

  // Si es un error de stream que requiere restart (código 515)
  if (update?.lastDisconnect?.error?.data?.attrs?.code === '515' ||
    error.message?.includes('Stream Errored') ||
    update?.lastDisconnect?.error?.message?.includes('restart required')) {

    logger.info('Stream error requires restart, attempting reconnection');

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
    sock.ev.on('connection.update', (update) => {
      try {
        logger.info('Connection update', {
          connection: update.connection,
          lastDisconnect: update.lastDisconnect,
          qr: update.qr ? 'present' : 'absent'
        });

        // Manejar cambios de estado de conexión
        if (update.connection === 'connecting') {
          connectionState.connectionStatus = 'connecting';
          connectionState.isConnecting = true;
          connectionState.reconnectAttempts = 0;
          connectionState.lastConnectionAttempt = Date.now();
        } else if (update.connection === 'open') {
          connectionState.connectionStatus = 'connected';
          connectionState.isConnecting = false;
          // connectionState.qrData = null; // Mantener QR hasta eliminación manual
          connectionState.reconnectAttempts = 0;
          connectionState.isReconnecting = false;
          logger.info('WhatsApp connected successfully');

          emitQrStatusUpdate(getQRStatus());
        } else if (update.connection === 'close') {
          connectionState.connectionStatus = 'disconnected';
          connectionState.isConnecting = false;

          logger.warn('Connection closed', {
            reason: update.lastDisconnect?.error?.message || 'unknown',
            statusCode: update.lastDisconnect?.statusCode
          });

          // Manejar errores de stream específicamente
          if (update.lastDisconnect?.error?.data?.attrs?.code === '515' ||
            update.lastDisconnect?.error?.message?.includes('Stream Errored') ||
            update.lastDisconnect?.error?.message?.includes('restart required')) {
            handleStreamError(update.lastDisconnect.error, update);
          }

          emitQrStatusUpdate(getQRStatus());
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

async function getImageBase64(imgPath) {
  try {
    const baseUrl = process.env.BASE_URL;
    if (imgPath.startsWith(`${baseUrl}/public/`)) {
      // Convertir URL local en ruta de archivo
      const relativePath = imgPath.replace(`${baseUrl}/public/`, '');
      const fullPath = path.resolve(process.cwd(), 'src', 'public', relativePath);

      logger.info('Leyendo imagen localmente desde BASE_URL', { imgPath, fullPath, baseUrl });

      // Leer archivo localmente
      const imageBuffer = await fs.promises.readFile(fullPath);
      return imageBuffer;
    } else if (imgPath.startsWith("http")) {
      // Para URLs externas reales, usar fetch con timeout
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

// API Pública
export default {
  async requestQR(userId) {
    
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

  async sendMessage({ telefono, templateOption, nombre, fecha, hora, productoName }) {
    if (!connectionState.socket?.user) {
      throw new Error("No conectado a WhatsApp. Por favor, escanea el código QR primero.");
    }

    const cleanPhone = telefono.replace(/\D/g, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      throw new Error("El número de teléfono debe tener entre 10 y 15 dígitos");
    }

    const formattedPhone = `${cleanPhone}@s.whatsapp.net`;

    // 🔹 Obtiene la plantilla (objeto con text + image)
    const plantilla = getTemplate(productoName, templateOption, { nombre});

    if (!plantilla || !plantilla.text) {
      throw new Error("Plantilla de mensaje no válida");
    }

    let messagePayload = { text: plantilla.text };

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

  if (!image) {
    throw new Error("La imagen es obligatoria");
  }

  /* =========================
     1️⃣ VALIDAR TELÉFONO
  ========================= */
  const cleanPhone = telefono.replace(/\D/g, "");
  if (cleanPhone.length < 10 || cleanPhone.length > 15) {
    throw new Error("El número debe tener entre 10 y 15 dígitos");
  }

  const formattedPhone = `${cleanPhone}@s.whatsapp.net`;

  /* =========================
    2️⃣ OBTENER IMAGEN REAL
========================= */
const imageBuffer = await getImageBase64(image);

if (!imageBuffer) {
  
  console.error("Ruta de imagen no encontrada:", image);
  throw new Error("No se pudo cargar la imagen seleccionada. Verifique que el archivo exista en el servidor.");
}
  /* =========================
     3️⃣ PAYLOAD EXACTO
  ========================= */
  const messagePayload = {
    image: imageBuffer,
    caption: text
  };

  try {
    logger.info("📤 Enviando mensaje dashboard", {
      telefono: formattedPhone,
      templateOption,
      captionPreview: text.substring(0, 80),
      imageUsed: image
    });

    const result = await connectionState.socket.sendMessage(
      formattedPhone,
      messagePayload
    );

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

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      throw new Error('El número de teléfono debe tener entre 10 y 15 dígitos');
    }

    const formattedPhone = `${cleanPhone}@s.whatsapp.net`;

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

      // Preparar mensaje con imagen
      const messageOptions = {
        image: imageBuffer,
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
  async sendCampaignBatch({ campania_id, chunk_number, recipients, message, image_url, id_servicio }) {
    const results = {};
    let successful = 0;
    let failed = 0;

    console.log(`\n🚀 [Campaña ${campania_id}] Iniciando chunk ${chunk_number} con ${recipients.length} destinatarios`);
    
    // Verificar conexión
    if (!connectionState.socket || connectionState.connectionStatus !== 'connected') {
      throw new Error('WhatsApp no está conectado. Por favor, escanea el código QR.');
    }

    // Descargar imagen una sola vez
    let imageBuffer = null;
    if (image_url) {
      try {
        console.log(`📥 Descargando imagen desde: ${image_url}`);
        const imageResponse = await fetch(image_url);
        
        if (!imageResponse.ok) {
          throw new Error(`Error al descargar imagen: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        
        imageBuffer = await imageResponse.arrayBuffer();
        console.log(`✅ Imagen descargada: ${(imageBuffer.byteLength / 1024).toFixed(2)} KB`);
      } catch (error) {
        console.error(`❌ Error descargando imagen:`, error.message);
        throw new Error(`No se pudo descargar la imagen de la campaña: ${error.message}`);
      }
    }

    // Procesar cada destinatario con rate limiting
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const { id_modalservicio, nombre, telefono } = recipient;

      try {
        console.log(`\n📤 [${i + 1}/${recipients.length}] Enviando a ${nombre} (${telefono})...`);

        // Formatear teléfono (asegurar que tenga @s.whatsapp.net)
        const formattedPhone = telefono.includes('@') 
          ? telefono 
          : `${telefono}@s.whatsapp.net`;

        // Preparar mensaje
        let messagePayload;
        if (imageBuffer) {
          messagePayload = {
            image: Buffer.from(imageBuffer),
            caption: `Hola ${nombre}! 👋\n\n${message}`
          };
        } else {
          messagePayload = {
            text: `Hola ${nombre}! 👋\n\n${message}`
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
        console.log(`✅ Enviado exitosamente a ${nombre}`);

        // Rate limiting: Esperar entre 4-7 segundos entre mensajes
        if (i < recipients.length - 1) {
          const delay = Math.floor(Math.random() * 3000) + 4000; // 4-7 segundos
          console.log(`⏳ Esperando ${(delay / 1000).toFixed(1)}s antes del siguiente envío...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error) {
        console.error(`❌ Error enviando a ${nombre} (${telefono}):`, error.message);
        
        results[id_modalservicio] = {
          success: false,
          error: error.message || 'Error desconocido'
        };

        failed++;

        // Si hay error de conexión, detener el batch
        if (error.message.includes('disconnected') || error.message.includes('not-authorized')) {
          console.error(`🛑 Error crítico de conexión. Deteniendo batch.`);
          
          // Marcar los restantes como fallidos
          for (let j = i + 1; j < recipients.length; j++) {
            results[recipients[j].id_modalservicio] = {
              success: false,
              error: 'Batch detenido por error de conexión'
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

    console.log(`\n📊 [Campaña ${campania_id}] Chunk ${chunk_number} completado:`);
    console.log(`   ✅ Exitosos: ${successful}`);
    console.log(`   ❌ Fallidos: ${failed}`);

    return {
      campania_id,
      chunk_number,
      id_servicio,
      total: recipients.length,
      successful,
      failed,
      results
    };
  },

  // Método para enviar mensajes simples (aceptación/rechazo)
  async sendSimpleMessage({ phone, message, type, useTemplate = false }) {
    if (!connectionState.socket?.user) {
      throw new Error('No conectado a WhatsApp. Por favor, escanea el código QR primero.');
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      throw new Error('El número de teléfono debe tener entre 10 y 15 dígitos');
    }

    const formattedPhone = `${cleanPhone}@s.whatsapp.net`;

    // Importar las funciones de template
    const { getAcceptanceTemplate, getRejectionTemplate } = await import('../templates.js');
    
    let finalMessage = message;
    
    // Si se debe usar template, aplicar el correspondiente según el tipo
    if (useTemplate) {
      if (type === 'accept') {
        finalMessage = getAcceptanceTemplate(message);
      } else if (type === 'reject') {
        finalMessage = getRejectionTemplate(message);
      }
    }

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


 
};

//funcion para llegada de mensajes
 
