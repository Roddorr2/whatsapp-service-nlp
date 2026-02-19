import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

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
  // Intentar verificar con clave pública RS256 (si existe en storge/keys/jwt_public.pem)
  const pubKeyPath = path.resolve(process.cwd(), 'storge', 'keys', 'jwt_public.pem');
  let publicKey = process.env.WHATSAPP_JWT_PUBLIC_KEY || null;
  try {
    if (!publicKey && fs.existsSync(pubKeyPath)) {
      publicKey = fs.readFileSync(pubKeyPath, 'utf8');
      console.info('Usando clave pública JWT desde', pubKeyPath);
    }
  } catch (e) {
    // seguir con fallback
  }

  try {
    if (publicKey) {
      // Intentar verificación RS256
      const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      userData = {
        userId: payload.sub || payload.id || payload.user?.id,
        username: payload.name || payload.user?.name || payload.username,
        role: payload.rol || payload.role || payload.user?.rol || payload.user?.role
      };
    } else {
      // Intentar verificación HMAC/HS256 con JWT_SECRET
      userData = jwt.verify(token, process.env.JWT_SECRET);
    }
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
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }

  // Normalizar rol (mapear variantes como 'admin'|'administrator' -> 'administrador')
  const normalizeRole = (r) => {
    if (!r) return 'user';
    const rr = String(r).toLowerCase();
    if (['admin', 'administrator', 'administrador'].includes(rr)) return 'administrador';
    if (['marketing'].includes(rr)) return 'marketing';
    return rr;
  };

  userData.role = normalizeRole(userData.role);
  req.user = userData;
  next();
}

// Middleware combinado: primero intenta JWT, si no viene JWT intenta API Key
export async function authenticateJWTorAPIKey(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  // Prioridad JWT
  if (authHeader) {
    return authenticateJWT(req, res, next);
  }

  // Fallback API Key
  if (apiKey) {
    if (!process.env.API_KEY || apiKey !== process.env.API_KEY) {
      return res.status(401).json({ success: false, message: 'API Key inválida' });
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

    return res.status(403).json({ success: false, message: `Acceso prohibido. Se requiere uno de estos roles: ${allowedRoles.join(', ')}` });
  };
}

// Mantener compatibilidad con authorizeRole existente (single-role)
export function authorizeRole(requiredRole) {
  return authorizeRoles([requiredRole]);
}
