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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
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
app.use('/api', messageRoutes);

// WebSocket para QR status
io.on('connection', (socket) => {

  console.log('Cliente conectado:', socket.id);
  let userData = null;
  let authMethod = 'none';
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log('Se desconecto por que no hay token');
    socket.disconnect();
    return;
  }
  const logAuthTimeline = ({ socketId, event, ...rest }) => {
    console.log(JSON.stringify({ socketId, event, ...rest }));
  };
  (async () => {
    try {
      logAuthTimeline({ socketId: socket.id, event: 'jwt-verify-start', token });
      userData = jwt.verify(token, process.env.JWT_SECRET);
      authMethod = 'jwt';
      logAuthTimeline({ socketId: socket.id, event: 'jwt-verify-success', userData });
    } catch (err) {
      logAuthTimeline({ socketId: socket.id, event: 'jwt-verify-fail', error: err.message });
      // Intentar con Laravel
      try {
        const mainBackendUrl = process.env.MAIN_BACKEND_URL || 'http://127.0.0.1:8000';
        logAuthTimeline({ socketId: socket.id, event: 'laravel-me-request', url: `${mainBackendUrl}/api/me`, token });
        const response = await fetch(`${mainBackendUrl}/api/me`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
        logAuthTimeline({ socketId: socket.id, event: 'laravel-me-response', status: response.status });
        if (response.ok) {
          const data = await response.json();
          userData = {
            userId: data.user?.id || data.id,
            username: data.user?.name || data.name
          };
          authMethod = 'laravel';
          logAuthTimeline({ socketId: socket.id, event: 'laravel-auth-success', userData });
        }
      } catch (fetchErr) {
        logAuthTimeline({ socketId: socket.id, event: 'laravel-auth-error', message: fetchErr.message, ip: socket.handshake.address });
        console.error('Error socket auth Laravel:', fetchErr.message);
      }
    }
    if (!userData) {
      socket.disconnect();
      return;
    }
    logAuthTimeline({ socketId: socket.id, event: 'authenticated', token, userData, method: authMethod, ip: socket.handshake.address });
    socket.userId = userData.userId;
    socket.user = userData;
    // Enviar estado inicial del QR
    const qrStatus = whatsappService.getQRStatus();
    socket.emit('qr-status-update', qrStatus);
    console.log('Usuario autenticado:', userData.username);
  })();

  // Unirse a la sala del usuario
  socket.on('join-user', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`Usuario ${userId} se unió a su sala`);
  });

  // Solicitar estado inicial
  socket.on('get-initial-status', () => {
    const qrStatus = whatsappService.getQRStatus();
    socket.emit('qr-status-update', qrStatus);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.userId);
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