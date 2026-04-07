/**
 * Validadores de imagen centralizados
 * Usados por procesadores y servicios de envío
 */

import { IMAGE_CONFIG } from '../config/constants.js';

/**
 * Valida si un buffer contiene una imagen válida
 * @param {Buffer} buffer - Buffer a validar
 * @param {number} maxSizeMB - Tamaño máximo en MB (default 16MB)
 * @returns {{valid: boolean, error?: string}}
 */
export function validateImageBuffer(buffer, maxSizeMB = IMAGE_CONFIG.MAX_SIZE_MB) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { valid: false, error: 'El buffer de imagen no es válido' };
  }

  if (buffer.length === 0) {
    return { valid: false, error: 'El buffer de imagen está vacío' };
  }

  const maxBytes = maxSizeMB * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return {
      valid: false,
      error: `Imagen demasiado grande: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (máx ${maxSizeMB}MB)`
    };
  }

  return { valid: true };
}

/**
 * Valida magic bytes para verificar tipo de archivo
 * @param {Buffer} buffer - Buffer a validar
 * @returns {{valid: boolean, type?: string, error?: string}}
 */
export function validateImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: 'Buffer muy pequeño para validar tipo' };
  }

  const { MAGIC_BYTES } = IMAGE_CONFIG;

  // JPEG
  if (buffer[0] === MAGIC_BYTES.JPEG[0] && 
      buffer[1] === MAGIC_BYTES.JPEG[1] && 
      buffer[2] === MAGIC_BYTES.JPEG[2]) {
    return { valid: true, type: 'jpeg' };
  }

  // PNG
  if (buffer[0] === MAGIC_BYTES.PNG[0] && 
      buffer[1] === MAGIC_BYTES.PNG[1] && 
      buffer[2] === MAGIC_BYTES.PNG[2] && 
      buffer[3] === MAGIC_BYTES.PNG[3]) {
    return { valid: true, type: 'png' };
  }

  // WebP
  if (buffer[0] === MAGIC_BYTES.WEBP.pattern[0] && 
      buffer[1] === MAGIC_BYTES.WEBP.pattern[1] && 
      buffer[2] === MAGIC_BYTES.WEBP.pattern[2] && 
      buffer[3] === MAGIC_BYTES.WEBP.pattern[3]) {
    if (buffer.length >= 12 &&
        buffer[8] === MAGIC_BYTES.WEBP.check[0] && 
        buffer[9] === MAGIC_BYTES.WEBP.check[1] && 
        buffer[10] === MAGIC_BYTES.WEBP.check[2] && 
        buffer[11] === MAGIC_BYTES.WEBP.check[3]) {
      return { valid: true, type: 'webp' };
    }
  }

  return { valid: false, error: 'Tipo de archivo no reconocido o no soportado' };
}
/**
 * Valida formato de URL o ruta local
 * @param {string} path - URL o ruta a validar
 * @returns {{valid: boolean, isUrl: boolean, error?: string}}
 */
export function validateImagePath(path) {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return { valid: false, error: 'La ruta de imagen no puede estar vacía' };
  }

  const isUrl = path.startsWith('http://') || path.startsWith('https://');
  return { valid: true, isUrl };
}
