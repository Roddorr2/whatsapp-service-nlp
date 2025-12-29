import whatsappService from "../services/whatsapp.service.js";
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { BASE_URL } from "../config/index.js";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function sendMessage(req, res) {
  try {
    const { nombre, templateOption, telefono, productoName } = req.body;

    if (!telefono || !templateOption) {
      return res.status(400).json({
        success: false,
        message: "telefono y templateOption son obligatorios",
      });
    }

    console.log("📩 Enviando mensaje:", { nombre, templateOption, telefono });

    const result = await whatsappService.sendMessage({
      nombre,
      templateOption,
      telefono,
      productoName
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("❌ Error en sendMessage:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
export async function sendMessageWithImageDashboard(req, res) {
  try {
    const { nombre, templateOption, telefono, fecha, hora } = req.body;

    const image = req.file
      ? `${BASE_URL}/public/imagenes_dashboard/${req.file.filename}`
      : null;
    
      console.log('image',image)
    
      const result = await whatsappService.sendMessageImageDashboard({
      nombre,
      templateOption,
      telefono,
      fecha,
      hora,
      image,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en sendMessageWithImage:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}



export function getStatus(req, res) {
  try {
    res.json({
      success: true,
      connected: whatsappService.isConnected(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error en getStatus:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo estado",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export function getQrStatus(req, res) {
  try {
    const qrStatus = whatsappService.getQRStatus();
    res.json({
      success: true,
      ...qrStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error en getStatus:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo estado",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export async function startConnection(req, res) {
  try {
    console.log(
      `🔌 Usuario ${req.user.username} solicitando inicio de conexión`,
    );

    const result = await whatsappService.startConnection();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        alreadyConnected: result.alreadyConnected || false,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        success: false,
        message: result.message,
        error: result.error,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Error al iniciar conexión:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor al iniciar conexión",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export function getQrCode(req, res) {
  try {
    const qrData = whatsappService.getQrCode();

    if (qrData) {
      return res.json({
        success: true,
        ...qrData,
        message: `QR válido por ${qrData.timeRemaining} segundos más`,
      });
    }

    return res.status(404).json({
      success: false,
      message:
        "No hay QR disponible. Solicita uno nuevo con POST /api/qr-request",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error en getQrCode:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo QR",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export async function requestNewQr(req, res) {
  try {
    const userId = req.user.userId;
    console.log(`📱 Usuario ${userId} solicitando nuevo QR`);

    const result = await whatsappService.requestQR(userId);

    if (result.success) {
      // Obtener el estado actual después de procesar la solicitud
      const currentStatus = whatsappService.getQRStatus();

      res.json({
        success: true,
        message: result.message,
        status: result.status,
        currentStatus: currentStatus,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Mapear códigos de estado apropiados
      const statusCodeMap = {
        QR_ACTIVE: 409, // Conflict
        RATE_LIMIT_EXCEEDED: 429, // Too Many Requests
        TOO_FREQUENT: 429, // Too Many Requests
        ALREADY_CONNECTED: 409, // Conflict
        CONNECTION_ERROR: 503, // Service Unavailable
        QR_REQUEST_ERROR: 500, // Internal Server Error
      };

      const statusCode = statusCodeMap[result.reason] || 400;

      res.status(statusCode).json({
        success: false,
        reason: result.reason,
        message: result.message,
        ...(result.timeRemaining && { timeRemaining: result.timeRemaining }),
        ...(result.timeToWait && { timeToWait: result.timeToWait }),
        ...(result.timeUntilReset && { timeUntilReset: result.timeUntilReset }),
        ...(result.error && { error: result.error }),
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error al solicitar nuevo QR:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export function getQrStats(req, res) {
  try {
    const userId = req.user.userId;
    const stats = whatsappService.getQrStats(userId);

    res.json({
      success: true,
      userId,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error al obtener estadísticas de QR:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export function forceExpireQr(req, res) {
  try {
    const userId = req.user.username;
    console.log(`🗑️ Usuario ${userId} forzando expiración de QR`);

    const result = whatsappService.expireQR("admin_request", userId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error al forzar expiración de QR:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Función adicional para obtener información detallada del estado de conexión
export function getConnectionInfo(req, res) {
  try {
    const status = whatsappService.getQrStatus();
    const isConnected = whatsappService.isConnected();

    res.json({
      success: true,
      connectionDetails: {
        isConnected,
        status: status.status,
        message: status.message,
        connectionState: status.connectionState,
        qrAvailable: !!whatsappService.getQrCode(),
        qrTimeRemaining: status.timeRemaining || 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error obteniendo información de conexión:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo información de conexión",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Función para reiniciar completamente la conexión (solo admin)
export async function restartConnection(req, res) {
  try {
    const userId = req.user.username;
    console.log(
      `🔄 Usuario ${userId} solicitando reinicio completo de conexión`,
    );

    // Limpiar conexión actual
    await whatsappService.cleanup();

    // Esperar un poco antes de reiniciar
    setTimeout(async () => {
      try {
        const result = await whatsappService.startConnection();
        console.log(`✅ Conexión reiniciada por ${userId}: ${result.message}`);
      } catch (error) {
        console.error(`❌ Error reiniciando conexión para ${userId}:`, error);
      }
    }, 2000);

    res.json({
      success: true,
      message: "Reinicio de conexión iniciado",
      note: "La conexión se está reiniciando en segundo plano",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error al reiniciar conexión:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export function resetAuth(req, res) {
  try {
    const authPath = path.resolve(__dirname, '..', '..', 'auth_info');

    // Verificar que sea un directorio
    const stats = fs.statSync(authPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        message: 'La ruta auth_info no es un directorio',
        timestamp: new Date().toISOString(),
      });
    }

    // Eliminar la carpeta de forma recursiva
    fs.rm(authPath, { recursive: true, force: true }, (err) => {
      if (err) {
        console.error(`Error eliminando la carpeta ${authPath}:`, err);
        return res.status(500).json({
          success: false,
          message: 'Error al eliminar la carpeta auth_info',
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      } else {
        console.log(`Carpeta ${authPath} eliminada correctamente.`);
        
        fs.mkdir(authPath, { recursive: true }, (mkdirErr) => {
          if (mkdirErr) {
            console.error(`Error creando la carpeta ${authPath}:`, mkdirErr);
            return res.status(500).json({
              success: false,
              message: 'Error al recrear la carpeta auth_info',
              error: mkdirErr.message,
              timestamp: new Date().toISOString(),
            });
          }

          console.log(`Carpeta ${authPath} recreada correctamente.`);
          return res.json({
            success: true,
            message: 'Carpeta auth_info eliminada y recreada correctamente',
            timestamp: new Date().toISOString(),
          });
        });
      }
    });
  } catch (error) {
    console.error('Error en resetAuth:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Función para obtener historial de mensajes enviados
export function getSentMessages(req, res) {
  try {
    const sentMessages = whatsappService.getSentMessages();

    res.json({
      success: true,
      messages: sentMessages,
      total: sentMessages.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error obteniendo historial de mensajes:", error);
    res.status(500).json({
      success: false,
      message: "Error obteniendo historial de mensajes",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Función para verificar el estado de la carpeta auth_info
export function checkAuthStatus(req, res) {
  try {
    const authPath = path.resolve(__dirname, '..', '..', 'auth_info');
    const authExists = fs.existsSync(authPath);

    let authDetails = null;
    if (authExists) {
      try {
        const stats = fs.statSync(authPath);
        authDetails = {
          exists: true,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          path: authPath
        };
      } catch (error) {
        authDetails = {
          exists: true,
          error: error.message
        };
      }
    }

    res.json({
      success: true,
      path: authPath,
      authStatus: {
        exists: authExists,
        details: authDetails
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error verificando estado de auth:", error);
    res.status(500).json({
      success: false,
      message: "Error verificando estado de auth",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Función para forzar reconexión manual
export async function forceReconnect(req, res) {
  try {
    const userId = req.user.id;
    console.log('Usuario solicitando reconexión manual', { userId });

    await whatsappService.forceReconnect();

    res.json({
      success: true,
      message: 'Reconexión iniciada manualmente',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error en reconexión manual', {
      userId: req.user.id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Error al iniciar reconexión manual',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Función para obtener estado de reconexión
export function getReconnectionStatus(req, res) {
  try {
    const status = whatsappService.getReconnectionStatus();

    res.json({
      success: true,
      reconnectionStatus: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error obteniendo estado de reconexión', { error: error.message });

    res.status(500).json({
      success: false,
      message: 'Error al obtener estado de reconexión',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Funcion para enviar mensajes con imagenes
export async function sendMessageWithImage(req, res) {
  try {
    const { imageData, phone, caption } = req.body;

    // Validaciones adicionales
    if (!phone || !imageData) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
        required: ["imageData", "phone"],
      });
    }

    // Validar formato del teléfono
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({
        success: false,
        message: "El número de teléfono debe tener entre 10 y 15 dígitos",
      });
    }

    const result = await whatsappService.sendMessageWithImage({
      imageData,
      phone,
      caption: caption || 'Imagen enviada'
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en sendMessageWithImage:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export async function sendMessageAccept(req, res) {
  try {
    const { telefono, comentario } = req.body;

    // Validaciones básicas
    if (!telefono || !comentario) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
        required: ["telefono", "comentario"],
      });
    }

    // Validar que el comentario no esté vacío
    if (typeof comentario !== 'string' || comentario.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El comentario no puede estar vacío",
      });
    }

    const result = await whatsappService.sendSimpleMessage({
      phone: telefono,
      message: comentario,
      type: 'accept',
      useTemplate: true
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en sendMessageAccept:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export async function sendMessageReject(req, res) {
  try {
    const { telefono, comentario } = req.body;

    // Validaciones básicas
    if (!telefono || !comentario) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
        required: ["telefono", "comentario"],
      });
    }

    // Validar que el comentario no esté vacío
    if (typeof comentario !== 'string' || comentario.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El comentario no puede estar vacío",
      });
    }

    const result = await whatsappService.sendSimpleMessage({
      phone: telefono,
      message: comentario,
      type: 'reject',
      useTemplate: true
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en sendMessageReject:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}