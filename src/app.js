import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import messageRoutes from './routes/message.routes.js';
import authRoutes from './routes/auth.routes.js';
import jwt from 'jsonwebtoken';
import whatsappService, {startWhatsAppBot} from './services/whatsapp.service.js';
import 'dotenv/config';
import path from "path";
import { fileURLToPath } from "url";

// startWhatsAppBot();

// Procesa ALLOWED_ORIGINS (separado por comas) o usa localhost por defecto
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001'];

const app = express();
app.set('trust proxy', 1);
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/public", express.static(path.join(__dirname, "public")));

app.use(helmet());

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-api-key']
}));


// Aumentando limite a 50mb
app.use(express.json({
  limit: '50mb'
}));

app.use(express.urlencoded({
  limit: '50mb',
  extended: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Excluir el endpoint qr-status del rate limiting
    return req.path === '/api/qr-status' || req.path === '/api/qr-status/';
  }
});

app.use(limiter);

// Rutas de autenticación (sin API key)
app.use('/api/auth', authRoutes);

// Rutas de mensajes (con API key)
app.use('/api/whatsapp', messageRoutes);

// WebSocket: autenticar usando token de Laravel (handshake.auth.token)
// Se verifica contra MAIN_BACKEND_URL/api/me y se adjunta user a socket
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Token no proporcionado'));
    }
    const mainBackendUrl = process.env.MAIN_BACKEND_URL;
    if (!mainBackendUrl) {
      return next(new Error('MAIN_BACKEND_URL no configurado'));
    }
    const response = await fetch(`${mainBackendUrl}/api/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      return next(new Error('Token inválido en backend'));
    }
    const data = await response.json();
    socket.user = {
      userId: data.user?.id || data.id,
      username: data.user?.name || data.name,
      role: data.user?.rol || data.rol || data.role
    };
    return next();
  } catch (err) {
    return next(new Error('Error verificando token'));
  }
});

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id, 'user:', socket.user?.userId);

  // Emitir estado inicial QR al cliente autenticado
  socket.emit('qr-status-update', whatsappService.getQRStatus());

  // Permitir obtener estado inicial QR
  socket.on('get-initial-status', () => {
    socket.emit('qr-status-update', whatsappService.getQRStatus());
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Función para emitir actualizaciones del QR a todos los clientes
export function emitQrStatusUpdate(status) {
  io.emit('qr-status-update', status);
}

// Función para emitir a un usuario específico
export function emitQrStatusToUser(userId, status) {
  io.to(`user-${userId}`).emit('qr-status-update', status);
}

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

export { server, io };