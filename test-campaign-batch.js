#!/usr/bin/env node

/**
 * Test Script para Endpoint: POST /messages/send-campaign-batch
 * Uso: node test-campaign-batch.js
 */

import http from 'http';
import { URL } from 'url';

// Configuración
const API_BASE_URL = 'http://localhost:5111';
const API_KEY = 'dev_local_2026_digimedia';
const ENDPOINT = '/api/whatsapp/send-campaign-batch';

// Payload de prueba
const testPayload = {
  campania_id: 12345,
  chunk_number: 1,
  message: 'Hola {nombre}, tu pedido está listo para retirar 🎉',
  recipients: [
    {
      id_modalservicio: 'modal_001',
      nombre: 'Juan Pérez',
      telefono: '931640662'
    },
    {
      id_modalservicio: 'modal_002',
      nombre: 'María García',
      telefono: '900279651'
    }
  ],
  id_servicio: 'service_001'
};

/**
 * Función para hacer la solicitud POST
 */
function makeRequest(path, method, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE_URL + path);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        ...headers
      },
      timeout: 30000
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: parsed
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: responseData
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout after 30 seconds'));
    });

    const payload = JSON.stringify(data);
    req.write(payload);
    req.end();
  });
}

/**
 * Función para imprimir resultados formateados
 */
function printResults(response) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 RESPUESTA DEL SERVIDOR');
  console.log('='.repeat(80));
  
  console.log(`\n✓ Status Code: ${response.statusCode} ${response.statusMessage}`);
  
  console.log(`\n📋 Headers:`);
  Object.entries(response.headers).forEach(([key, value]) => {
    if (!['date', 'transfer-encoding', 'connection'].includes(key)) {
      console.log(`   ${key}: ${value}`);
    }
  });

  console.log(`\n📝 Body:`);
  console.log(JSON.stringify(response.body, null, 2));

  // Análisis de respuesta
  if (response.body.success) {
    console.log('\n' + '✅ '.repeat(20));
    console.log(`\n✅ CAMPAÑA PROCESADA EXITOSAMENTE`);
    console.log(`   • Total enviados: ${response.body.total}`);
    console.log(`   • Exitosos: ${response.body.successful}`);
    console.log(`   • Fallidos: ${response.body.failed}`);
    
    if (response.body.results) {
      console.log(`\n📬 Resultados por destinatario:`);
      Object.entries(response.body.results).forEach(([id, result]) => {
        if (result.success) {
          console.log(`   ✅ ${id}: ${result.messageId}`);
        } else {
          console.log(`   ❌ ${id}: ${result.error}`);
        }
      });
    }
  } else {
    console.log('\n' + '❌ '.repeat(20));
    console.log(`\n❌ ERROR EN LA CAMPAÑA`);
    console.log(`   Mensaje: ${response.body.message}`);
    if (response.body.errors) {
      console.log(`\n📋 Errores de validación:`);
      response.body.errors.forEach((error, idx) => {
        console.log(`   ${idx + 1}. Campo: ${error.field}`);
        console.log(`      Mensaje: ${error.message}`);
      });
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Función principal
 */
async function runTest() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST DEL ENDPOINT /send-campaign-batch');
  console.log('='.repeat(80));

  console.log(`\n📍 URL: ${API_BASE_URL}${ENDPOINT}`);
  console.log(`🔐 API Key: ${API_KEY}`);
  console.log(`📦 Método: POST`);

  console.log(`\n📤 Enviando payload:`);
  console.log(JSON.stringify(testPayload, null, 2));

  try {
    console.log(`\n⏳ Esperando respuesta...`);
    const response = await makeRequest(ENDPOINT, 'POST', testPayload);
    printResults(response);

    // Resumen ejecutivo
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMEN EJECUTIVO');
    console.log('='.repeat(80));
    
    const isSuccess = response.statusCode === 200 && response.body.success;
    
    console.log(`\nEstado: ${isSuccess ? '✅ EXITOSO' : '❌ FALLIDO'}`);
    console.log(`Status HTTP: ${response.statusCode}`);
    console.log(`Campaña ID: ${response.body.campania_id || 'N/A'}`);
    console.log(`Destinatarios: ${response.body.total || 'N/A'}`);
    console.log(`Enviados: ${response.body.successful || 0}`);
    console.log(`Fallidos: ${response.body.failed || 0}`);
    console.log(`\n${isSuccess ? '✅ La funcionalidad se conserva intacta después de los cambios' : '❌ Se detectaron problemas con el endpoint'}`);
    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ ERROR EN LA SOLICITUD:');
    console.error(`   ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n   ⚠️  No se puede conectar al servidor.');
      console.error('   Asegúrate de que el servidor esté corriendo:');
      console.error('   npm run dev');
    } else if (error.message.includes('timeout')) {
      console.error('\n   ⚠️  La solicitud tardó demasiado (timeout).');
      console.error('   El servidor podría estar ocupado o sin responder.');
    }
    
    process.exit(1);
  }
}

// Ejecutar prueba
runTest().catch((error) => {
  console.error('Error fatal:', error);
  process.exit(1);
});
