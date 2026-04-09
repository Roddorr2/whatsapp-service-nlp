const SENSITIVE_KEYS = new Set([
  'password','pass','secret'
]);

const BOOLEAN_SENSITIVE_KEYS = new Set([
  'api_key','apikey','authorization','auth','token','jwt','access_token','refresh_token','credential','x-api-key'
]);

const DEFAULT_MASK = '****REDACTED****';

function maskValue(v, strategy = 'full') {
  if (strategy === 'partial' && typeof v === 'string' && v.length > 8) {
    const first = v.slice(0, 4);
    const last = v.slice(-4);
    return `${first}...${last}`;
  }
  return DEFAULT_MASK;
}

function isWhatsAppJid(str) {
  if (typeof str !== 'string') return false;
  // match numbers (with optional +) followed by @s.whatsapp.net
  return /^\+?\d{6,}@s\.whatsapp\.net$/.test(str);
}

function maskWhatsAppJid(jid, strategy = 'partial') {
  // keep the @s.whatsapp.net suffix and show last 4 digits of the number
  const parts = jid.split('@');
  const num = parts[0];
  const last = num.slice(-4);
  if (strategy === 'partial') return `****${last}@${parts[1]}`;
  return DEFAULT_MASK;
}

function extractDigitsAsJid(str) {
  if (typeof str !== 'string') return null;
  // remove non-digits
  const digits = str.replace(/\D/g, '');
  // require at least 9 digits to be considered a valid phone JID (country + number)
  if (digits.length < 9) return null;
  return `${digits}@s.whatsapp.net`;
}

function stripSensitive(obj, options = {}) {
  const seen = new WeakSet();
  const strategy = options.maskStrategy || process.env.LOG_MASK_STRATEGY || 'full';

  function _strip(value, key) {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      if (Array.isArray(value)) return value.map((v) => _strip(v));
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Map) {
        const o = {};
        for (const [k, v] of value.entries()) o[k] = _strip(v, k);
        return o;
      }
      if (value instanceof Set) return Array.from(value).map((v) => _strip(v));

      const out = {};
      for (const k of Object.keys(value)) {
        try {
          const lk = k.toLowerCase();
          if (BOOLEAN_SENSITIVE_KEYS.has(lk)) {
            out[k] = !!value[k];
            continue;
          }
          if (SENSITIVE_KEYS.has(lk)) {
            out[k] = maskValue(String(value[k]), strategy);
            continue;
          }
          // Special-case stack traces: omit in prod, short in dev
          if (lk === 'stack') {
            const stackVal = value[k];
            if (typeof stackVal === 'string') {
              if (process.env.NODE_ENV === 'development') {
                out[k] = stackVal.split('\n').slice(0, 2).join(' | ');
              } else {
                out[k] = '[stack omitted]';
              }
              continue;
            }
          }
          out[k] = _strip(value[k], k);
        } catch (e) {
          out[k] = '[SanitizeError]';
        }
      }
      return out;
    }
    if (typeof value === 'string') {
      // handle formatted phone numbers like "+51 (931) 640-662"
      const possibleJid = extractDigitsAsJid(value);
      if (possibleJid) return maskWhatsAppJid(possibleJid, options.maskStrategy || process.env.LOG_MASK_STRATEGY);
      // mask whatsapp JIDs like 519316406620@s.whatsapp.net -> ****6620@s.whatsapp.net
      if (isWhatsAppJid(value)) return maskWhatsAppJid(value, options.maskStrategy || process.env.LOG_MASK_STRATEGY);
      if (value.length > (options.maxStringLength || 1000)) return value.slice(0, (options.maxStringLength || 1000)) + '...';
      return value;
    }
    return value;
  }

  return _strip(obj);
}

function sanitizeResponsePayload(payload, options = {}) {
  return stripSensitive(payload, options);
}

function sanitizeErrorResponse(status, err = {}, opts = {}) {
  const requestId = opts.requestId || null;

  // Try to provide a friendly/translatable message for known error types
  function translateError(e) {
    if (!e || typeof e !== 'object') return null;
    const name = e.name || e.type || (e.constructor && e.constructor.name) || null;
    if (!name) return null;
    const map = {
      PreKeyError: { code: 'prekey_error', message: 'Clave PreKey inválida (falló desencriptado)' },
      TypeError: { code: 'type_error', message: 'Error de tipo interno' },
      ValidationError: { code: 'validation_error', message: 'Datos inválidos' },
      SyntaxError: { code: 'syntax_error', message: 'Error de sintaxis' }
      // añadir más mapeos según sea necesario
    };
    return map[name] || null;
  }

  const translated = translateError(err);

  if (status >= 500) {
    return { status, error: 'internal_error', message: translated && translated.message ? translated.message : 'Internal server error', requestId };
  }

  if (status === 401) {
    return { status, error: 'unauthorized', message: translated && translated.message ? translated.message : 'Authentication required', requestId, hasAuthHeader: !!opts.hasAuthHeader };
  }

  if (status === 429) {
    return { status, error: 'rate_limited', message: translated && translated.message ? translated.message : 'Too many requests', requestId, retryAfter: opts.retryAfter || null };
  }

  if (status === 400 || status === 422) {
    const fields = Array.isArray(err.details) ? err.details.map(d => ({ name: d.path || d.field || d.name, error: d.type || d.code || 'invalid' })) : undefined;
    return { status, error: 'bad_request', message: translated && translated.message ? translated.message : (err && err.message ? err.message : 'Invalid input'), requestId, fields };
  }

  return { status, error: err && err.code ? err.code : (translated && translated.code ? translated.code : 'error'), message: translated && translated.message ? translated.message : (err && err.message ? err.message : 'Error'), requestId };
}

export { sanitizeResponsePayload, sanitizeErrorResponse };
