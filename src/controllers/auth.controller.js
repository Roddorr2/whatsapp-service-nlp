import jwt from 'jsonwebtoken';
import { AUTH_CONFIG } from '../config/auth.config.js';
import sessionManager from '../services/session.manager.js';

export async function login(req, res) {
  try {
    const { username, password } = req.body;

    // Buscar usuario en las credenciales hardcodeadas xd
    const user = AUTH_CONFIG.users.find(u => u.username === username);

    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { userId: user.username, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Devolver información completa del usuario
    res.json({ 
      success: true, 
      token, 
      user: {
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export function getCurrentUser(req, res) {
  res.json({
    success: true,
    user: {
      username: req.user.username,
      role: req.user.role
    }
  });
}

// Endpoint para verificar si el token actual es válido
export function validateToken(req, res) {
  try {
    res.json({
      success: true,
      user: {
        username: req.user.username,
        role: req.user.role
      },
      message: 'Token válido'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Endpoint para verificar la salud del servicio WhatsApp
export async function checkWhatsAppHealth(req, res) {
  try {
    const healthStatus = await sessionManager.checkWhatsAppHealth();
    
    res.json({
      success: true,
      whatsapp: healthStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error verificando salud de WhatsApp',
      error: error.message 
    });
  }
}