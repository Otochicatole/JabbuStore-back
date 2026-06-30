/**
 * Formato certificate de CS2 (único que muestra float/seed in-game).
 * Docs SteamWebAPI: steam://run/730//+csgo_econ_action_preview%20{CERTIFICATE_HEX}
 */
export function buildInspectLinkFromCertificateHex(
  certificate: string,
): string | null {
  const cert = certificate.trim();
  if (!cert || cert.length < 30) return null;
  if (cert.includes("%")) return null;
  return `steam://run/730//+csgo_econ_action_preview%20${cert}`;
}

/** @deprecated Legacy rungame/S/M — no funciona en CS2 para inspección in-game. */
const LEGACY_INSPECT_PREFIX =
  "steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20";

/**
 * Construye enlace desde certificate de float/assets (mercado YouPin).
 * Certificados largos (hex) usan formato CS2; valores cortos mantienen legacy por compatibilidad.
 */
export function buildInspectLinkFromCertificate(
  certificate: string,
  asset?: {
    marketid?: string | number | null;
    assetid?: string | number | null;
    steamid?: string | number | null;
  },
): string | null {
  const cert = certificate?.trim();
  if (!cert) return null;

  const hexLink = buildInspectLinkFromCertificateHex(cert);
  if (hexLink) return hexLink;

  if (asset?.marketid && asset?.assetid) {
    return `${LEGACY_INSPECT_PREFIX}M${asset.marketid}A${asset.assetid}D${cert}`;
  }

  if (asset?.steamid && asset?.assetid) {
    return `${LEGACY_INSPECT_PREFIX}S${asset.steamid}A${asset.assetid}D${cert}`;
  }

  return null;
}

/** Devuelve true si el link tiene placeholders sin resolver (no abre el item in-game). */
export function isValidInspectLink(link: string | null | undefined): boolean {
  if (!link?.trim()) return false;
  return !/%[a-z0-9_:]+%/i.test(link);
}

/**
 * Normaliza un inspectlink de SteamWebAPI inventory (ya resuelto) para uso in-game.
 */
export function normalizeSteamWebApiInspectLink(
  link: string | null | undefined,
): string | null {
  if (!link?.trim() || !isValidInspectLink(link)) return null;
  return link.trim();
}
