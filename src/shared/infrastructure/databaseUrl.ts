import path from 'path';

/** Raíz del backend (JabbuStore-back), independiente del cwd del proceso. */
export function getProjectRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * Convierte file:./dev.db en ruta absoluta para que CLI, scripts y servidor
 * usen siempre el mismo archivo SQLite aunque se ejecuten desde otro directorio.
 */
export function resolveDatabaseUrl(raw?: string): string {
  const url = raw ?? process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  if (!url.startsWith('file:')) return url;

  const filePath = url.slice('file:'.length);
  if (path.isAbsolute(filePath)) {
    return `file:${filePath.replace(/\\/g, '/')}`;
  }

  const absolute = path.resolve(getProjectRoot(), filePath);
  return `file:${absolute.replace(/\\/g, '/')}`;
}
