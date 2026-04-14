import fs from 'fs';
import path from 'path';

const DEFAULT_MASK = '****REDACTED****';
const SENSITIVE_KEYS = [
  'password', 'pass', 'secret'
];

const BOOLEAN_SENSITIVE_KEYS = [
  'api_key', 'apikey', 'authorization', 'auth', 'token', 'jwt', 'access_token', 'refresh_token', 'credential', 'x-api-key'
];

function isJWT(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(value);
}

function isBearer(value) {
  return typeof value === 'string' && /^Bearer\s+.+/i.test(value);
}

function isWhatsAppJid(str) {
  if (typeof str !== 'string') return false;
  return /^\+?\d{6,}@(s\.whatsapp\.net|g\.us|lid)$/.test(str) || /^\d+@/.test(str);
}

function maskWhatsAppJid(jid, strategy = 'partial') {
  const parts = jid.split('@');
  const num = parts[0] || '';
  const last = num.slice(-4);
  if (strategy === 'partial') return `****${last}@${parts[1] || ''}`;
  return DEFAULT_MASK;
}

function summarizeError(err) {
  if (!err || typeof err !== 'object') return String(err);
  const name = err.name || err.type || (err.constructor && err.constructor.name) || 'Error';
  const message = err.message || err.msg || '';
  // shortStack: first stack line if available
  let shortStack = null;
  if (typeof err.stack === 'string') {
    shortStack = err.stack.split('\n')[0];
  }
  return { name, message, shortStack };
}

function isLikelySecret(value) {
  if (typeof value !== 'string') return false;
  if (isJWT(value) || isBearer(value)) return true;
  // long base64/hex-like strings
  if (/^[A-Fa-f0-9]{40,}$/.test(value)) return true;
  if (/^[A-Za-z0-9+/=]{40,}$/.test(value)) return true;
  return false;
}

function maskValue(value, strategy = 'full') {
  if (strategy === 'partial' && typeof value === 'string' && value.length > 8) {
    const first = value.slice(0, 4);
    const last = value.slice(-4);
    return `${first}...${last}`;
  }
  return DEFAULT_MASK;
}

function sanitizeString(str, options = {}) {
  const strategy = options.maskStrategy || process.env.LOG_MASK_STRATEGY || 'full';
  if (isLikelySecret(str)) return maskValue(str, strategy);
  // mask whatsapp JIDs (phone numbers) to reveal only last 4 digits
  // also handle formatted numbers like "+51 (931) 640-662"
  if (typeof str === 'string') {
    const digits = str.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) {
      return maskWhatsAppJid(`${digits}@s.whatsapp.net`, strategy);
    }
    if (isWhatsAppJid(str)) return maskWhatsAppJid(str, strategy);
  }
  // try to redact inline bearer/JWT tokens
  if (isBearer(str)) return maskValue(str, strategy);
  if (isJWT(str)) return maskValue(str, strategy);
  // if long string, truncate
  if (typeof str === 'string' && str.length > (options.maxStringLength || 1000)) {
    return str.slice(0, 1000) + '...';
  }
  return str;
}

function sanitize(obj, options = {}) {
  const seen = new WeakSet();
  const strategy = options.maskStrategy || process.env.LOG_MASK_STRATEGY || 'full';

  function _sanitize(value, key) {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      if (Array.isArray(value)) return value.map((v) => _sanitize(v));
      const out = {};
      for (const k of Object.keys(value)) {
        try {
          const lk = k.toLowerCase();
          if (BOOLEAN_SENSITIVE_KEYS.includes(lk)) {
            out[k] = !!value[k];
            continue;
          }
          if (SENSITIVE_KEYS.includes(lk)) {
            out[k] = maskValue(String(value[k]), strategy);
            continue;
          }
          if (lk === 'stack') {
            const stackVal = value[k];
            if (typeof stackVal === 'string') {
              if (process.env.NODE_ENV === 'development') out[k] = stackVal.split('\n').slice(0, 2).join(' | ');
              else out[k] = '[stack omitted]';
              continue;
            }
          }
          out[k] = _sanitize(value[k], k);
        } catch (err) {
          out[k] = '[SanitizeError]';
        }
      }
      return out;
    }
    if (typeof value === 'string') return sanitizeString(value, { maskStrategy: strategy, maxStringLength: options.maxStringLength });
    return value;
  }

  return _sanitize(obj);
}

class Logger {
  constructor(moduleName = 'APP', opts = {}) {
    this.moduleName = moduleName;
    this.maskStrategy = opts.maskStrategy || process.env.LOG_MASK_STRATEGY || 'full';
    this.logToFile = (process.env.LOG_TO_FILE === 'true') || false;
    this.logDir = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');
    if (this.logToFile) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch (e) {
        // ignore
      }
    }
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const safeMessage = typeof message === 'string' ? sanitizeString(message, { maskStrategy: this.maskStrategy }) : message;
    // Pre-process data: summarize long error objects and mask known jid fields
    const pre = Object.assign({}, data);
    if (pre.err) pre.err = summarizeError(pre.err);
    // common key location from baileys
    if (pre.key && pre.key.remoteJid) {
      try { pre.key.remoteJid = sanitizeString(pre.key.remoteJid, { maskStrategy: this.maskStrategy }); } catch (_) { pre.key.remoteJid = '[jid]'; }
    }
    const safeData = sanitize(pre, { maskStrategy: this.maskStrategy });
    
    // JSON para archivo (completo, sin cambios)
    const logEntry = {
      timestamp,
      level,
      module: this.moduleName,
      message: safeMessage,
      data: safeData
    };
    const jsonLine = JSON.stringify(logEntry);

    // Formato 3 para stdout (console legible)
    const levelEmojis = {
      'INFO': '',
      'WARN': '⚠️ ',
      'ERROR': '❌',
      'DEBUG': '🔍',
      'SECURITY': '🔐'
    };
    const icon = levelEmojis[level];
    const levelStr = level.toUpperCase().padEnd(5);
    const jsonStr = Object.keys(safeData).length > 0 ? JSON.stringify(safeData) : '';
    const consoleLine = `[${timestamp}] [${levelStr}] ${icon} ${safeMessage}${jsonStr ? ' | ' + jsonStr : ''}`;
    
    // Write formatted line to stdout (sanitized)
    process.stdout.write(consoleLine + '\n');

    // Optionally write JSON to file destinations
    if (this.logToFile) {
      try {
        const fileName = level === 'SECURITY' ? 'security.log' : 'app.log';
        const filePath = path.join(this.logDir, fileName);
        fs.appendFileSync(filePath, jsonLine + '\n');
      } catch (err) {
        // If file write fails, still continue without throwing
        process.stderr.write(`Logger file write error: ${err.message}\n`);
      }
    }
  }

  info(message, data = {}) { this.log('INFO', message, data); }
  warn(message, data = {}) { this.log('WARN', message, data); }
  error(message, data = {}) { this.log('ERROR', message, data); }
  debug(message, data = {}) { this.log('DEBUG', message, data); }

  // Formatted log for webhooks and operations (Option 2: [MODULE] icon Message | {json} | timestamp)
  formatted(message, icon = '📝', metadata = {}) {
    const timestamp = new Date();
    const isoTime = timestamp.toISOString();
    const safeMessage = typeof message === 'string' ? sanitizeString(message, { maskStrategy: this.maskStrategy }) : message;
    const safeData = sanitize(metadata, { maskStrategy: this.maskStrategy });
    
    // Compact JSON (no spaces)
    const jsonStr = Object.keys(safeData).length > 0 ? JSON.stringify(safeData) : '';
    
    // Format: [MODULE] icon Message | {json} | timestamp
    const line = `[${this.moduleName}] ${icon} ${safeMessage}${jsonStr ? ' | ' + jsonStr : ''} | ${isoTime}`;
    process.stdout.write(line + '\n');

    // Optionally write to file destinations
    if (this.logToFile) {
      try {
        const filePath = path.join(this.logDir, 'app.log');
        fs.appendFileSync(filePath, line + '\n');
      } catch (err) {
        process.stderr.write(`Logger file write error: ${err.message}\n`);
      }
    }
  }

  // Security-level logging kept explicit
  security(event, data = {}) { this.log('SECURITY', event, data); }

  child(moduleName) { return new Logger(`${this.moduleName}:${moduleName}`, { maskStrategy: this.maskStrategy }); }
}

const logger = new Logger();

function _safeIpFromReq(req) {
  try {
    return (req && (req.ip || req.headers && req.headers['x-forwarded-for'] || req.connection && req.connection.remoteAddress)) || null;
  } catch (e) {
    return null;
  }
}

// Auth event helpers: never log header values; only flags/allowlisted headers
function logAuthFailure(req = {}, reason = 'auth_failure') {
  const meta = {
    requestId: (req.headers && req.headers['x-request-id']) || null,
    ip: _safeIpFromReq(req),
    method: req.method || null,
    path: req.originalUrl || req.url || null,
    hasAuthorizationHeader: !!(req.headers && (req.headers.authorization || req.headers['x-api-key'])),
  };
  logger.security(`Authentication failure: ${reason}`, meta);
}

function logAuthSuccess(req = {}, user = {}) {
  const meta = {
    requestId: (req.headers && req.headers['x-request-id']) || null,
    ip: _safeIpFromReq(req),
    method: req.method || null,
    path: req.originalUrl || req.url || null,
    userId: user && (user.id || user.userId) || null
  };
  logger.security('Authentication success', meta);
}

export { logger as default, sanitize, logAuthFailure, logAuthSuccess };