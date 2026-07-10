import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { prisma } from './shared/infrastructure/PrismaClient';
import session from 'express-session';
import passport from 'passport';
import { rateLimit } from 'express-rate-limit';
import { configurePassport } from './modules/auth/infrastructure/PassportConfig';
import { applyRuntimeConfigOverrides } from './shared/config';
import authRoutes from './modules/auth/infrastructure/AuthRoutes';
import userRoutes from './modules/users/infrastructure/UserRoutes';
import adminRoutes from './modules/admins/infrastructure/AdminRoutes';
import storeRoutes from './modules/store/infrastructure/StoreRoutes';
import marketRoutes from './modules/market/infrastructure/MarketRoutes';
import catalogRoutes from './modules/catalog/infrastructure/CatalogRoutes';
import orderRoutes from './modules/orders/infrastructure/OrderRoutes';
import marketplaceRoutes from './modules/marketplace/infrastructure/MarketplaceRoutes';
import adminMarketplaceRoutes from './modules/marketplace/infrastructure/AdminMarketplaceRoutes';
import ticketRoutes from './modules/tickets/infrastructure/TicketRoutes';
import notificationRoutes from './modules/notifications/infrastructure/NotificationRoutes';
import quoteRoutes from './modules/quotes/infrastructure/QuoteRoutes';
import raffleRoutes from './modules/raffles/infrastructure/RaffleRoutes';
import reviewRoutes from './modules/reviews/infrastructure/ReviewRoutes';
import { initializeTicketSocket } from './modules/tickets/infrastructure/TicketSocket';


dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 10000,
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function splitConfig(value?: string) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hostnameFromUrl(value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function hostnameFromUrlOrHost(value?: string | null) {
  if (!value) return null;
  return (hostnameFromUrl(value) || value.trim()).toLowerCase();
}

const devAllowedOrigins =
  process.env.NODE_ENV === 'production'
    ? []
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3001',
      ];

const configuredFrontendOrigins = splitConfig(process.env.FRONTEND_URL || 'http://localhost:3000');
const configuredBackendOrigins = splitConfig(process.env.BACKEND_URL || 'http://localhost:3001');
const corsAllowedOrigins = Array.from(
  new Set([...devAllowedOrigins, ...configuredFrontendOrigins].filter(Boolean)),
);

function csrfOriginGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!unsafeMethods.has(req.method.toUpperCase())) return next();

  const cookieHeader = req.headers.cookie || '';
  const hasSessionCookie = /(?:^|;\s*)(auth_token|admin_token)\s*=/.test(cookieHeader);
  if (!hasSessionCookie) return next();

  const allowedHosts = new Set(
    [
      ...configuredFrontendOrigins.map(hostnameFromUrlOrHost),
      ...configuredBackendOrigins.map(hostnameFromUrlOrHost),
      ...devAllowedOrigins.map(hostnameFromUrlOrHost),
      hostnameFromUrlOrHost(headerValue(req.headers['x-forwarded-host'])),
      hostnameFromUrlOrHost(req.headers.host || null),
    ].filter((value): value is string => Boolean(value)),
  );

  const originHost = hostnameFromUrl(req.headers.origin);
  const refererHost = hostnameFromUrl(req.headers.referer);
  const requestHost = originHost || refererHost;

  if (!requestHost || !allowedHosts.has(requestHost)) {
    return res.status(403).json({ error: 'Invalid request origin' });
  }

  return next();
}

app.use(helmet());
app.use(limiter);
app.use(cors({
  origin: corsAllowedOrigins,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  },
}));
app.use(csrfOriginGuard);

// Session & Passport
app.set('trust proxy', 1); // Trust the dev tunnel proxy
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.BACKEND_URL?.startsWith('https'), // Secure cookies if using HTTPS
      sameSite: 'lax',
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/admin/marketplace', adminMarketplaceRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/raffles', raffleRoutes);
app.use('/api/reviews', reviewRoutes);


import { errorHandler } from './shared/infrastructure/middlewares/errorHandler';
app.use(errorHandler);

app.get('/', (req, res) => {
  res.json({ 
    message: 'Server is running', 
    architecture: 'Clean + Screaming',
    modules: ['users', 'admins']
  });
});

import { startStoreSyncScheduler } from './modules/store/infrastructure/StoreSyncScheduler';
import { startMarketSyncScheduler } from './modules/market/infrastructure/MarketSyncScheduler';
import { startMarketFloatsSyncScheduler } from './modules/market/infrastructure/MarketFloatsSyncScheduler';
import { startItemsCatalogSyncScheduler } from './modules/pricing/infrastructure/ItemsCatalogSyncScheduler';
import { startRaffleScheduler } from './modules/raffles/infrastructure/RaffleScheduler';

async function bootstrap() {
  // Limpiar configuraciones no editables en la DB para respetar el archivo .env
  await prisma.runtimeSetting.deleteMany({
    where: {
      key: {
        notIn: ['ENABLE_SYNC', 'ENABLE_ITEMS_CATALOG_SYNC'],
      },
    },
  });

  await applyRuntimeConfigOverrides();
  await configurePassport();

  initializeTicketSocket(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    // Inventario físico de bots Steam
    startStoreSyncScheduler();
    // Catálogo local de precios de bots vía /steam/api/items
    startItemsCatalogSyncScheduler();
    // Catálogo de reventa YouPin vía /steam/api/float/assets (precios incluidos por asset)
    startMarketSyncScheduler();
    // Sincronizador periódico de floats del plan Float Small
    startMarketFloatsSyncScheduler();
    // Ejecución automática de sorteos programados vencidos
    startRaffleScheduler();
  });
}

bootstrap().catch((error) => {
  console.error("[Bootstrap] Error iniciando backend:", error);
  process.exit(1);
});
