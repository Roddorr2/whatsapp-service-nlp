import { Router } from 'express';
import { login, getCurrentUser, validateToken } from '../controllers/auth.controller.js';
import { validateLogin } from '../validators/auth.validator.js';
import { authenticateJWT } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/login', validateLogin, login);
router.get('/me', authenticateJWT, getCurrentUser);
router.get('/validate', authenticateJWT, validateToken);

export default router;