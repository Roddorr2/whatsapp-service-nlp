// Configuración de autenticación hardcodeada
export const AUTH_CONFIG = {
  users: [
    {
      username: process.env.USER_USERNAME || 'usuario',
      password: process.env.USER_PASSWORD || 'usuario123',
      role: process.env.USER_ROLE || 'user'
    },
    {
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || 'admin123',
      role: process.env.ADMIN_ROLE || 'admin'
    }
  ],

  // Verificar que las credenciales estén configuradas
  validateConfig() {
    const requiredEnvVars = [
      'USER_USERNAME', 'USER_PASSWORD', 'USER_ROLE',
      'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_ROLE'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      console.warn(`⚠️  Variables de entorno faltantes: ${missingVars.join(', ')}`);
      console.warn('⚠️  Usando valores por defecto para las credenciales');
    }

    console.log('✅ Configuración de autenticación cargada:');
    this.users.forEach(user => {
      console.log(`   - ${user.username} (${user.role})`);
    });
  }
}; 