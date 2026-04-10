import logger from '../utils/logger.js';
import { sanitizeErrorResponse } from '../utils/sanitizeResponse.js';

function generateRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

export default function errorHandler(err, req, res, next) {
  const status = err && err.status ? err.status : 500;
  const requestId = (req && req.headers && (req.headers['x-request-id'] || req.headers['X-Request-Id'])) || (res && res.get && res.get('X-Request-Id')) || generateRequestId();
  const safe = sanitizeErrorResponse(status, err, { requestId, hasAuthHeader: !!(req && req.headers && (req.headers.authorization || req.headers['x-api-key'])), retryAfter: err && err.retryAfter });

  // Log internal details server-side (sanitized by logger)
  logger.error(`Error ${status} - ${requestId}`, { message: err && err.message, stack: process.env.NODE_ENV === 'development' ? err && err.stack : undefined, requestId });

  // Send safe, consistent error payload to client
  try {
    res.status(status).json(safe);
  } catch (e) {
    // If response failed, fallback to minimal payload
    try {
      res.status(500).json({ status: 500, error: 'internal_error', message: 'Internal server error', requestId });
    } catch (ie) {
      // last resort: write plain text
      try { res.statusCode = 500; res.end('Internal server error'); } catch (_) { /* ignore */ }
    }
  }
}
