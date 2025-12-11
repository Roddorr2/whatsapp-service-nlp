import whatsappService from './src/services/whatsapp.service.js';
import logger from './src/utils/logger.js';

async function testConnection() {
  try {
    logger.info('🧪 Iniciando prueba de conexión...');
    
    // Verificar estado inicial
    const initialStatus = whatsappService.getQRStatus();
    logger.info('Estado inicial:', initialStatus);
    
    // Solicitar nuevo QR
    logger.info('📱 Solicitando nuevo QR...');
    const qrResult = await whatsappService.requestQR('test-user');
    logger.info('Resultado de solicitud de QR:', qrResult);
    
    // Esperar un poco para que se genere el QR
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verificar estado después de la solicitud
    const statusAfterRequest = whatsappService.getQRStatus();
    logger.info('Estado después de solicitar QR:', statusAfterRequest);
    
    // Verificar estado de reconexión
    const reconnectStatus = whatsappService.getReconnectionStatus();
    logger.info('Estado de reconexión:', reconnectStatus);
    
    logger.info('✅ Prueba completada exitosamente');
    
  } catch (error) {
    logger.error('❌ Error en la prueba:', { error: error.message, stack: error.stack });
  }
}

// Ejecutar la prueba
testConnection();
