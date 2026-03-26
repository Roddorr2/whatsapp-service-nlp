/**
 * Interpolates the {nombre} placeholder in a message text if present
 * @param {string} text - Message text with possible {nombre} placeholder
 * @param {string} nombre - Name to interpolate (default: '')
 * @returns {string} - Processed text
 */
export function interpolateMessage(text, nombre = '') {
  if (!text || typeof text !== 'string') return text || '';
  if (!nombre) return text;
  
  // Only replace if it contains {nombre}
  if (text.includes('{nombre}')) {
    return text.replace(/{nombre}/g, nombre);
  }
  
  return text;
}
