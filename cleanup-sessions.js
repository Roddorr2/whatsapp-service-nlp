#!/usr/bin/env node

import 'dotenv/config';
import sessionManager from './src/services/session.manager.js';
import whatsappService from './src/services/whatsapp.service.js';
import logger from './src/utils/logger.js';
import fs from 'fs';
import path from 'path';

const COOLDOWN_FILE = path.join(process.cwd(), '.cleanup-cooldown');
const COOLDOWN_MINUTES = 5;
const AUTH_PATH = path.resolve(process.cwd(), 'auth_info');

const args = process.argv.slice(2);
const config = {
  days: parseInt(args.find(arg => arg.startsWith('--days='))?.split('=')[1]) || 7,
  all: args.includes('--all'),
  checkOnly: args.includes('--check-only'),
  force: args.includes('--force'),
  help: args.includes('--help') || args.includes('-h')
};


function showHelp() {
  console.log(`
LIMPIEZA DE ARCHIVOS ANTIGUOS EN auth_info

USO:
  node cleanup-sessions.js [opciones]

OPCIONES:
  --days=N         Limpiar archivos con antigüedad > N días (default: 7)
  --all            Limpiar TODOS los archivos excepto creds.json
  --check-only     Solo verificar, no limpiar
  --force          Ignorar cooldown
  --help, -h       Mostrar esta ayuda

EJEMPLOS:
  node cleanup-sessions.js              # Limpia >7 días
  node cleanup-sessions.js --days=30    # Limpia >30 días
  node cleanup-sessions.js --all        # Limpia todo excepto creds.json
  node cleanup-sessions.js --check-only # Solo verifica

ARCHIVOS LIMPIADOS: session-*.json, pre-key-*.json, app-state-sync-*.json
PROTEGIDOS: creds.json
`);
}

function checkCooldown() {
  if (config.force) {
    return { allowed: true, reason: 'Modo --force (cooldown ignorado)' };
  }

  if (!fs.existsSync(COOLDOWN_FILE)) {
    return { allowed: true, reason: 'Primera ejecución' };
  }

  try {
    const lastExecution = parseInt(fs.readFileSync(COOLDOWN_FILE, 'utf-8'));
    const timeSince = Date.now() - lastExecution;
    const minutesSince = Math.floor(timeSince / (1000 * 60));
    
    if (minutesSince < COOLDOWN_MINUTES) {
      const waitMinutes = COOLDOWN_MINUTES - minutesSince;
      return {
        allowed: false,
        reason: `Cooldown activo`,
        waitMinutes: waitMinutes,
        lastExecution: new Date(lastExecution).toISOString()
      };
    }
    
    return {
      allowed: true,
      reason: `Cooldown expirado (${minutesSince} minutos desde última ejecución)`
    };
  } catch (error) {
    return { allowed: true, reason: 'Error leyendo cooldown (permitiendo)' };
  }
}

function saveCooldown() {
  try {
    fs.writeFileSync(COOLDOWN_FILE, Date.now().toString());
  } catch (error) {
    logger.warn('No se pudo guardar cooldown', { error: error.message });
  }
}

async function checkActiveSession() {
  try {
    const qrStatus = whatsappService.getQRStatus();
    
    // Proteger si está conectado o conectando
    if (qrStatus.isConnected || 
        qrStatus.connectionState.status === 'connected' ||
        qrStatus.connectionState.isConnecting ||
        qrStatus.connectionState.isReconnecting) {
      return {
        hasActiveSession: true,
        status: qrStatus.connectionState.status,
        message: 'Sesión activa o conectando'
      };
    }
    
    return {
      hasActiveSession: false,
      status: qrStatus.connectionState.status,
      message: 'No hay sesión activa'
    };
  } catch (error) {
    return {
      hasActiveSession: false,
      status: 'unknown',
      message: 'No se puede determinar estado'
    };
  }
}

//Analiza archivos en auth_info y clasifica por antigüedad
 
function analyzeAuthFiles() {
  if (!fs.existsSync(AUTH_PATH)) {
    return {
      exists: false,
      files: [],
      message: 'auth_info no existe'
    };
  }

  const files = fs.readdirSync(AUTH_PATH);
  const now = Date.now();
  
  const fileAnalysis = files.map(file => {
    const filePath = path.join(AUTH_PATH, file);
    const stats = fs.statSync(filePath);
    const ageInMs = now - stats.mtime.getTime();
    const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));
    
    // Determinar tipo de archivo
    let fileType = 'unknown';
    let canDelete = true; // Por defecto, todos son eliminables
    
    if (file === 'creds.json') {
      fileType = 'creds';
      canDelete = false; // NUNCA eliminar creds.json
    } else if (file.startsWith('session-')) {
      fileType = 'session';
      canDelete = true;
    } else if (file.startsWith('pre-key-')) {
      fileType = 'pre-key';
      canDelete = true;
    } else if (file.startsWith('app-state-sync-key-')) {
      fileType = 'app-state-sync-key';
      canDelete = true;
    } else if (file.startsWith('app-state-sync-version-')) {
      fileType = 'app-state-sync-version';
      canDelete = true;
    }

    return {
      name: file,
      path: filePath,
      type: fileType,
      canDelete: canDelete,
      ageInDays: ageInDays,
      ageInHours: Math.floor(ageInMs / (1000 * 60 * 60)),
      size: stats.size,
      lastModified: stats.mtime
    };
  });
  
  return {
    exists: true,
    files: fileAnalysis,
    total: fileAnalysis.length,
    deletable: fileAnalysis.filter(f => f.canDelete).length,
    protected: fileAnalysis.filter(f => !f.canDelete).length
  };
}

function getFilesToClean(analysis, config) {
  if (!analysis.exists || analysis.files.length === 0) {
    return [];
  }
  
  return analysis.files.filter(file => {
    // NUNCA eliminar creds.json
    if (!file.canDelete) {
      return false;
    }
    
    // Modo --all: eliminar todos los deletables
    if (config.all) {
      return true;
    }
    
    // Modo normal: eliminar por antigüedad
    return file.ageInDays > config.days;
  });
}

/**
 * Ejecuta limpieza de archivos
 */
function executeCleanup(filesToClean) {
  const results = {
    success: [],
    failed: [],
    totalSize: 0
  };
  
  for (const file of filesToClean) {
    try {
      fs.unlinkSync(file.path);
      results.success.push(file.name);
      results.totalSize += file.size;
      logger.info('Archivo eliminado', { file: file.name, age: file.ageInDays });
    } catch (error) {
      results.failed.push({ name: file.name, error: error.message });
      logger.error('Error eliminando archivo', { file: file.name, error: error.message });
    }
  }
  
  return results;
}

/**
 * Muestra tabla de archivos
 */
function showFileTable(files) {
  console.log('');
  console.log('┌─────────────────────────────────────────────┬──────────┬──────┬────────┐');
  console.log('│ Archivo                                     │ Tipo     │ Días │ Estado │');
  console.log('├─────────────────────────────────────────────┼──────────┼──────┼────────┤');
  
  for (const file of files.slice(0, 20)) { // Mostrar máximo 20
    const name = file.name.padEnd(43).substring(0, 43);
    const type = file.type.padEnd(8).substring(0, 8);
    const age = String(file.ageInDays).padStart(4);
    const status = file.canDelete ? '  🗑️   ' : '  🔒   ';
    console.log(`│ ${name} │ ${type} │ ${age} │ ${status} │`);
  }
  
  if (files.length > 20) {
    console.log(`│ ... y ${files.length - 20} archivos más                                               │`);
  }
  
  console.log('└─────────────────────────────────────────────┴──────────┴──────┴────────┘');
  console.log('');
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       🧹 LIMPIEZA DE ARCHIVOS ANTIGUOS EN auth_info 🧹          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  if (config.help) {
    showHelp();
    process.exit(0);
  }
  
  console.log('📋 Configuración:');
  if (config.all) {
    console.log('   - Modo: LIMPIEZA TOTAL (excepto creds.json)');
  } else {
    console.log(`   - Antigüedad mínima: ${config.days} días`);
  }
  console.log(`   - Solo verificar: ${config.checkOnly ? 'SÍ' : 'NO'}`);
  console.log(`   - Forzar (sin cooldown): ${config.force ? 'SÍ' : 'NO'}`);
  console.log('');
  
  try {
    // PASO 1: Verificar cooldown
    console.log('⏱️  [1/5] Verificando cooldown...');
    const cooldown = checkCooldown();
    
    if (!cooldown.allowed) {
      console.error(`\n❌ COOLDOWN ACTIVO`);
      console.error(`   Última ejecución: ${cooldown.lastExecution}`);
      console.error(`   Espera: ${cooldown.waitMinutes} minuto(s)\n`);
      console.error('💡 Usa --force para ignorar (no recomendado)\n');
      process.exit(1);
    }
    
    console.log(`✅ ${cooldown.reason}`);
    console.log('');
    
    // PASO 2: Verificar sesión activa
    console.log('🔍 [2/5] Verificando sesión activa...');
    const sessionCheck = await checkActiveSession();
    
    if (sessionCheck.hasActiveSession) {
      console.log(`⚠️  ${sessionCheck.message} (${sessionCheck.status})`);
      console.log('   → Limpieza permitida (solo archivos antiguos, creds.json protegido)');
    } else {
      console.log(`✅ ${sessionCheck.message}`);
    }
    console.log('');
    
    // PASO 3: Health Check WhatsApp
    console.log('🏥 [3/5] Verificando salud de WhatsApp...');
    const healthCheck = await sessionManager.checkWhatsAppHealth();
    
    if (!healthCheck.available) {
      console.error(`\n❌ WhatsApp no disponible`);
      console.error(`   Estado: ${healthCheck.status}`);
      console.error(`   Mensaje: ${healthCheck.message}`);
      console.error('\n⚠️  Limpieza pausada por seguridad (previene falsos positivos)\n');
      process.exit(1);
    }
    
    console.log(`✅ WhatsApp disponible (${healthCheck.status})`);
    console.log('');
    
    // PASO 4: Analizar archivos
    console.log('📂 [4/5] Analizando archivos en auth_info...');
    const analysis = analyzeAuthFiles();
    
    if (!analysis.exists) {
      console.log(`   ℹ️  ${analysis.message}`);
      console.log('\n✅ No hay nada que limpiar.\n');
      process.exit(0);
    }
    
    console.log(`   Total archivos: ${analysis.total}`);
    console.log(`   Archivos protegidos: ${analysis.protected} (creds.json)`);
    console.log(`   Archivos eliminables: ${analysis.deletable}`);
    
    // Mostrar tabla de archivos
    showFileTable(analysis.files);
    
    // PASO 5: Evaluar y ejecutar
    console.log('⚖️  [5/5] Evaluando criterios de limpieza...');
    const filesToClean = getFilesToClean(analysis, config);
    
    if (filesToClean.length === 0) {
      console.log('   ℹ️  No hay archivos que cumplan los criterios de limpieza');
      if (!config.all) {
        console.log(`   💡 Todos los archivos tienen menos de ${config.days} días o están protegidos`);
      }
      console.log('\n✅ No se requiere limpieza.\n');
      process.exit(0);
    }
    
    console.log(`   📊 Archivos a eliminar: ${filesToClean.length}`);
    console.log('');
    
    console.log('   Archivos marcados para eliminación:');
    for (const file of filesToClean) {
      console.log(`     🗑️  ${file.name} (${file.ageInDays} días, ${file.type})`);
    }
    console.log('');
    
    if (config.checkOnly) {
      console.log('ℹ️  Modo --check-only: Se eliminarían estos archivos pero no se ejecuta.\n');
      console.log('💡 Ejecuta sin --check-only para limpiar\n');
      process.exit(0);
    }
    

    console.log('🗑️  Procediendo con limpieza...\n');
    const results = executeCleanup(filesToClean);
    
    if (results.success.length > 0) {
      console.log('✅ LIMPIEZA EXITOSA\n');
      console.log(`   📁 Archivos eliminados: ${results.success.length}`);
      console.log(`   💾 Espacio liberado: ${(results.totalSize / 1024).toFixed(2)} KB`);
      
      if (results.failed.length > 0) {
        console.log(`\n   ⚠️  Archivos con error: ${results.failed.length}`);
        for (const fail of results.failed) {
          console.log(`      ❌ ${fail.name}: ${fail.error}`);
        }
      }
      
      console.log('\n   💡 creds.json intacto - la sesión se mantendrá');
      console.log('');

      saveCooldown();
      
      process.exit(0);
    } else {
      console.error(`\n❌ ERROR: No se pudo eliminar ningún archivo\n`);
      for (const fail of results.failed) {
        console.error(`   ❌ ${fail.name}: ${fail.error}`);
      }
      console.error('');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ ERROR CRÍTICO:', error.message);
    logger.error('Error en comando cleanup-sessions', {
      error: error.message,
      stack: error.stack
    });
    console.error('');
    process.exit(1);
  }
}


main();
