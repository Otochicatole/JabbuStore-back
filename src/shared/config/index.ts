import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'secret',
  sessionSecret: process.env.SESSION_SECRET || 'session-secret',
  steamApiKey: process.env.STEAM_API_KEY || '',
  cs2ShApiKey: process.env.CS2_SH_API_KEY || '',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  
  /**
   * Intervalo de actualización automática de la base de datos de ítems para venta (en minutos).
   * Refresca los inventarios desde Steam hacia la base de datos local.
   * Se puede configurar mediante la variable de entorno STORE_SYNC_INTERVAL_MINUTES.
   */
  storeSyncIntervalMinutes: parseInt(process.env.STORE_SYNC_INTERVAL_MINUTES || '10', 10),
};
