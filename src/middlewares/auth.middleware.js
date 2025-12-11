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
export function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(401).json({ 
          success: false, 
          message: 'Token inválido o expirado' 
        });
      }

      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Token no proporcionado' 
    });
  }
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