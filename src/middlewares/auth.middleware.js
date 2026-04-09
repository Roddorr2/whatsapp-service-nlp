import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import logger, { logAuthFailure } from '../utils/logger.js';

// Middleware para verificar API Key (para servicios)
export function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!process.env.API_KEY || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }
  // Marcar como job del sistema (pero NO requiere añadir 'system' a roles)
  req.user = {
    userId: 'apiKeyUser',
    username: 'apiKeyUser',
    role: 'system',
    isSystemJob: true
  };
  next();
}

// Middleware para verificar JWT (para usuarios)
export async function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }
  const token = authHeader.split(' ')[1];
  let userData = null;
  try {
    userData = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // Intentar con Laravel Backend (/api/me) si no se puede verificar localmente
    try {
      const mainBackendUrl = process.env.MAIN_BACKEND_URL;
      const response = await fetch(`${mainBackendUrl}/api/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        userData = {
          userId: data.user?.id || data.id,
          username: data.user?.name || data.name,
          role: data.user?.rol || data.rol || data.role 
        };
      }
    } catch (fetchErr) {
      // No hacer nada, userData seguirá siendo null
    }
  }
  if (!userData) {
    return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
  }
  req.user = userData;
  next();
}

// Middleware combinado: primero intenta JWT, si no viene JWT intenta API Key
// ESTÁNDAR: Header 'x-api-key' (case-insensitive en HTTP, normalizado a lowercase en Express)
// Valor esperado: process.env.API_KEY (deve coincidir con WHATSAPP_SERVICE_API_KEY en Laravel)
export async function authenticateJWTorAPIKey(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key']; // Header estándar para API Key (Express normaliza a lowercase)

  // Prioridad JWT
  if (authHeader) {
    return authenticateJWT(req, res, next);
  }

  // Fallback API Key (validar contra variable de entorno API_KEY)
  if (apiKey) {
    // Validar que la API Key coincida con la variable de entorno
    if (!process.env.API_KEY || apiKey !== process.env.API_KEY) {
      // Do not log secrets or expected values. Delegate to security logger.
      logAuthFailure(req, 'invalid_api_key');
      return res.status(401).json({ success: false, message: 'No autorizado' });
    }
    req.user = {
      userId: 'apiKeyUser',
      username: 'apiKeyUser',
      role: 'system',
      isSystemJob: true
    };
    return next();
  }

  return res.status(401).json({ success: false, message: 'Se requiere autenticación (JWT o API Key)' });
}

// Middleware para verificar roles — acepta un array de roles.
// Importante: los jobs autenticados por API Key (req.user.isSystemJob) serán permitidos
// sin necesidad de incluir 'system' en el array de roles.
export function authorizeRoles(allowedRoles = []) {
  return (req, res, next) => {
    // Permitir siempre a jobs del sistema autenticados por API Key
    if (req.user?.isSystemJob) {
      return next();
    }

    if (req.user && allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({ success: false, message: 'Permisos insuficientes' });
  };
}

// Mantener compatibilidad con authorizeRole existente (single-role)
export function authorizeRole(requiredRole) {
  return authorizeRoles([requiredRole]);
}

// Rate Limiter específico para /login - previene brute-force attacks
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // máximo 5 intentos por IP
  standardHeaders: true, // retorna información de rate limit en headers `RateLimit-*`
  legacyHeaders: false, // desactiva headers `X-RateLimit-*`
  skip: (req) => req.user?.isSystemJob, // omitir rate limiting para jobs del sistema
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Demasiados intentos de login. Intenta de nuevo en 15 minutos.'
    });
  }
});
