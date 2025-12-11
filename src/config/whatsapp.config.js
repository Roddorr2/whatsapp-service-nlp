export const whatsappConfig = {
  // Configuración de conexión optimizada para velocidad
  connection: {
    connectTimeoutMs: 30_000, // Reducido de 60s a 30s
    keepAliveIntervalMs: 15_000, // Reducido de 20s a 15s
    retryRequestDelayMs: 1000, // Reducido de 2s a 1s
    maxRetries: 5, // Aumentado de 3 a 5
  },

  // Configuración del navegador optimizada (evita baneos)
  browser: {
    name: "Chrome",
    version: "120.0.0.0",
    os: "Windows"
  },

  // Configuraciones de seguridad optimizadas
  security: {
    printQRInTerminal: false,
    markOnlineOnConnect: true, // Cambiado a true para mejor estabilidad
    syncFullHistory: false,
    emitOwnEvents: false,
  },

  // Configuraciones de WebSocket optimizadas
  websocket: {
    timeout: 30_000, // Reducido de 60s a 30s
    keepalive: true,
    keepaliveInterval: 15_000, // Reducido de 20s a 15s
  },

  // Configuraciones de rate limiting más permisivas
  rateLimit: {
    maxMessagesPerMinute: 50, // Aumentado de 30 a 50
    maxMessagesPerHour: 200, // Aumentado de 100 a 200
    cooldownPeriod: 30000, // Reducido de 60s a 30s
  },

  // Configuraciones de QR optimizadas
  qr: {
    expirationTime: 120000, // Reducido de 3 minutos a 2 minutos
    maxRetries: 3, // Reducido de 5 a 3
    retryDelay: 5000, // Reducido de 10s a 5s
  },

  // Configuraciones de mensajes optimizadas
  messages: {
    maxRetries: 3,
    retryDelay: 1000, // Reducido de 2s a 1s
    maxMessageLength: 4096,
    maxHistorySize: 100,
  },

  // Configuraciones de logging optimizadas
  logging: {
    enableConnectionLogs: true,
    enableMessageLogs: true,
    enableErrorLogs: true,
    logLevel: 'info',
  },

  // Nuevas configuraciones para estabilidad
  stability: {
    // Reconexión automática después de errores
    autoReconnect: true,
    reconnectDelay: 3000, // 3 segundos
    maxReconnectAttempts: 5,
    
    // Manejo de errores de stream
    handleStreamErrors: true,
    streamErrorRetryDelay: 2000, // 2 segundos
    
    // Timeouts más agresivos
    connectionTimeout: 25000, // 25 segundos
    qrTimeout: 15000, // 15 segundos
    
    // Configuraciones de red
    networkTimeout: 20000, // 20 segundos
    pingInterval: 10000, // 10 segundos,
    
    // Configuraciones específicas para error 515
    handleError515: true,
    error515RetryDelay: 1000, // 1 segundo para error 515
    error515MaxRetries: 3, // Máximo 3 intentos para error 515
    error515BackoffMultiplier: 1.5, // Multiplicador de backoff
  }
};

// Función para obtener configuración específica
export function getWhatsAppConfig(section) {
  if (section) {
    return whatsappConfig[section] || {};
  }
  return whatsappConfig;
}

// Función para validar configuración
export function validateConfig() {
  const errors = [];
  
  if (whatsappConfig.connection.connectTimeoutMs < 10000) {
    errors.push('connectTimeoutMs debe ser al menos 10000ms');
  }
  
  if (whatsappConfig.connection.keepAliveIntervalMs < 5000) {
    errors.push('keepAliveIntervalMs debe ser al menos 5000ms');
  }
  
  if (whatsappConfig.rateLimit.maxMessagesPerMinute > 60) {
    errors.push('maxMessagesPerMinute no debe exceder 60');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
