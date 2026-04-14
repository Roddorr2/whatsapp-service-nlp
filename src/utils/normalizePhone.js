/**
 * Normaliza un número de teléfono a formato JID de WhatsApp (@s.whatsapp.net)
 * Usa DEFAULT_COUNTRY_CODE como prefijo si el número parece local (≤10 dígitos)
 * 
 * @param {string|number} rawPhoneInput - Número de teléfono (con o sin caracteres especiales)
 * @returns {string} Número formateado como JID (ej: "51987654321@s.whatsapp.net")
 * @throws {Error} Si el número no tiene entre 9 y 15 dígitos
 */
export function normalizePhone(rawPhoneInput) {
  if (!rawPhoneInput) return '';
  
  // Convertir a string si es necesario
  let raw = typeof rawPhoneInput === 'string' ? rawPhoneInput : String(rawPhoneInput);

  // Si ya es un JID, devolver como está
  if (raw.includes('@')) return raw;

  // Limpiar: solo dígitos y quitar ceros a la izquierda
  let cleanPhone = raw.replace(/\D/g, '').replace(/^0+/, '');

  // Obtener DEFAULT_COUNTRY_CODE, ignorando comillas
  const defaultCountry = (process.env.DEFAULT_COUNTRY_CODE || process.env.WHATSAPP_DEFAULT_COUNTRY || '')
    .replace(/['\"]/g, '');

  // Si hay default country y el número parece local (≤10 dígitos y no comienza con el prefijo),
  // prepend el código de país
  if (defaultCountry && !cleanPhone.startsWith(defaultCountry) && cleanPhone.length <= 10) {
    cleanPhone = `${defaultCountry}${cleanPhone}`;
  }

  // Validar rango de dígitos
  if (cleanPhone.length < 9 || cleanPhone.length > 15) {
    throw new Error('El número de teléfono debe tener entre 9 y 15 dígitos');
  }

  return `${cleanPhone}@s.whatsapp.net`;
}
