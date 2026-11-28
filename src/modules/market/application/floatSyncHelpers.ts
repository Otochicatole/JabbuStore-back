import { normalizeDopplerPhaseLabel } from "../../pricing/domain/DopplerPhase";

const API_PHASE_PARAM: Record<string, string> = {
  "phase 1": "p1",
  "phase 2": "p2",
  "phase 3": "p3",
  "phase 4": "p4",
  ruby: "ruby",
  sapphire: "sapphire",
  "black pearl": "black-pearl",
  emerald: "emerald",
};

export function normalizePhaseName(
  phase: string | null | undefined,
): string | null {
  if (!phase) return null;
  const canonical = normalizeDopplerPhaseLabel(phase);
  if (canonical) return canonical.toLowerCase();
  const key = phase.trim().toLowerCase().replace(/-/g, " ");
  return key || null;
}

export function phasesMatch(
  expected: string | null,
  actual: string | null | undefined,
): boolean {
  if (!expected) return true;
  // Si la API ya filtró por phase=, muchos assets no traen el campo phase
  if (!actual) return true;
  const a = normalizePhaseName(actual);
  const b = normalizePhaseName(expected);
  return !!a && !!b && a === b;
}

const WEAR_SUFFIX =
  /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred|FN|MW|FT|WW|BS|Recién fabricado|Casi nuevo|Algo desgastado|Bastante desgastado|Deplorable)\)\s*$/i;

export function stripWearFromMarketHashName(name: string): string {
  return name.replace(WEAR_SUFFIX, "").trim();
}

export function buildFloatSyncQueryNames(
  marketHashName: string,
  baseName: string,
  phase: string | null,
): string[] {
  const names = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value?.trim()) names.add(value.trim());
  };

  add(marketHashName);
  add(stripWearFromMarketHashName(marketHashName));
  add(baseName);
  add(stripWearFromMarketHashName(baseName));

  if (phase) {
    add(`${baseName} | ${phase}`);
    add(`${stripWearFromMarketHashName(baseName)} | ${phase}`);
    add(`${baseName} (${phase})`);
  }

  return Array.from(names);
}

const STANDARD_DOPPLER_PAINT_INDEX: Partial<Record<string, number>> = {
  Ruby: 415,
  Sapphire: 416,
  "Black Pearl": 417,
  "Phase 1": 418,
  "Phase 2": 419,
  "Phase 3": 420,
  "Phase 4": 421,
};

/** Butterfly Knife & Shadow Daggers (Spectrum Doppler) use 617/618/619 for Black Pearl / Phase 2 / Sapphire. */
const SPECTRUM_DOPPLER_PAINT_INDEX: Partial<Record<string, number>> = {
  Ruby: 415,
  Sapphire: 619,
  "Black Pearl": 617,
  "Phase 1": 418,
  "Phase 2": 618,
  "Phase 3": 420,
  "Phase 4": 421,
};

/** Talon Knife (Horizon/Prisma Doppler) uses 852..855 for Phase 1..4 and 415..417 for gems. */
const TALON_DOPPLER_PAINT_INDEX: Partial<Record<string, number>> = {
  Ruby: 415,
  Sapphire: 416,
  "Black Pearl": 417,
  "Phase 1": 852,
  "Phase 2": 853,
  "Phase 3": 854,
  "Phase 4": 855,
};

const KNIFE_GAMMA_DOPPLER_PAINT_INDEX: Partial<Record<string, number>> = {
  Emerald: 568,
  "Phase 1": 569,
  "Phase 2": 570,
  "Phase 3": 571,
  "Phase 4": 572,
};

const GLOCK_GAMMA_DOPPLER_PAINT_INDEX: Partial<Record<string, number>> = {
  Emerald: 1119,
  "Phase 1": 1120,
  "Phase 2": 1121,
  "Phase 3": 1122,
  "Phase 4": 1123,
};

/** def_index de cuchillos CS2 (weapon definition index). */
const KNIFE_DEF_INDEX: Array<{ match: string; defIndex: number }> = [
  { match: "karambit", defIndex: 507 },
  { match: "m9 bayonet", defIndex: 508 },
  { match: "bayonet", defIndex: 500 },
  { match: "butterfly", defIndex: 515 },
  { match: "flip knife", defIndex: 505 },
  { match: "gut knife", defIndex: 506 },
  { match: "falchion", defIndex: 512 },
  { match: "bowie", defIndex: 514 },
  { match: "huntsman", defIndex: 509 },
  { match: "shadow daggers", defIndex: 516 },
  { match: "ursus", defIndex: 519 },
  { match: "navaja", defIndex: 520 },
  { match: "stiletto", defIndex: 522 },
  { match: "talon", defIndex: 523 },
  { match: "classic knife", defIndex: 503 },
  { match: "paracord", defIndex: 517 },
  { match: "survival", defIndex: 518 },
  { match: "nomad", defIndex: 521 },
  { match: "skeleton", defIndex: 525 },
  { match: "kukri", defIndex: 526 },
];

/**
 * paint_index exacto de la fase Doppler/Gamma según items-catalog.json de CS2 / SteamWebAPI.
 * Distingue variantes específicas por familia de cuchillo (Butterfly, Shadow Daggers, Talon, Gamma, Glock-18).
 */
export function resolvePaintIndexForPhase(
  phase: string,
  baseName: string,
): number | null {
  const canonicalPhase = normalizeDopplerPhaseLabel(phase) ?? phase.trim();
  if (!canonicalPhase) return null;

  const lower = baseName.toLowerCase();
  if (lower.includes("glock-18")) {
    return GLOCK_GAMMA_DOPPLER_PAINT_INDEX[canonicalPhase] ?? null;
  }
  if (lower.includes("gamma doppler") || canonicalPhase === "Emerald") {
    return KNIFE_GAMMA_DOPPLER_PAINT_INDEX[canonicalPhase] ?? null;
  }
  if (lower.includes("butterfly") || lower.includes("shadow daggers")) {
    return SPECTRUM_DOPPLER_PAINT_INDEX[canonicalPhase] ?? null;
  }
  if (lower.includes("talon")) {
    return TALON_DOPPLER_PAINT_INDEX[canonicalPhase] ?? null;
  }
  return STANDARD_DOPPLER_PAINT_INDEX[canonicalPhase] ?? null;
}

export function resolveDefIndexFromBaseName(baseName: string): number | null {
  const lower = baseName.toLowerCase();
  for (const { match, defIndex } of KNIFE_DEF_INDEX) {
    if (lower.includes(match)) return defIndex;
  }
  return null;
}

export function isStatTrakName(name: string): boolean {
  return /stattrak/i.test(name);
}

export function isSouvenirName(name: string): boolean {
  return /souvenir/i.test(name);
}

/** Normaliza un market hash name para comparar cuchillo+skin (sin desgaste). */
export function normalizeNameForMatch(name: string): string {
  return stripWearFromMarketHashName(name).replace(/\s+/g, " ").trim().toLowerCase();
}

export function assetMatchesListingBase(
  assetMarkethashname: string,
  baseName: string,
): boolean {
  return (
    normalizeNameForMatch(assetMarkethashname) === normalizeNameForMatch(baseName)
  );
}

export function toSteamWebApiPhaseParam(
  phase: string | null,
): string | null {
  if (!phase) return null;
  const normalized = normalizePhaseName(phase);
  if (!normalized) return null;
  return API_PHASE_PARAM[normalized] ?? null;
}

export function extractWearCode(fullName: string): string | null {
  const lower = fullName.toLowerCase();
  if (
    lower.includes("factory new") ||
    lower.includes("(fn)") ||
    lower.includes("recién fabricado")
  ) {
    return "fn";
  }
  if (
    lower.includes("minimal wear") ||
    lower.includes("(mw)") ||
    lower.includes("casi nuevo")
  ) {
    return "mw";
  }
  if (
    lower.includes("field-tested") ||
    lower.includes("(ft)") ||
    lower.includes("algo desgastado")
  ) {
    return "ft";
  }
  if (
    lower.includes("well-worn") ||
    lower.includes("(ww)") ||
    lower.includes("bastante desgastado")
  ) {
    return "ww";
  }
  if (
    lower.includes("battle-scarred") ||
    lower.includes("(bs)") ||
    lower.includes("deplorable")
  ) {
    return "bs";
  }
  return null;
}

export function encodeMarketHashName(name: string): string {
  return encodeURIComponent(name).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

export function resolveAssetPrice(asset: any): number {
  let price = Number(asset.price);
  if (price > 0) return price;

  if (asset.metadata?.min_price) {
    price = Number(asset.metadata.min_price);
    if (price > 0) return price;
  }

  if (asset.metadata?.price_cents) {
    price = Number(asset.metadata.price_cents) / 100;
    if (price > 0) return price;
  }

  if (asset.metadata?.pricecny) {
    // SteamWebAPI suele incluir price en USD; pricecny solo como último recurso no convertible aquí
    return 0;
  }

  return 0;
}
