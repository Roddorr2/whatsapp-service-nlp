/**
 * Constantes centralizadas de la aplicación
 * Evita números mágicos y facilita mantenimiento
 */

// ============================================
// 📸 CONFIGURACIÓN DE IMÁGENES
// ============================================
export const IMAGE_CONFIG = {
  // Tamaño máximo permitido (2MB límite general del proyecto)
  MAX_SIZE_BYTES: 2 * 1024 * 1024,
  MAX_SIZE_MB: 2,

  // Formatos soportados (sin GIFs por ahora)
  SUPPORTED_FORMATS: ['jpeg', 'png', 'webp'],

  // Timeout para descargas HTTP
  DOWNLOAD_TIMEOUT_MS: 30000,

  // Magic bytes para validación de tipo de archivo
  MAGIC_BYTES: {
    JPEG: [0xFF, 0xD8, 0xFF],
    PNG: [0x89, 0x50, 0x4E, 0x47],
    WEBP: {
      pattern: [0x52, 0x49, 0x46, 0x46], // RIFF
      check: [0x57, 0x45, 0x42, 0x50]    // WEBP
    }
  },

  // User-Agent para descargas
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// ============================================
// 📱 CONFIGURACIÓN DE WHATSAPP
// ============================================
export const WHATSAPP_CONFIG = {
  // Prefijo JID de WhatsApp
  JID_SUFFIX: '@s.whatsapp.net',

  // Rango válido de dígitos por número telefónico
  MIN_PHONE_DIGITS: 9,
  MAX_PHONE_DIGITS: 15
};

// ============================================
// 🔄 CAMPAÑA - CONFIGURACIÓN
// ============================================
export const CAMPAIGN_CONFIG = {
  // Delay entre envíos en ms (rate limiting)
  MESSAGE_DELAY_MS: 4000,

  // Delay adicional después de un error
  ERROR_DELAY_MS: 2000,

  // Máximo número de mensajes en historial
  MAX_HISTORY_SIZE: 100
};

// ============================================
// ⏱️ TIMEOUTS Y DELAYS
// ============================================
export const TIMING_CONFIG = {
  // Health check
  HEALTH_CHECK_CACHE_DURATION_MS: 45000,

  // QR
  QR_TIMEOUT_MS: 15000,
  QR_EXPIRY_MS: 120000, // 2 minutos

  // Reconexión (backoff exponencial)
  RECONNECT_DELAYS_MS: [3000, 10000, 30000, 60000, 120000],
  HEALTH_CHECK_DELAYS_MS: [60000, 120000, 300000, 600000, 900000]
};

// ============================================
// 🔐 SEGURIDAD
// ============================================
export const SECURITY_CONFIG = {
  // Límite de solicitudes de QR por hora por usuario
  QR_RATE_LIMIT_PER_HOUR: 100,

  // Ventana de tiempo para rate limiting (ms)
  RATE_LIMIT_WINDOW_MS: 3600000 // 1 hora
};
