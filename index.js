import 'dotenv/config';
import { server } from './src/app.js';
import { AUTH_CONFIG } from './src/config/auth.config.js';
import sessionManager from './src/services/session.manager.js';
const logger = console;

const PORT = process.env.PORT || 5111;

// Validar configuración de autenticación
AUTH_CONFIG.validateConfig();

server.listen(PORT, async () => {
  console.log(`Servidor WhatsApp corriendo en puerto ${PORT}`);
  
  // Auto-refresh de sesión si está habilitado
  try {
    // Importar la función startWhatsAppBot para reconexión
    const { startWhatsAppBot } = await import('./src/services/whatsapp.service.js');
    
    // Callback que el SessionManager usará para reconectar
    const reconnectCallback = async () => {
      logger.info('🔄 Callback de reconexión invocado por SessionManager');
      
      try {
        // Usar startWhatsAppBot que es la función existente para iniciar conexión
        await startWhatsAppBot();
        
        // Dar tiempo para que la conexión se establezca
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        logger.info('✅ Reconexión completada mediante startWhatsAppBot');
        return { success: true, status: 'connected' };
        
      } catch (error) {
        logger.error('❌ Error en callback de reconexión', { 
          error: error.message,
          stack: error.stack 
        });
        throw error;
      }
    };
    
    // Ejecutar auto-refresh mediante SessionManager
    const result = await sessionManager.autoRefreshSession(reconnectCallback);
    
    if (result.success) {
      console.log(`✅ ${result.message}`);
      logger.info('Auto-refresh exitoso', { status: result.status });
    } else {
      console.log(`⚠️ ${result.message}`);
      logger.warn('Auto-refresh no completado', { 
        status: result.status,
        requiresQR: result.requiresQR,
        requiresManualIntervention: result.requiresManualIntervention
      });
      
      if (result.requiresQR) {
        console.log('📱 Para iniciar sesión, escanea el código QR desde el dashboard');
      }
      
      if (result.requiresManualIntervention) {
        console.log('⚠️ Se requiere intervención manual. Considera limpiar auth_info o revisar logs.');
      }
    }
  } catch (error) {
    console.error('❌ Error en auto-refresh:', error.message);
    logger.error('Error crítico en auto-refresh', { error: error.message, stack: error.stack });
  }
});