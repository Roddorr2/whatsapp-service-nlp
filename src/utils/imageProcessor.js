/**
 * Procesadores de imagen centralizados
 * Maneja descargas, lecturas locales y conversión base64
 */

import { IMAGE_CONFIG } from '../config/constants.js';
import { validateImageBuffer, validateImageMagicBytes } from './imageValidator.js';
import fs from 'fs';
import path from 'path';

const logger = console;

/**
 * Descarga imagen desde URL (HTTP/HTTPS) con timeout
 * @param {string} imageUrl - URL completa
 * @param {Object} options - { validate: boolean, strict: boolean }
 * @returns {Promise<Buffer|null>}
 */
export async function downloadImageFromUrl(imageUrl, options = { validate: false, strict: false }) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_CONFIG.DOWNLOAD_TIMEOUT_MS);

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': IMAGE_CONFIG.USER_AGENT }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al descargar ${imageUrl}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Validar si se solicita
    if (options.validate) {
      const sizeValidation = validateImageBuffer(imageBuffer);
      if (!sizeValidation.valid) {
        throw new Error(sizeValidation.error);
      }

      const magicValidation = validateImageMagicBytes(imageBuffer);
      if (!magicValidation.valid && options.strict) {
        throw new Error(magicValidation.error);
      }
    }

    return imageBuffer;
  } catch (error) {
    const errorMsg = `Error descargando imagen desde ${imageUrl}: ${error.message}`;
    logger.error(errorMsg);

    if (options.strict) {
      throw new Error(errorMsg);
    }
    return null;
  }
}

/**
 * Lee imagen desde ruta local
 * @param {string} localPath - Ruta relativa a src/public/
 * @param {Object} options - { validate: boolean, strict: boolean }
 * @returns {Promise<Buffer|null>}
 */
export async function readImageFromLocal(localPath, options = { validate: false, strict: false }) {
  try {
    const fullPath = path.resolve(process.cwd(), 'src', 'public', localPath);
    logger.info('Leyendo imagen localmente', { localPath, fullPath });

    const imageBuffer = await fs.promises.readFile(fullPath);

    // Validar si se solicita
    if (options.validate) {
      const sizeValidation = validateImageBuffer(imageBuffer);
      if (!sizeValidation.valid) {
        throw new Error(sizeValidation.error);
      }

      const magicValidation = validateImageMagicBytes(imageBuffer);
      if (!magicValidation.valid && options.strict) {
        throw new Error(magicValidation.error);
      }
    }

    return imageBuffer;
  } catch (error) {
    const errorMsg = `Error leyendo imagen local ${localPath}: ${error.message}`;
    logger.error(errorMsg);

    if (options.strict) {
      throw new Error(errorMsg);
    }
    return null;
  }
}

/**
 * Descarga/procesa imagen desde URL o ruta local
 * Polimórfica: detecta automáticamente el tipo de entrada (URL vs ruta local)
 * @param {string} imageSource - URL (http/https) o ruta local
 * @param {Object} options - { validate: boolean, strict: boolean }
 * @returns {Promise<Buffer|null>}
 */
export async function processImageFromSource(imageSource, options = { validate: false, strict: true }) {
  if (!imageSource) {
    throw new Error('Fuente de imagen no proporcionada');
  }

  // Detectar tipo de entrada
  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    // Es URL remota
    return downloadImageFromUrl(imageSource, options);
  } else {
    // Asumir ruta local
    return readImageFromLocal(imageSource, options);
  }
}

/**
 * Asegura que el resultado sea un Buffer válido
 * Especialmente útil cuando puede venir un Buffer o una ruta/URL
 * @param {Buffer|string} imageInput - Buffer, URL (http/https) o ruta local
 * @param {Object} options - { validate: boolean, strict: boolean }
 * @returns {Promise<Buffer>}
 */
export async function ensureImageBuffer(imageInput, options = { validate: false, strict: false }) {
  // Si ya es Buffer
  if (Buffer.isBuffer(imageInput)) {
    if (options.validate) {
      const validation = validateImageBuffer(imageInput);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }
    return imageInput;
  }

  // Si es string (URL o ruta local), procesar como fuente
  if (typeof imageInput === 'string') {
    return processImageFromSource(imageInput, options);
  }

  throw new Error('imageInput debe ser Buffer, URL (http/https) o ruta local');
}
