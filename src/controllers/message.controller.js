import whatsappService, { getImageBase64, notifyBackendStatus } from "../services/whatsapp.service.js";
import sessionManager from "../services/session.manager.js";
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { BASE_URL } from "../config/index.js";
import { getTemplate } from "../templates.js";
import { interpolateMessage } from "../utils/messageUtils.js";



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

    console.log("📩 Enviando mensaje:", { nombre, templateOption, telefono, productoName });

    // Construir mensaje según la plantilla seleccionada
    let mensajeFinal;
    switch (templateOption) {
      case 'plantilla_1':
        mensajeFinal = `Hola ${nombre}, tu producto ${productoName} está listo para entrega.`;
        break;
      case 'plantilla_2':
        mensajeFinal = `Estimado ${nombre}, hemos recibido tu pedido de ${productoName}. Gracias por confiar en nosotros.`;
        break;
      case 'plantilla_3':
        mensajeFinal = `¡Hola ${nombre}! Tu pedido de ${productoName} se encuentra en preparación.`;
        break;
      default:
        mensajeFinal = 'Mensaje por defecto';
    }

    // Enviar mensaje al servicio de WhatsApp
    const result = await whatsappService.sendMessage({
      telefono,
      message: mensajeFinal
    });

    res.json({
      success: true,
      messageSent: mensajeFinal,
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
    // ✅ NUEVO PAYLOAD - Modal WAT desde Laravel
    const {
      telefono,
      nombre,
      mensaje,           // ← Texto directo del payload (puede tener {nombre})
      image_url,         // ← URL de imagen (puede ser null)
      fecha,
      hora,
      productoName,
      id_modal_wat,      // ← Identificador de Modal WAT
      id_plantilla_whatsapp,  // ← ID de plantilla WhatsApp
      id_modalservicio
    } = req.body;

    // Validaciones básicas
    if (!telefono || !nombre || !mensaje) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos obligatorios: telefono, nombre, mensaje",
      });
    }

    // Interpolar nombre si existe {nombre} en el texto
    const textoInterpolado = interpolateMessage(mensaje, nombre);

    // Descargar imagen si existe URL (sin delays)
    let imageBuffer = null;
    if (image_url) {
      try {
        console.log(`📥 Descargando imagen desde: ${image_url}`);
        imageBuffer = await getImageBase64(image_url);
        if (imageBuffer) {
          console.log(`✅ Imagen descargada exitosamente. Tamaño: ${imageBuffer.length} bytes, Tipo: ${typeof imageBuffer}, IsBuffer: ${Buffer.isBuffer(imageBuffer)}`);
        } else {
          console.warn("⚠️ No se pudo descargar imagen desde:", image_url);
        }
      } catch (imgError) {
        console.warn("⚠️ Error descargando imagen:", imgError.message);
        // Continuar sin imagen si falla la descarga
      }
    }

    console.log("Modal WAT - Enviando mensaje:", {
      telefono,
      nombre,
      id_modal_wat,
      textoPreview: textoInterpolado.substring(0, 50),
      tieneImagen: !!imageBuffer,
      imagenTamaño: imageBuffer ? `${imageBuffer.length}B` : 'null'
    });

    // Enviar al servicio de WhatsApp
    const result = await whatsappService.sendMessageImageDashboard({
      telefono,
      nombre,
      image: imageBuffer,
      text: textoInterpolado,
      id_modal_wat,
      id_modalservicio
    });

    // Preparar y enviar webhook al backend (fire-and-forget)
    if (result.success && result.messageId) {
      try {
        const webhookPayload = {
          provider_message_id: result.messageId,
          status: 'sent',
          id_modal_wat: id_modal_wat,
          sentAt: new Date().toISOString()
        };

        // Fire-and-forget para no bloquear la respuesta al cliente
        notifyBackendStatus(webhookPayload)
          .then(() => console.log(`🔔 Webhook Modal WAT entregado para ${nombre}`))
          .catch((webhookErr) => console.error(`⚠️ Error entregando webhook Modal WAT para ${nombre}:`, webhookErr.message));
      } catch (webhookErr) {
        console.error("⚠️ Error preparando webhook Modal WAT:", webhookErr.message);
      }
    }

    res.json({
      success: true,
      id_modal_wat,
      ...result
    });
  } catch (error) {
    console.error("❌ Error en sendMessageWithImageDashboard:", error);
    res.status(500).json({
      success: false,
      message: error.message
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

/**
 * SIMPLE health check endpoint - just verify current state.
 * Validates:
 * 1. API key is valid (implicitly true if reached here via middleware)
 * 2. WhatsApp socket is connected
 * 3. Webhook callback machinery is operational
 * 
 * Returns 200 with current state (connected, webhooksOperational, apiKeyValid).
 * The orchestrator decides what to do based on the state (e.g., call /start-connection if needed).
 */
export async function getHealthStatus(req, res) {
  try {
    // If we reached here, auth middleware validated the API key or JWT
    const apiKeyValid = true;

    // Current connection info
    const connected = whatsappService.isConnected();
    const qrStatus = whatsappService.getQRStatus();
    const webhooksOperational = qrStatus.isConnected && qrStatus.connectionState?.status === 'connected';

    console.log('🔍 Health check state:', { connected, webhooksOperational, apiKeyValid });

    // Always return current state with 200
    res.json({
      success: true,
      connected: connected,
      webhooksOperational: webhooksOperational,
      apiKeyValid: apiKeyValid,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error en health check:", error);
    res.status(503).json({
      success: false,
      connected: false,
      webhooksOperational: false,
      apiKeyValid: true,
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

    // Validar formato del teléfono (aceptar 9-15 dígitos; el service completará el prefijo si hace falta)
    const cleanPhone = phone ? String(phone).replace(/\D/g, '').replace(/^0+/, '') : '';
    if (cleanPhone.length < 9 || cleanPhone.length > 15) {
      return res.status(400).json({
        success: false,
        message: "El número de teléfono debe tener entre 9 y 15 dígitos",
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

/**
 * Enviar campaña en lotes (batch)
 */
export async function sendCampaignBatch(req, res) {
  try {
    // Normalizar aliases de payload para compatibilidad
    const campania_id = req.body.campania_id ?? req.body.campaign_id ?? null;
    const chunk_id = req.body.chunk_id ?? req.body.chunk_number ?? 1;
    const chunk_number = req.body.chunk_number ?? req.body.chunk_id ?? 1;
    const recipients = req.body.recipients || [];
    const message = req.body.message ?? req.body.parrafo ?? req.body.text ?? '';
    const id_servicio = req.body.id_servicio ?? req.body.idServicio ?? null;

    // Obtener imagen si fue subida o enviada como URL
    let image_url = null;
    if (req.file) {
      image_url = `${BASE_URL}/public/imagenes_dashboard/${req.file.filename}`;
    } else if (req.body.image_url || req.body.imagen_url) {
      image_url = req.body.image_url ?? req.body.imagen_url;
    }

    console.log('Usuario ejecutando sendCampaignBatch:', req.user);

    const result = await whatsappService.sendCampaignBatch({
      campania_id,
      chunk_id,
      chunk_number,
      recipients,
      message,
      image_url,
      id_servicio
    });

    res.json({
      success: true,
      executedBy: {
        userId: req.user?.userId || req.user?.id || null,
        username: req.user?.username || null,
        isSystemJob: !!req.user?.isSystemJob
      },
      ...result
    });
  } catch (error) {
    console.error("❌ Error en sendCampaignBatch:", error);
    
    // Usar código de estado del error si está disponible (503 para unavailable)
    const statusCode = error.statusCode || 500;
    const responseBody = {
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    // Incluir información de estado si es 503 (servicio no disponible)
    if (statusCode === 503 && error.currentState) {
      responseBody.whatsappState = error.currentState;
      responseBody.retryable = error.retryable || true;
    }
    
    res.status(statusCode).json(responseBody);
  }
}

/**
 * Subir/guardar plantilla con imagen
 */
export async function saveTemplate(req, res) {
  try {
    const templateData = req.body;
    let imageUrl = null;

    if (req.file) {
      imageUrl = `${BASE_URL}/public/imagenes_dashboard/${req.file.filename}`;
    }

    res.json({
      success: true,
      message: "Plantilla recibida",
      data: {
        ...templateData,
        image: imageUrl
      },
      file: req.file ? {
        filename: req.file.filename,
        path: imageUrl,
        size: req.file.size,
        mimetype: req.file.mimetype
      } : null
    });
  } catch (error) {
    console.error("❌ Error en saveTemplate:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Activar campaña
 */
export async function activateCampaign(req, res) {
  try {
    const { campaignId, name, recipients, templateOption, messageType, scheduledAt } = req.body;

    // Aquí se puede agregar lógica para programar la campaña
    // Por ahora solo confirmamos la activación

    const createdBy = {
      userId: req.user?.userId || req.user?.id || null,
      username: req.user?.username || null,
      isSystemJob: !!req.user?.isSystemJob
    };

    console.log('Campaña activada por:', createdBy);

    res.json({
      success: true,
      message: "Campaña activada",
      campaign: {
        id: campaignId || `campaign_${Date.now()}`,
        name: name || 'Sin nombre',
        recipientCount: recipients?.length || 0,
        templateOption,
        messageType,
        scheduledAt: scheduledAt || new Date().toISOString(),
        status: 'activated',
        activatedAt: new Date().toISOString(),
        createdBy
      }
    });
  } catch (error) {
    console.error("❌ Error en activateCampaign:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}