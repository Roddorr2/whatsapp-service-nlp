import fs from 'fs';
import path from 'path';

export function clearAuthContent() {
  const authPath = path.resolve(process.cwd(), 'auth_info');

  console.log('Eliminando contenido de auth_info...');
  try {
    if (fs.existsSync(authPath)) {
      const files = fs.readdirSync(authPath);
      for (const file of files) {
        const filePath = path.join(authPath, file);
        fs.rmSync(filePath, { recursive: true, force: true });
        console.log(`Eliminado: ${file}`);
      }
      console.log('Contenido eliminado.');
    } else {
      console.log('auth_info no existe.');
    }
  } catch (error) {
    console.error('Error al eliminar contenido:', error.message);
  }
}