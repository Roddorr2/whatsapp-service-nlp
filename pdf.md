# Protección - Rutas

## 🎯 OBJETIVO DEL PROYECTO

Proteger los endpoints de envío de campañas WhatsApp para que:

*   ❌ Usuarios no autenticados NO puedan enviar mensajes
*   ❌ Usuarios sin permisos NO puedan crear campañas
*   ✅ Solo usuarios con roles marketing o administrador puedan gestionar campañas
*   ✅ Se registre quién creó cada campaña (auditoría)
*   ✅ La comunicación entre Laravel Backend y WhatsApp Service sea segura

## 🏗 ARQUITECTURA IMPLEMENTADA

Sistema Dual de Autenticación: JWT + API Key

```
┌────────────────────────────────────────────────────────── ───┐
│ USUARIOS (Frontend)                                         │
│ - Usa JWT (Sanctum tokens de Laravel)                       │
│ - Se valida rol: marketing o administrador                  │
└──────────────────────┬─────────────────────────────────── ───┘
│ Bearer Token         ▼
┌────────────────────────────────────────────────────────── ───┐
│ LARAVEL BACKEND (API)                                       │
│ 1. Middleware: auth:sanctum                                 │
│ 2. Middleware: role:marketing,administrador                 │
│ 3. Guarda user_id en BD (auditoría)                         │
│ 4. Dispara Job con API Key                                  │
└──────────────────────┬─────────────────────────────────── ───┘
│ X-API-Key: shared_secret ▼
┌────────────────────────────────────────────────────────── ───┐
│ WHATSAPP SERVICE (Node.js)                                  │
│ 1. Middleware: authenticateJWTorAPIKey                      │
│    - Prioridad 1: JWT (si viene Authorization header)       │
│    - Prioridad 2: API Key (si viene X-API-Key header)       │
│ 2. Middleware: authorizeRoles(['marketing','administrador'])│
│ 3. Envía mensajes masivos                                   │
└────────────────────────────────────────────────────────── ───┘
```

## 🔐 ¿POR QUÉ JWT Y API KEY?

### JWT (JSON Web Token)

*   **Uso:** Autenticación de usuarios desde frontend
*   **Ventaja:** Contiene información del usuario (id, nombre, rol)
*   **Flujo:** Usuario → Login → Token → Request con token
*   **Expira:** Configurable (horas / días)

### API Key

*   **Uso:** Comunicación servidor a servidor (Laravel → WhatsApp Service)
*   **Ventaja:** No expira, más simple para Jobs en background
*   **Flujo:** Job de Laravel → Request con API Key → WhatsApp Service valida
*   **Seguridad:** Clave compartida secreta

### ¿Por qué ambos?

*   **JWT:** Para usuarios humanos con roles y permisos
*   **API Key:** Para procesos automáticos (Jobs que no tienen "usuario")
*   **Fallback:** Si JWT del usuario expira mientras el Job corre (puede tardar horas), la API Key garantiza que el Job no falle

## 📋 LISTADO COMPLETO DE CAMBIOS

### 󾠮 BACKEND LARAVEL

#### A) Migración de Base de Datos

*   📄 **Archivo:** `database/migrations/2026_02_16_000000_add_user_id_to_campanias_whatsapp_table.php`
*   **¿Qué hace?**
    *   Agrega columna `user_id` a la tabla `campanias_whatsapp`
    *   Crea foreign key con tabla `users`
    *   Crea índice para optimizar consultas por usuario
*   **¿Por qué?**
    *   Auditoría: Saber quién creó cada campaña
    *   Trazabilidad: En caso de problemas, identificar al responsable
    *   Reportes: Generar estadísticas por usuario / equipo
*   **Código clave:**

    ```php
    $table->unsignedBigInteger('user_id')->nullable()->after('id_servicio');
    $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
    ```

#### B) Modelo CampaniaWhatsApp

*   📄 **Archivo:** `CampaniaWhatsApp.php`
*   **¿Qué se modificó?**

    ```php
    // ANTES
    protected $fillable = [
        'id_servicio',
        'parrafo',
        'imagen_url',
        ...
    ];

    // AHORA
    protected $fillable = [
        'id_servicio',
        'user_id', // ← NUEVO
        'parrafo',
        'imagen_url',
        ...
    ];

    // NUEVA RELACIÓN
    public function usuario()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }
    ```

*   **¿Por qué?**
    *   Permitir asignar masivamente el campo `user_id`
    *   Acceder fácilmente al usuario: `$campania->usuario->name`

#### C) Controlador WhatsAppCampaignController

*   📄 **Archivo:** `WhatsAppCampaignController.php`
*   **¿Qué se modificó?**

    ```php
    // ANTES
    $campania = CampaniaWhatsApp::create([
        'id_servicio' => $id_servicio,
        'parrafo'     => $validated['paragraph'],
        ...
    ]);

    // AHORA
    $campania = CampaniaWhatsApp::create([
        'id_servicio' => $id_servicio,
        'user_id'     => $request->user()->id, // ← NUEVO: Registra quién la creó
        'parrafo'     => $validated['paragraph'],
        ...
    ]);

    Log::info('Campaña WhatsApp creada', [
        'campania_id'       => $campania->id_campania,
        'creado_por_user_id' => $request->user()->id, // ← NUEVO
        'creado_por_nombre'  => $request->user()->name // ← NUEVO
    ]);
    ```

*   **¿Por qué?**
    *   Guardar automáticamente el ID del usuario autenticado
    *   Logs completos para debugging y auditoría

#### D) Job SendWhatsAppCampaignJob

*   📄 **Archivo:** `SendWhatsAppCampaignJob.php`
*   **¿Qué se modificó?**

    ```php
    // ANTES
    $response = Http::timeout(60)
        ->withHeaders([
            'Content-Type' => 'application/json',
            'Accept'       => 'application/json',
        ])
        ->post(env('WHATSAPP_API_URL') . '/api/whatsapp/send-campaign-batch', $payload);

    // AHORA
    $response = Http::timeout(60)
        ->withHeaders([
            'Content-Type' => 'application/json',
            'Accept'       => 'application/json',
            'X-API-Key'    => env('WHATSAPP_SERVICE_API_KEY'), // ← NUEVO
        ])
        ->post(env('WHATSAPP_API_URL') . '/api/whatsapp/send-campaign-batch', $payload);
    ```

*   **¿Por qué?**
    *   El Job necesita autenticarse con WhatsApp Service
    *   Usa API Key porque es un proceso automático (no tiene JWT de usuario)

#### E) Rutas Protegidas

*   📄 **Archivo:** `api.php`
*   **¿Qué se modificó?**

    ```php
    // ANTES (SIN PROTECCIÓN)
    Route::post('/whatsapp/campaign/activate', [WhatsAppCampaignController::class, 'activateCampaign']);
    Route::get('/whatsapp/campaign/{id}/status', [WhatsAppCampaignController::class, 'getCampaignStatus']);
    Route::get('/whatsapp/campaigns', [WhatsAppCampaignController::class, 'listCampaigns']);

    // AHORA (PROTEGIDO)
    Route::middleware('auth:sanctum')->group(function () {
        Route::middleware('role:marketing,administrador')->group(function () {
            Route::post('/whatsapp/campaign/activate', [WhatsAppCampaignController::class, 'activateCampaign']);
            Route::get('/whatsapp/campaign/{id}/status', [WhatsAppCampaignController::class, 'getCampaignStatus']);
            Route::get('/whatsapp/campaigns', [WhatsAppCampaignController::class, 'listCampaigns']);
        });
    });
    ```

*   **¿Por qué?**
    *   `auth:sanctum`: Solo usuarios autenticados
    *   `role:marketing,administrador`: Solo estos roles específicos
    *   Doble capa de seguridad

#### F) Variables de Entorno

*   📄 **Archivo:** `.env`
*   **Nuevas variables:**

    ```
    WHATSAPP_API_URL=http://localhost:5111
    WHATSAPP_SERVICE_API_KEY=dev_local_2026_digimedia
    ```

*   **¿Por qué?**
    *   `WHATSAPP_API_URL`: Dónde está el servicio de WhatsApp
    *   `WHATSAPP_SERVICE_API_KEY`: Clave compartida para autenticar Jobs

### 󾠯 WHATSAPP SERVICE (Node.js)

#### A) Middleware de Autenticación

*   📄 **Archivo:** `auth.middleware.js`
*   **Nuevos middlewares creados:**

    1.  **authenticateJWTorAPIKey**

        ```javascript
        export async function authenticateJWTorAPIKey(req, res, next) {
            const authHeader = req.headers.authorization;
            const apiKey = req.headers['x-api-key'];

            // 1. Prioridad: JWT
            if (authHeader) {
                return authenticateJWT(req, res, next);
            }

            // 2. Fallback: API Key
            if (apiKey) {
                if (!process.env.API_KEY || apiKey !== process.env.API_KEY) {
                    return res.status(401).json({ success: false, message: 'API Key inválida' });
                }
                req.user = { userId: 0, username: 'Sistema (Job)', role: 'system', isSystemJob: true };
                return next();
            }

            return res.status(401).json({ success: false, message: 'Se requiere autenticación (JWT o API Key)' });
        }
        ```

        *   **¿Por qué?**
            *   Flexibilidad: Acepta JWT (usuarios) o API Key (Jobs)
            *   Orden: Intenta JWT primero (más seguro), luego API Key
            *   Identificación: Marca si es Job del sistema para logs

    2.  **authorizeRoles**

        ```javascript
        export function authorizeRoles(allowedRoles = []) {
            return (req, res, next) => {
                // Permitir siempre a jobs del sistema
                if (req.user?.isSystemJob) {
                    return next();
                }

                // Validar que el usuario tenga uno de los roles permitidos
                if (req.user && allowedRoles.includes(req.user.role)) {
                    return next();
                }

                return res.status(403).json({ success: false, message: `Acceso prohibido. Se requiere uno de estos roles: ${allowedRoles.join(', ')}` });
            };
        }
        ```

        *   **¿Por qué?**
            *   Múltiples roles: Valida contra array de roles permitidos
            *   Excepción para Jobs: Los Jobs del sistema siempre pasan
            *   Mensajes claros: Dice exactamente qué roles se necesitan

    3.  **Actualización de authenticateJWT**

        ```javascript
        // ANTES
        req.user = {
            userId: data.user?.id || data.id,
            username: data.user?.name || data.name,
            role: 'admin' // ← Hardcoded, siempre admin
        };

        // AHORA
        req.user = {
            userId: data.user?.id || data.id,
            username: data.user?.name || data.name,
            role: data.rol || 'user', // ← Extrae rol REAL desde Laravel
            roleData: data.empleado?.rol
        };
        ```

        *   **¿Por qué?**
            *   Roles reales: Ya no asume que todos son 'admin'
            *   Validación cruzada: Consulta a Laravel para obtener el rol
            *   Debugging: Agrega log del rol extraído

#### B) Rutas Protegidas

*   📄 **Archivo:** `message.routes.js`
*   **¿Qué se modificó?**

    ```javascript
    // ANTES (SIN PROTECCIÓN)
    router.post('/send-message', sendMessage);
    router.post('/send-campaign-batch', sendCampaignBatch);
    router.post('/send-message-image', upload.single("image"), sendMessageWithImageDashboard);

    // AHORA (PROTEGIDO)
    router.post('/send-message', authenticateJWTorAPIKey, authorizeRoles(['marketing', 'administrador', 'system']), validateSendMessage, sendMessage);
    router.post('/send-campaign-batch', authenticateJWTorAPIKey, authorizeRoles(['marketing', 'administrador', 'system']), sendCampaignBatch);
    router.post('/send-message-image', authenticateJWTorAPIKey, authorizeRoles(['marketing', 'administrador', 'system']), upload.single("image"), sendMessageWithImageDashboard);

    // Rutas del QR también actualizadas:
    router.get('/qr-code', authenticateJWT, authorizeRoles(['administrador', 'marketing']), getQrCode); // ← Ambos roles
    router.post('/qr-request', authenticateJWT, authorizeRoles(['administrador', 'marketing']), requestNewQr); // ← Ambos roles
    ```

*   **¿Por qué?**
    *   Endpoints críticos protegidos: Nadie sin autenticación puede enviar mensajes
    *   Roles específicos: Solo marketing / administrador (y system para Jobs)
    *   QR disponible: Ambos roles pueden gestionar WhatsApp

#### C) Variables de Entorno

*   📄 **Archivo:** `.env`
*   **Nueva variable agregada:**

    ```
    API_KEY=dev_local_2026_digimedia
    MAIN_BACKEND_URL=http://127.0.0.1:8000
    ```

*   **¿Por qué?**
    *   `API_KEY`: Debe coincidir con `WHATSAPP_SERVICE_API_KEY` de Laravel
    *   `MAIN_BACKEND_URL`: Para validar JWT contra Laravel Backend

## 🔄 FLUJO COMPLETO DE UNA CAMPAÑA

### Escenario 1: Usuario crea campaña desde Frontend

1.  Usuario hace login Frontend → `POST /api/login` Laravel → Valida credenciales → Genera Sanctum token
    Frontend recibe: `{ "token": "abc123..." }`
2.  Usuario crea campaña Frontend → `POST /api/whatsapp/campaign/activate`
    Headers: `Authorization: Bearer abc123...`
    Body: `{ service: 'p1', paragraph: '...', image: File }`
3.  Laravel valida
    *   ✓ Middleware `auth:sanctum` → Token válido?
    *   ✓ Middleware `role:marketing,administrador` → Rol permitido?
    *   ✓ Controller registra `user_id` en BD
    *   ✓ Dispara Job
4.  Job procesa
    *   ✓ Divide destinatarios en chunks (20 por batch)
    *   ✓ Por cada chunk:
        *   → `POST /api/whatsapp/send-campaign-batch`
        *   → Headers: `X-API-Key: dev_local_2026_digimedia`
        *   → Body: `{ recipients: [...], message: '...', image_url: '...' }`
5.  WhatsApp Service valida
    *   ✓ Middleware `authenticateJWTorAPIKey` → No hay `Authorization` header → Detecta `X-API-Key` header → Valida `API_KEY === X-API-Key` → Crea `req.user = { role: 'system', isSystemJob: true }`
    *   ✓ Middleware `authorizeRoles(['marketing', 'administrador', 'system'])` → `req.user.isSystemJob = true` → PERMITIDO
    *   ✓ Controller envía mensajes masivos
6.  Resultado
    *   ✓ Campaña completada
    *   ✓ BD tiene registro de quién la creó (`user_id`)
    *   ✓ Logs tienen trazabilidad completa

### Escenario 2: Usuario sin rol intenta crear campaña

1.  Usuario con rol "ventas" hace login
    *   ✓ Obtiene token válido
2.  Intenta crear campaña Frontend → `POST /api/whatsapp/campaign/activate`
    Headers: `Authorization: Bearer xyz789...`
3.  Laravel bloquea
    *   ✓ Middleware `auth:sanctum` → ✅ Token válido
    *   ✓ Middleware `role:marketing,administrador` → ❌ Rol "ventas" NO permitido
        ← Respuesta: `403 Forbidden { "status": "error", "message": "No tiene los permisos necesarios" }`
4.  No se crea campaña
    *   ✗ No se guarda en BD
    *   ✗ No se dispara Job
    *   ✗ No se envían mensajes

### Escenario 3: Request sin autenticación

1.  Alguien intenta enviar mensaje sin token
    `POST /api/whatsapp/send-campaign-batch`
    Headers: (vacío)
2.  WhatsApp Service bloquea
    *   ✓ Middleware `authenticateJWTorAPIKey` → No hay `Authorization` header → JWT no disponible → No hay `X-API-Key` header → API Key no disponible
        ← Respuesta: `401 Unauthorized { "success": false, "message": "Se requiere autenticación (JWT o API Key)" }`
3.  Request rechazado
    *   ✗ No se procesa

## 📦 CHECKLIST DE REPLICACIÓN

Para replicar en otro proyecto, seguir en orden:

### Paso 1: Backend (Laravel)

1.  Crear migración de auditoría

    ```bash
    php artisan make:migration add_user_id_to_[tabla]_table
    ```
2.  En la migración agregar:

    ```php
    $table->unsignedBigInteger('user_id')->nullable()->after('id');
    $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
    $table->index('user_id');
    ```
3.  Ejecutar migración

    ```bash
    php artisan migrate
    ```
4.  Actualizar Modelo

    ```php
    protected $fillable = [..., 'user_id'];

    public function usuario() {
        return $this->belongsTo(User::class, 'user_id');
    }
    ```
5.  Actualizar Controller

    ```php
    'user_id' => $request->user()->id,
    ```
6.  Proteger rutas en `routes/api.php`

    ```php
    Route::middleware('auth:sanctum')->group(function () {
        Route::middleware('role:marketing,administrador')->group(function () {
            // Rutas protegidas aquí
        });
    });
    ```
7.  Actualizar Job (si envía a otro servicio)

    ```php
    ->withHeaders(['X-API-Key' => env('SERVICE_API_KEY')])
    ```
8.  Configurar `.env`

    ```
    SERVICE_API_KEY=clave_compartida_segura
    ```

### Paso 2: Servicio Externo (Node.js)

1.  Crear middlewares en `src/middlewares/auth.middleware.js`
    *   Copiar los 3 middlewares:
        *   `authenticateJWT` (con validación a Laravel)
        *   `authenticateJWTorAPIKey`
        *   `authorizeRoles`
2.  Actualizar rutas en `src/routes/*.js`

    ```javascript
    import { authenticateJWTorAPIKey, authorizeRoles } from '../middlewares/auth.middleware.js';
    router.post('/endpoint-critico', authenticateJWTorAPIKey, authorizeRoles(['marketing', 'administrador', 'system']), controller );
    ```
3.  Configurar `.env`

    ```
    API_KEY=clave_compartida_segura # DEBE coincidir con Laravel
    MAIN_BACKEND_URL=http://localhost:8000
    ```

### Paso 3: Generar claves seguras

*   PowerShell (Windows)

    ```powershell
    -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
    ```
*   Bash (Linux/Mac)

    ```bash
    openssl rand -base64 48
    ```

### Paso 4: Probar

1.  Login

    ```bash
    curl -X POST <http://localhost:8000/api/login> \\
    -H "Content-Type: application/json" \\
    -d '{"email":"test@test.com","password":"password"}'
    ```
2.  Usar endpoint protegido

    ```bash
    curl -X POST <http://localhost:8000/api/endpoint-protegido> \\
    -H "Authorization: Bearer TOKEN_AQUI"
    ```
3.  Verificar que sin token falla con 401
4.  Verificar que con rol incorrecto falla con 403
5.  Verificar que Jobs funcionan con API Key

## ⚙ CONFIGURACIÓN PRODUCCIÓN

### Laravel (.env)

```
WHATSAPP_API_URL=https://whatsapp.tudominio.com
WHATSAPP_SERVICE_API_KEY=prod_wsk_9j4k2n8m7l6p5q4r3s2t1u0v9w8x7y6z
```

### WhatsApp Service (.env)

```
API_KEY=prod_wsk_9j4k2n8m7l6p5q4r3s2t1u0v9w8x7y6z # MISMA que Laravel
MAIN_BACKEND_URL=https://api.tudominio.com
ALLOWED_ORIGINS=https://tudominio.com,<https://dashboard.tudominio.com>
NODE_ENV=production
```

**Reglas de oro:**

*   ✅ `WHATSAPP_SERVICE_API_KEY` (Laravel) = `API_KEY` (WhatsApp Service)
*   ✅ Claves largas (64+ caracteres aleatorios)
*   ✅ Diferentes claves por entorno (dev, staging, prod)
*   ✅ Nunca subir `.env` a Git
*   ✅ Rotar claves cada 3-6 meses

## 🎓 CONCEPTOS CLAVE

### Middleware en cadena

```javascript
router.post('/ruta', middleware1, middleware2, middleware3, controller);
```

*   Se ejecutan en orden
*   Si uno falla (`return res.status`), se detiene la cadena
*   Cada uno puede modificar `req` y `res`

### Sanctum (Laravel)

*   Sistema de tokens API
*   Token se guarda en tabla `personal_access_tokens`
*   Token incluye "abilities" (roles / permisos)

### JWT vs API Key

| Característica | JWT                 | API Key             |
| -------------- | ------------------- | ------------------- |
| Expira         | Sí (configurable)   | No                  |
| Contiene datos | Sí (payload)        | No (solo string)    |
| Validación     | Firma criptográfica | Comparación exacta |
| Uso ideal      | Usuarios            | Servidor a servidor |
