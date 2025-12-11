export default {
  apps: [{
    name: 'whatsapp-service',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 5111
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5111
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Configuraciones para evitar que se cierre por errores
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    // Manejo de señales
    kill_timeout: 5000,
    listen_timeout: 3000,
    // Configuraciones de memoria
    node_args: '--max-old-space-size=4096 --trace-warnings',
    // Logs
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
