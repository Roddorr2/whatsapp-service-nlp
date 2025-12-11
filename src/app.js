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

  // Verificar autenticación del token
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log('Se desconecto por que no hay token');
    socket.disconnect();
    return;
  }

  // Verificar JWT
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log('Se desconecto por que la verificacion del token es falsa');
      socket.disconnect();
      return;
    }

    // Guardar información del usuario en el socket
    socket.userId = decoded.userId;
    socket.user = decoded;

    // Enviar estado inicial del QR
    const qrStatus = whatsappService.getQRStatus();
    socket.emit('qr-status-update', qrStatus);

    console.log('Usuario autenticado:', decoded.username);
  });

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