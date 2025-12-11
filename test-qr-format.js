import whatsappService from './src/services/whatsapp.service.js';
import logger from './src/utils/logger.js';

async function testQRFormats() {
  try {
    logger.info('🧪 Iniciando prueba de formatos de QR...');
    
    // QR de prueba
    const testQRString = 'https://wa.me/1234567890';
    
    // Probar diferentes formatos
    const formats = ['PNG', 'JPEG', 'SVG'];
    
    for (const format of formats) {
      try {
        logger.info(`📱 Probando formato: ${format}`);
        
        const startTime = Date.now();
        const qrResult = await whatsappService.generateQRInFormat(testQRString, format);
        const endTime = Date.now();
        
        logger.info(`✅ Formato ${format} generado exitosamente`, {
          format: qrResult.format,
          size: qrResult.size,
          mimeType: qrResult.mimeType,
          generationTime: `${endTime - startTime}ms`,
          imageLength: qrResult.image.length,
          fallback: qrResult.fallback || false
        });
        
        // Verificar que la imagen sea válida
        if (qrResult.image.startsWith('data:image/')) {
          logger.info(`✅ Imagen ${format} válida generada`);
        } else {
          logger.warn(`⚠️ Formato de imagen ${format} inesperado`);
        }
        
      } catch (error) {
        logger.error(`❌ Error generando formato ${format}:`, { error: error.message });
      }
      
      // Pausa entre formatos
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Probar cambio de formato
    logger.info('🔄 Probando cambio de formato...');
    try {
      const changeResult = await whatsappService.changeQRFormat('JPEG');
      logger.info('✅ Cambio de formato exitoso:', {
        newFormat: changeResult.format,
        size: changeResult.size,
        mimeType: changeResult.mimeType
      });
    } catch (error) {
      logger.error('❌ Error cambiando formato:', { error: error.message });
    }
    
    // Obtener información del formato
    const formatInfo = whatsappService.getQRFormatInfo();
    if (formatInfo) {
      logger.info('📊 Información del formato actual:', formatInfo);
    } else {
      logger.info('📊 No hay QR activo para obtener información de formato');
    }
    
    logger.info('✅ Prueba de formatos completada exitosamente');
    
  } catch (error) {
    logger.error('❌ Error en la prueba de formatos:', { error: error.message, stack: error.stack });
  }
}

// Ejecutar la prueba
testQRFormats();
