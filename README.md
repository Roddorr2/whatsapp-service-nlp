# 🚀 WhatsApp Service API

> **Servicio profesional de WhatsApp Business API con sistema de QR inteligente y gestión avanzada de mensajes**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.1+-blue.svg)](https://expressjs.com/)
[![Baileys](https://img.shields.io/badge/Baileys-6.7+-orange.svg)](https://github.com/WhiskeySockets/Baileys)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

## 📋 Tabla de Contenidos

- [✨ Características](#-características)
- [🚀 Instalación](#-instalación)
- [⚙️ Configuración](#️-configuración)
- [🔧 Uso](#-uso)
- [📡 API Endpoints](#-api-endpoints)
- [🔐 Autenticación](#-autenticación)
- [📱 Sistema de QR](#-sistema-de-qr)
- [💬 Mensajería](#-mensajería)
- [🛡️ Seguridad](#️-seguridad)
- [📊 Monitoreo](#-monitoreo)
- [🧪 Testing](#-testing)
- [📦 Despliegue](#-despliegue)
- [🤝 Contribución](#-contribución)
- [📄 Licencia](#-licencia)

## ✨ Características

### 🔥 **Funcionalidades Principales**
- 📱 **Conexión WhatsApp Business** con autenticación QR
- 💬 **Envío de mensajes** con plantillas personalizables
- 🔐 **Autenticación JWT** y control de roles
- ⚡ **Rate Limiting** avanzado por usuario
- 📊 **Monitoreo en tiempo real** del estado de conexión

### 🎯 **Sistema de QR Avanzado**
- ⏰ **Gestión inteligente del tiempo** de vida del QR
- 🚨 **Sistema de alertas** con estados de urgencia
- 📈 **Métricas detalladas** y estadísticas de uso
- 🎨 **Estados visuales** (Normal, Notice, Warning, Critical)

### 🛡️ **Seguridad y Robustez**
- 🔒 **Autenticación multi-nivel** (JWT + API Keys)
- 🚫 **Rate Limiting** por usuario
- 🧹 **Limpieza automática** de conexiones
- 📝 **Logging completo** de eventos y errores
- 🚨 **Manejo robusto** de errores y desconexiones

## 🚀 Instalación

### 📋 **Prerrequisitos**
- Node.js 18+ 
- npm o yarn
- Cuenta de WhatsApp Business

### 🔧 **Instalación Rápida**

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/whatsapp-service.git
cd whatsapp-service

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env

# Iniciar el servicio
npm start
```

### 📦 **Dependencias Principales**

```json
{
  "@whiskeysockets/baileys": "^6.7.18",
  "express": "^5.1.0",
  "jsonwebtoken": "^9.0.2",
  "bcrypt": "^6.0.0",
  "qrcode": "^1.5.4",
  "helmet": "^8.1.0",
  "cors": "^2.8.5"
}
```

## ⚙️ Configuración

### 🏗️ **Estructura del Proyecto**

```
src/
├── config/          # Configuraciones
├── controllers/     # Controladores de la API
├── middlewares/     # Middlewares personalizados
├── models/          # Modelos de datos
├── routes/          # Definición de rutas
├── services/        # Lógica de negocio
├── utils/           # Utilidades y helpers
├── validators/      # Validación de datos
├── app.js          # Aplicación Express
└── templates.js    # Plantillas de mensajes
```

## 🔧 Uso

### 🚀 **Iniciar el Servicio**

```bash
# Desarrollo
npm run dev

# Producción
npm start

# Con PM2
pm2 start ecosystem.config.js
```

### 📱 **Primera Conexión WhatsApp**

1. **Generar QR**: `POST /api/qr-request`
2. **Escanear QR** con tu WhatsApp
3. **Verificar estado**: `GET /api/qr-status`
4. **Enviar mensaje**: `POST /api/send-message`

## 📡 API Endpoints

### 🔐 **Autenticación**

| Método | Endpoint | Descripción | Autenticación |
|--------|----------|-------------|---------------|
| `POST` | `/api/auth/login` | Login de usuario | No requerida |
| `GET` | `/api/auth/me` | Obtener usuario actual | JWT |

### 📱 **Gestión de QR**

| Método | Endpoint | Descripción | Autenticación |
|--------|----------|-------------|---------------|
| `POST` | `/api/qr-request` | Generar nuevo QR | JWT + Admin |
| `GET` | `/api/qr-status` | Estado del QR | JWT |
| `POST` | `/api/qr-expire` | Expirar QR activo | JWT + Admin |

### 💬 **Mensajería**

| Método | Endpoint | Descripción | Autenticación |
|--------|----------|-------------|---------------|
| `POST` | `/api/send-message` | Enviar mensaje | JWT + Admin |
| `GET` | `/api/status` | Estado general | JWT |

## 🔐 Autenticación

### 🔑 **JWT Authentication**

```bash
# Header de autorización
Authorization: Bearer <jwt_token>

# Ejemplo de token
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 🎭 **Control de Roles**

```javascript
// Solo administradores pueden:
- Generar QRs
- Enviar mensajes
- Expirar QRs
- Acceder a estadísticas
```

### 🔑 **API Key Authentication**

```bash
# Para servicios externos
X-API-Key: <api_key>
```

## 📱 Sistema de QR

### 🎯 **Estados del QR**

| Estado | Tiempo Restante | Color | Acción Recomendada |
|--------|-----------------|-------|-------------------|
| 🟢 **Normal** | >45s | Verde | Monitorear |
| 🟡 **Notice** | ≤45s | Amarillo | Considerar renovar |
| 🟠 **Warning** | ≤30s | Naranja | Renovar pronto |
| 🔴 **Critical** | ≤10s | Rojo | Renovar urgentemente |

### 📊 **Respuesta del Endpoint QR-Status**

```json
{
  "success": true,
  "hasActiveQR": true,
  "isConnected": false,
  "qrInfo": {
    "timeRemaining": 42,
    "timeRemainingFormatted": "0:42",
    "percentageRemaining": 70,
    "timeStatus": "notice",
    "urgencyMessage": "El QR tiene poco tiempo restante",
    "expiresAt": 1703123456789,
    "createdAt": "2023-12-21T10:30:56.789Z",
    "age": 18
  },
  "actions": {
    "canRenew": true,
    "shouldRenew": false,
    "mustRenew": false
  },
  "message": "QR activo con 42 segundos restantes",
  "timestamp": "2023-12-21T10:30:56.789Z"
}
```

### 🔄 **Ciclo de Vida del QR**

```
1. Generación → 2. Activo (60s) → 3. Expiración → 4. Limpieza
     ↓              ↓                ↓            ↓
  QR Request    QR Status      Auto-Expire   Cleanup
```

### 📊 **Dashboard Recomendado**

- **Grafana**: Métricas en tiempo real
- **Prometheus**: Recopilación de datos
- **Elasticsearch**: Búsqueda de logs
- **Kibana**: Visualización de datos

## 💬 Mensajería

### 📝 **Plantillas de Mensajes**

```javascript
// Ejemplo de plantilla
{
  "appointment": {
    "text": "Hola, tienes una cita con {nombrePsicologo} el {fecha} a las {hora}",
    "variables": ["nombrePsicologo", "fecha", "hora"]
  }
}
```

### 📱 **Envío de Mensajes**

```bash
POST /api/send-message
{
  "phone": "34612345678",
  "templateOption": "appointment",
  "psicologo": "Dr. García",
  "fecha": "15/01/2024",
  "hora": "10:00"
}
```

### ✅ **Validaciones**

- ✅ Formato de teléfono internacional
- ✅ Plantilla válida
- ✅ Variables requeridas completas
- ✅ Conexión WhatsApp activa

## 🛡️ Seguridad

### 🔒 **Medidas de Seguridad**

- **Helmet.js**: Headers de seguridad HTTP
- **CORS**: Control de acceso por origen
- **Rate Limiting**: Protección contra spam
- **JWT**: Autenticación stateless segura
- **API Keys**: Autenticación para servicios
- **Validación**: Sanitización de inputs

### 🚫 **Rate Limiting**

```javascript
// Configuración por defecto
{
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,                  // 100 requests por ventana
  standardHeaders: true,
  legacyHeaders: false
}
```

### 📝 **Logging de Seguridad**

- Intentos de login fallidos
- Accesos no autorizados
- Rate limit excedido
- Errores de autenticación

## 📊 Monitoreo

### 📈 **Métricas Disponibles**

- Estado de conexión WhatsApp
- Tiempo de vida del QR
- Estadísticas de mensajes enviados
- Uso de rate limiting
- Errores y excepciones

### 🔍 **Logs Estructurados**

```json
{
  "timestamp": "2023-12-21T10:30:56.789Z",
  "level": "INFO",
  "module": "WHATSAPP_SERVICE",
  "message": "QR generated successfully",
  "userId": "user123",
  "qrExpiresAt": 1703123456789
}
```

## 🧪 Testing

### 🧪 **Tests Unitarios**

```bash
# Ejecutar tests
npm test

# Tests con coverage
npm run test:coverage

# Tests en modo watch
npm run test:watch
```

### 🔍 **Tests de Integración**

```bash
# Tests de API
npm run test:integration

# Tests de servicios
npm run test:services
```

### 📊 **Coverage Mínimo**

- **Líneas**: 90%
- **Funciones**: 95%
- **Branches**: 85%

## 📦 Despliegue

### 🐳 **Docker**

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### 🚀 **Docker Compose**

```yaml
# docker-compose.yml
version: '3.8'
services:
  whatsapp-service:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    volumes:
      - ./auth_info:/app/auth_info
```

### ☁️ **Despliegue en la Nube**

#### **Heroku**
```bash
heroku create whatsapp-service
git push heroku main
```

#### **AWS ECS**
```bash
aws ecs create-service --cluster my-cluster --service-name whatsapp-service
```

#### **Google Cloud Run**
```bash
gcloud run deploy whatsapp-service --source .
```

### 🔧 **Variables de Producción**

```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=secret_super_seguro_produccion
API_KEY=api_key_produccion
```

## 🤝 Contribución

### 📋 **Cómo Contribuir**

1. **Fork** el proyecto
2. **Crea** una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. **Commit** tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. **Push** a la rama (`git push origin feature/AmazingFeature`)
5. **Abre** un Pull Request

### 🎯 **Estándares de Código**

- **ESLint**: Configuración estándar
- **Prettier**: Formateo automático
- **Conventional Commits**: Formato de commits
- **TypeScript**: Tipado opcional

## 📄 Licencia

Este proyecto está bajo la Licencia ISC. Ver el archivo [LICENSE](LICENSE) para más detalles.

## 🙏 **Agradecimientos**

- **Baileys**: Librería principal de WhatsApp
- **Express**: Framework web
- **Comunidad**: Contribuidores y usuarios
- **Colaboradores**: Contribuidores de código

<div align="center">

**⭐ ¿Te gustó el proyecto? ¡Dale una estrella en GitHub! ⭐**

**🚀 Desarrollado con ❤️ por Sstoledo**

[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sstoledo)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/sandro-adrian-toledo-medina-5783892a9/)

</div>

