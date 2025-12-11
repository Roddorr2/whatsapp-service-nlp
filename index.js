import 'dotenv/config';
import { server } from './src/app.js';
import { AUTH_CONFIG } from './src/config/auth.config.js';

const PORT = process.env.PORT || 5111;

// Validar configuración de autenticación
AUTH_CONFIG.validateConfig();

server.listen(PORT, () => {
  console.log(`Servidor WhatsApp corriendo en puerto ${PORT}`);
});