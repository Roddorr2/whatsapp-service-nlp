import jwt from 'jsonwebtoken';

// Middleware para verificar API Key (para servicios)
export function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!process.env.API_KEY || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }
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
    // Intentar con Laravel
    try {
      const mainBackendUrl = process.env.MAIN_BACKEND_URL || 'http://127.0.0.1:8000';
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
          role: 'admin'
        };
      }
    } catch (fetchErr) {
      // No hacer nada, userData seguirá siendo null
    }
  }
  if (!userData) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }
  req.user = userData;
  next();
}

// Middleware para verificar roles
export function authorizeRole(requiredRole) {
  return (req, res, next) => {
    if (req.user && req.user.role === requiredRole) {
      next();
    } else {
      res.status(403).json({ success: false, message: 'Acceso prohibido' });
    }
  };
}