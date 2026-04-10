import { normalizePhone } from '../src/utils/normalizePhone.js';

// Configurar DEFAULT_COUNTRY_CODE para las pruebas
process.env.DEFAULT_COUNTRY_CODE = '51';

const cases = [
  // ✅ Casos válidos básicos
  {
    name: 'Entrada vacía',
    input: '',
    expected: '',
    shouldThrow: false
  },
  {
    name: 'null como entrada',
    input: null,
    expected: '',
    shouldThrow: false
  },
  {
    name: 'International con + y espacios',
    input: '+51 931 640 662',
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Local sin country code (Perú)',
    input: '931640662',
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Local con 10 dígitos',
    input: '9316406620',
    expected: '519316406620@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Ya es JID',
    input: '51931640662@s.whatsapp.net',
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Solo dígitos, 11 dígitos',
    input: '51931640662',
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Con ceros a la izquierda',
    input: '00051931640662',
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Número como número (no string)',
    input: 931640662,
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Ya tiene country code, no agregar duplicado',
    input: '51931640662',
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: '11 dígitos sin country code (se agrega 51)',
    input: '9316406620',
    expected: '519316406620@s.whatsapp.net',
    shouldThrow: false
  },
  {
    name: 'Con guiones y espacios',
    input: '+51 (931) 640-662',
    expected: '51931640662@s.whatsapp.net',
    shouldThrow: false
  },

  // ❌ Casos que deben fallar (validación)
  {
    name: 'Menos de 9 dígitos (será rechazado)',
    input: '123456',
    expected: null,
    shouldThrow: true
  },
  {
    name: 'Más de 15 dígitos',
    input: '519316406620123456',
    expected: null,
    shouldThrow: true
  },
  {
    name: 'Sin dígitos válidos',
    input: 'abcdefgh',
    expected: null,
    shouldThrow: true
  }
];

let allPass = true;
let passCount = 0;
let failCount = 0;

console.log(`\n🧪 Ejecutando ${cases.length} casos de prueba para normalizePhone...\n`);

for (const c of cases) {
  try {
    const out = normalizePhone(c.input);
    if (c.shouldThrow) {
      console.error(`❌ FAIL ${c.name}: debería haber lanzado un error pero retornó '${out}'`);
      allPass = false;
      failCount++;
    } else if (out !== c.expected) {
      console.error(`❌ FAIL ${c.name}: got='${out}' expected='${c.expected}'`);
      allPass = false;
      failCount++;
    } else {
      console.log(`✅ PASS ${c.name}`);
      console.log(`   Input: ${JSON.stringify(c.input)} → Output: ${out}`);
      passCount++;
    }
  } catch (err) {
    if (c.shouldThrow) {
      console.log(`✅ PASS ${c.name} (error esperado)`);
      console.log(`   Error: ${err.message}`);
      passCount++;
    } else {
      console.error(`❌ ERROR ${c.name}: ${err.message}`);
      allPass = false;
      failCount++;
    }
  }
}

console.log(`\n📊 Resultados: ${passCount} pasados, ${failCount} fallados`);

if (!allPass) {
  console.error('\n❌ Algunas pruebas fallaron');
  process.exit(1);
}

console.log('\n✅ Todas las pruebas de normalizePhone pasaron exitosamente');
process.exit(0);
