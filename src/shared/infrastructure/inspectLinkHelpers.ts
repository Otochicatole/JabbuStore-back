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

const CS2_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function computeMaskedInspectChecksum(protoBytes: Uint8Array): number {
  let crc = 0xffffffff;
  crc = CS2_CRC32_TABLE[(crc ^ 0) & 0xff]! ^ (crc >>> 8);
  for (let i = 0; i < protoBytes.length; i += 1) {
    crc = CS2_CRC32_TABLE[(crc ^ protoBytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  crc = (0xffffffff ^ crc) >>> 0;
  const mul = Math.imul(protoBytes.length, crc) >>> 0;
  return ((0xffff & crc) ^ mul) >>> 0;
}

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = Math.max(0, Math.floor(value));
  do {
    const byte = v % 128;
    v = Math.floor(v / 128);
    out.push(v > 0 ? byte | 0x80 : byte);
  } while (v > 0);
  return out;
}

/**
 * Generates a self-contained CS2 inspect link without stickers or charms
 * from canonical item indices (`defIndex`, `paintIndex`, `floatValue`).
 */
export function buildMaskedInspectLinkFromParams(input: {
  defIndex: number;
  paintIndex: number;
  floatValue: number;
  paintSeed?: number;
  rarity?: number;
  isStatTrak?: boolean;
  isSouvenir?: boolean;
}): string | null {
  if (
    !Number.isSafeInteger(input.defIndex) ||
    input.defIndex < 1 ||
    !Number.isSafeInteger(input.paintIndex) ||
    input.paintIndex < 0 ||
    !Number.isFinite(input.floatValue)
  ) {
    return null;
  }

  const clampedFloat = Math.min(1, Math.max(0, input.floatValue));
  const floatView = new DataView(new ArrayBuffer(4));
  floatView.setFloat32(0, clampedFloat, false);
  const paintWearBits = floatView.getUint32(0, false);

  const isUnusualStar = input.defIndex >= 500;
  const rarity = Number.isSafeInteger(input.rarity)
    ? input.rarity!
    : isUnusualStar
      ? 6
      : 5;
  const isSouvenir = Boolean(input.isSouvenir);
  const isStatTrak = Boolean(input.isStatTrak) && !isSouvenir;
  const quality = isSouvenir
    ? 12
    : isUnusualStar
      ? 3
      : isStatTrak
        ? 9
        : 4;
  const paintSeed =
    Number.isSafeInteger(input.paintSeed) && input.paintSeed! >= 0 && input.paintSeed! <= 1000
      ? input.paintSeed!
      : ((input.defIndex * 31 + input.paintIndex * 17) % 999) + 1;

  const protoBytes = new Uint8Array([
    ...encodeVarint((3 << 3) | 0),
    ...encodeVarint(input.defIndex),
    ...encodeVarint((4 << 3) | 0),
    ...encodeVarint(input.paintIndex),
    ...encodeVarint((5 << 3) | 0),
    ...encodeVarint(rarity),
    ...encodeVarint((6 << 3) | 0),
    ...encodeVarint(quality),
    ...encodeVarint((7 << 3) | 0),
    ...encodeVarint(paintWearBits),
    ...encodeVarint((8 << 3) | 0),
    ...encodeVarint(paintSeed),
    ...(isStatTrak
      ? [
          ...encodeVarint((9 << 3) | 0),
          ...encodeVarint(0),
          ...encodeVarint((10 << 3) | 0),
          ...encodeVarint(0),
        ]
      : []),
  ]);

  const checksum = computeMaskedInspectChecksum(protoBytes);
  const fullBytes = new Uint8Array(1 + protoBytes.length + 4);
  fullBytes[0] = 0;
  fullBytes.set(protoBytes, 1);
  fullBytes[1 + protoBytes.length] = (checksum >>> 24) & 0xff;
  fullBytes[2 + protoBytes.length] = (checksum >>> 16) & 0xff;
  fullBytes[3 + protoBytes.length] = (checksum >>> 8) & 0xff;
  fullBytes[4 + protoBytes.length] = checksum & 0xff;

  const hex = Array.from(fullBytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return `steam://run/730//+csgo_econ_action_preview%20${hex}`;
}
