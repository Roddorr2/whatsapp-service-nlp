import { Router } from 'express';
import { login, getCurrentUser, validateToken, checkWhatsAppHealth } from '../controllers/auth.controller.js';
import { validateLogin } from '../validators/auth.validator.js';
import { authenticateJWT, loginLimiter } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/login', loginLimiter, validateLogin, login);
router.get('/me', authenticateJWT, getCurrentUser);
router.get('/validate', authenticateJWT, validateToken);
router.get('/whatsapp-health', authenticateJWT, checkWhatsAppHealth);

export default router;