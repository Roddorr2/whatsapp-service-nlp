#!/usr/bin/env node

/**
 * Test de Rate Limiting en /login endpoint
 * Verifica que después de 5 intentos fallidos,
 * los siguientes requests reciben error 429 (Too Many Requests)
 */

const BASE_URL = 'http://localhost:5111';
const TEST_DELAY = 500; // ms entre requests

async function makeRequest(attempt) {
  try {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testuser',
        password: 'wrongpassword'
      })
    });

    const data = await response.json();
    
    return {
      attempt,
      status: response.status,
      statusText: response.statusText,
      message: data.message,
      rateLimitRemaining: response.headers.get('RateLimit-Remaining'),
      rateLimitReset: response.headers.get('RateLimit-Reset')
    };
  } catch (error) {
    return {
      attempt,
      error: error.message
    };
  }
}

async function testRateLimiting() {
  console.log('\n🔒 TEST: Rate Limiting en /login endpoint\n');
  console.log('Política: 5 intentos por 15 minutos por IP');
  console.log('─'.repeat(70));

  for (let i = 1; i <= 8; i++) {
    const result = await makeRequest(i);
    
    if (result.error) {
      console.log(`\n❌ Intento ${i}: Error de conexión`);
      console.log(`   ${result.error}`);
    } else {
      const icon = result.status === 429 ? '🚫' : 
                   result.status === 401 ? '❌' : '✅';
      
      console.log(`\n${icon} Intento ${i}:`);
      console.log(`   Status: ${result.status} ${result.statusText}`);
      console.log(`   Message: ${result.message}`);
      console.log(`   RateLimit-Remaining: ${result.rateLimitRemaining}`);
      console.log(`   RateLimit-Reset: ${result.rateLimitReset}`);
    }

    if (i < 8) {
      await new Promise(resolve => setTimeout(resolve, TEST_DELAY));
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log('\n📝 Resultados esperados:');
  console.log('  - Intentos 1-5: ❌ 401 (credenciales inválidas) ✅');
  console.log('  - Intentos 6+: 🚫 429 (Too Many Requests) ✅\n');
}

testRateLimiting().catch(console.error);
