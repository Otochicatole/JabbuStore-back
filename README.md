# JabbuStore - Backend Documentation

## Descripción General
JabbuStore API es el servidor backend que da soporte a la plataforma de comercio electrónico. Provee una API RESTful robusta y comunicación en tiempo real para el frontend. Está diseñado para manejar autenticación de usuarios, gestión de inventario, procesamiento de pagos e interacción en tiempo real.

## Stack Tecnológico
* **Entorno de Ejecución:** Node.js
* **Framework Web:** Express.js
* **Lenguaje:** TypeScript
* **ORM:** Prisma
* **Base de Datos:** Soporte para SQLite (Better-SQLite3), PostgreSQL (pg) y libSQL.
* **Autenticación:** Passport.js (Específicamente `passport-steam` para login con Steam) y JWT.
* **Validación de Datos:** Zod
* **Comunicación en Tiempo Real:** Socket.io
* **Pagos:** SDK de MercadoPago
* **Seguridad:** Helmet, CORS, Express Rate Limit

## Características Principales
* **Autenticación con Steam:** Los usuarios pueden iniciar sesión utilizando sus cuentas de Steam, ideal para una tienda de artículos de juegos como CS.
* **Gestión de Base de Datos ORM:** Utiliza Prisma para una interacción segura y fuertemente tipada con la base de datos.
* **Procesamiento de Pagos:** Rutas integradas para manejar la creación de preferencias de pago y webhooks de MercadoPago.
* **WebSockets:** Servidor de Socket.io integrado para emitir eventos en tiempo real al frontend.
* **Validación Robusta:** Uso de Zod para asegurar que los datos entrantes en la API tengan el formato y los tipos correctos.
* **Seguridad API:** Implementación de rate limiting, cabeceras de seguridad con Helmet y encriptación de contraseñas con bcrypt (para usuarios no provenientes de Steam).

## Scripts Disponibles

En el directorio del proyecto, puedes ejecutar:

* `bun run dev` o `npm run dev`: Inicia el servidor en modo desarrollo utilizando `nodemon` y genera el cliente de Prisma.
* `bun run build` o `npm run build`: Compila el código TypeScript a JavaScript en el directorio `dist`.
* `bun run start` o `npm run start`: Ejecuta primero `prisma migrate deploy` y sólo inicia la aplicación compilada si todas las migraciones se aplicaron correctamente.
* `bun run prisma:generate` o `npm run prisma:generate`: Genera el cliente de Prisma basado en el esquema.
* `npm run prisma:check`: Comprueba que la cadena completa de migraciones produzca exactamente el esquema Prisma actual.
* `bun run prisma:migrate` o `npm run prisma:migrate`: Ejecuta las migraciones pendientes en la base de datos de desarrollo.
* **Scripts Adicionales:** `reindex-floats` y `fix-bot-inspect-links` (scripts utilitarios específicos del negocio).

## Despliegue de base de datos

El servicio debe arrancarse mediante `npm start` (o `bun run start`), no ejecutando
`node dist/index.js` directamente. El script de inicio aplica las migraciones
pendientes antes de aceptar tráfico y falla de forma segura si la base no puede
actualizarse.

Los cambios de `prisma/schema.prisma` siempre deben incluir una migración en
`prisma/migrations`. `prisma db push` puede usarse para prototipos locales, pero
no reemplaza una migración versionada y nunca debe usarse como mecanismo de
despliegue en producción.

El build ejecuta `prisma:check`; si alguien modifica el esquema sin agregar su
migración, la compilación falla antes de que ese código pueda desplegarse.

## Variables de Entorno (Configuración)
El proyecto requiere un archivo `.env` en la raíz. Las variables típicas incluirían:
* `DATABASE_URL`: Cadena de conexión a la base de datos.
* `STEAM_API_KEY`: Clave de la API de Steam para Passport.
* `MERCADOPAGO_ACCESS_TOKEN`: Token de acceso para la integración de pagos.
* `JWT_SECRET`: Secreto para firmar JSON Web Tokens.
* `PORT`: Puerto en el que corre el servidor (por defecto suele ser 3000 o 8080).
* `SESSION_SECRET`: Secreto para la sesión de Express.

## Pool de assets del Global Market

La recolección usa un pool HTTP continuo dentro de un único proceso Node. Con
`MARKET_ASSETS_FORCE_MAX_CONCURRENCY=true` (valor predeterminado), mantiene
activos los `MARKET_ASSETS_CONCURRENCY=48` workers desde el inicio para completar
la descarga en el menor tiempo posible. Cada worker procesa una listing y pagina
secuencialmente hasta obtener el máximo configurado para ella. No se crean
procesos del sistema por skin.

Los workers son lógicos: un admission pacer inicia por defecto hasta
`MARKET_ASSETS_INITIAL_REQUESTS_PER_SECOND=4` requests físicas por segundo y
puede crecer saludablemente hasta `MARKET_ASSETS_MAX_REQUESTS_PER_SECOND=16`.
Esto conserva suficiente concurrencia para respuestas lentas, pero evita que
respuestas `5xx` rápidas reciclen los 48 slots, consuman la cuota y dejen de
producir assets.

`MARKET_ASSETS_TARGET_DURATION_SECONDS=600` define un SLO de diez minutos, no un
timeout ni una garantía absoluta. El modo forzado no reduce el número de workers;
el pacer sí puede bajar temporalmente el ritmo físico o cerrar su gate ante
timeouts/`5xx`, cuota o `429`, y conserva como fatales los errores `401`, `402` y
`403`. Si se prefiere que también el pool reduzca o escale su concurrencia según
la salud del proveedor, se puede configurar
`MARKET_ASSETS_FORCE_MAX_CONCURRENCY=false`; en ese modo comienza con
`MARKET_ASSETS_INITIAL_CONCURRENCY=6`. Si el proveedor no permite sostener el
rendimiento necesario, la corrida continúa, reporta
`ten_minute_target_unreachable` y conserva el snapshot anterior hasta reunir y
validar el objetivo completo; nunca publica un snapshot parcial sólo porque hayan
transcurrido los diez minutos.

Los valores canónicos y el resto de opciones de cuota, timeout y archivos
durables están documentados en `.env.example`. Los cambios de concurrencia o
ritmo requieren reiniciar el proceso.

`POST /api/market/sync/cancel` detiene cooperativamente una recolección activa:
aborta los requests pendientes, integra las respuestas que ya terminaron,
guarda el checkpoint y conserva visible el snapshot publicado anterior. La
cancelación se rechaza cuando la corrida ya entró en validación o publicación.
