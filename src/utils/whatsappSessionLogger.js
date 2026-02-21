import fs from 'fs';
import path from 'path';

const logDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
}

function writeLog(filename, entry) {
  const file = path.join(logDir, filename);
  const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`;
  try { fs.appendFileSync(file, line); } catch (e) { /* ignore */ }
}

export default {
  logQrRequest(userId) {
    writeLog('whatsapp_session.log', { event: 'qr_request', userId });
    console.log('QR request logged', { userId });
  },
  logQrStatus(source, status) {
    writeLog('whatsapp_session.log', { event: 'qr_status', source, status });
    console.log('QR status logged', { source, status });
  },
  logRestart(userId) {
    writeLog('whatsapp_session.log', { event: 'restart', userId });
    console.log('Restart logged', { userId });
  },
  logQrCode(source, payload) {
    writeLog('whatsapp_session.log', { event: 'qr_code', source, payload });
    console.log('QR code logged', { source });
  }
};
