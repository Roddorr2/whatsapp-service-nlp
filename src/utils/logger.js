class Logger {
  constructor(moduleName = 'APP') {
    this.moduleName = moduleName;
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      module: this.moduleName,
      message,
      ...data
    };
    console.log(JSON.stringify(logEntry));
  }

  info(message, data = {}) {
    this.log('INFO', message, data);
  }

  warn(message, data = {}) {
    this.log('WARN', message, data);
  }

  error(message, data = {}) {
    this.log('ERROR', message, data);
  }

  debug(message, data = {}) {
    this.log('DEBUG', message, data);
  }

  // Método child para compatibilidad
  child(moduleName) {
    return new Logger(`${this.moduleName}:${moduleName}`);
  }
}

// Logger global
const logger = new Logger();

export default logger;