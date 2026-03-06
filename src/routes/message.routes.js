import {
  sendMessage,
  getStatus,
  requestNewQr,
  forceExpireQr,
  getQrStatus,
  getQrCode,
  resetAuth,
  getSentMessages,
  checkAuthStatus,
  forceReconnect,
  getReconnectionStatus,
  sendMessageWithImage,
  sendMessageAccept,
  sendMessageReject,
  sendMessageWithImageDashboard,
  sendCampaignBatch,
  saveTemplate,
  activateCampaign
} from '../controllers/message.controller.js';
import { 
  validateSendMessage, 
  validateSendImage, 
  validateSendMessageAccept, 
  validateSendMessageReject,
  validateSendCampaignBatch
} from '../validators/message.validator.js';
import { authenticateJWT, authenticateJWTorAPIKey, authorizeRoles, authorizeRole } from '../middlewares/auth.middleware.js';
import { upload } from '../config/message.config.js';
import { Router } from 'express';
import { templateList } from '../templates.js'
const router = Router();

// router.post('/send-message', authenticateJWT, authorizeRole('admin'), validateSendMessage, sendMessage);
router.post('/send-message', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador','system']), validateSendMessage, sendMessage);
router.post('/send-message-image', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador','system']), upload.single("image"), sendMessageWithImageDashboard);

router.post('/send-message-accept', validateSendMessageAccept, sendMessageAccept);
router.post('/send-message-reject', validateSendMessageReject, sendMessageReject);
router.get('/sent-messages', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador','system']), getSentMessages);
router.get('/qr-code', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), getQrCode);
router.post('/send-image', validateSendImage, sendMessageWithImage);
router.get('/status', authenticateJWT, getStatus);
router.get('/qr-status', authenticateJWT, getQrStatus);
router.get('/auth-status', authenticateJWT, checkAuthStatus);
router.get('/reconnection-status', authenticateJWT, getReconnectionStatus);
router.post('/qr-request', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), requestNewQr);
router.post('/qr-expire', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), forceExpireQr);
router.post('/auth/reset', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), resetAuth);
router.post('/force-reconnect', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), forceReconnect);

router.get('/templates', (req, res) => {
  res.json(templateList);
});

// ===============================
// Nuevas rutas para el frontend
// ===============================

// Reiniciar/Solicitar nuevo QR
router.post('/restart', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), requestNewQr);

// Subir/guardar plantilla con imagen
router.post('/template', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), upload.single('image'), saveTemplate);

// Activar campaña
router.post('/activate', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador']), activateCampaign);

// Enviar campaña en lotes (batch)
router.post('/send-campaign-batch', authenticateJWTorAPIKey, authorizeRoles(['marketing','administrador','system']), upload.single('image'), validateSendCampaignBatch, sendCampaignBatch);

export default router;