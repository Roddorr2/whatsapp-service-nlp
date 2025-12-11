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
  sendMessageWithImageDashboard
} from '../controllers/message.controller.js';
import { 
  validateSendMessage, 
  validateSendImage, 
  validateSendMessageAccept, 
  validateSendMessageReject 
} from '../validators/message.validator.js';
import { authenticateJWT, authorizeRole } from '../middlewares/auth.middleware.js';
import { upload } from '../config/message.config.js';
import { Router } from 'express';

const router = Router();

// router.post('/send-message', authenticateJWT, authorizeRole('admin'), validateSendMessage, sendMessage);
router.post('/send-message', sendMessage);
router.post('/send-message-image', upload.single("image"), sendMessageWithImageDashboard);

router.post('/send-message-accept', validateSendMessageAccept, sendMessageAccept);
router.post('/send-message-reject', validateSendMessageReject, sendMessageReject);
router.get('/sent-messages', authenticateJWT, authorizeRole('admin'), getSentMessages);
router.get('/qr-code', authenticateJWT, authorizeRole('admin'), getQrCode);
router.post('/send-image', validateSendImage, sendMessageWithImage);
router.get('/status', authenticateJWT, getStatus);
router.get('/qr-status', authenticateJWT, getQrStatus);
router.get('/auth-status', authenticateJWT, checkAuthStatus);
router.get('/reconnection-status', authenticateJWT, getReconnectionStatus);
router.post('/qr-request', authenticateJWT, authorizeRole('admin'), requestNewQr);
router.post('/qr-expire', authenticateJWT, authorizeRole('admin'), forceExpireQr);
router.post('/auth/reset', authenticateJWT, authorizeRole('admin'), resetAuth);
router.post('/force-reconnect', authenticateJWT, authorizeRole('admin'), forceReconnect);

export default router;