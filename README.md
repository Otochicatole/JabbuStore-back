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
* `bun run start` o `npm run start`: Ejecuta la aplicación compilada.
* `bun run prisma:generate` o `npm run prisma:generate`: Genera el cliente de Prisma basado en el esquema.
* `bun run prisma:migrate` o `npm run prisma:migrate`: Ejecuta las migraciones pendientes en la base de datos de desarrollo.
* **Scripts Adicionales:** `reindex-floats` y `fix-bot-inspect-links` (scripts utilitarios específicos del negocio).

## Variables de Entorno (Configuración)
El proyecto requiere un archivo `.env` en la raíz. Las variables típicas incluirían:
* `DATABASE_URL`: Cadena de conexión a la base de datos.
* `STEAM_API_KEY`: Clave de la API de Steam para Passport.
* `MERCADOPAGO_ACCESS_TOKEN`: Token de acceso para la integración de pagos.
* `JWT_SECRET`: Secreto para firmar JSON Web Tokens.
* `PORT`: Puerto en el que corre el servidor (por defecto suele ser 3000 o 8080).
* `SESSION_SECRET`: Secreto para la sesión de Express.
