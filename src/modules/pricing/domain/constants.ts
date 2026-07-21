/** Desgastes — condiciones de la misma skin, no variantes independientes. */
export const WEAR_CONDITIONS = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
] as const;

/**
 * Fases Doppler/Gamma que SteamWebAPI expone en `variants` del catálogo YouPin.
 * Fuente: respuesta real de /market/youpin/prices + paint index Valve.
 */
export const MARKET_INDEPENDENT_DOPPLER_PHASES = [
  "Phase 1",
  "Phase 2",
  "Phase 3",
  "Phase 4",
  "Ruby",
  "Sapphire",
  "Black Pearl",
  "Emerald",
] as const;

/**
 * Patrones comunitarios — metadata útil, NO market_hash_name propio en Steam.
 * No deben crear items/variantes independientes en el catálogo interno.
 */
export const COMMUNITY_PATTERN_LABELS = [
  "Blue Gem",
  "Gold Gem",
  "Fire & Ice",
  "Max Fire & Ice",
  "Fake Fire & Ice",
  "Fade 80%",
  "Fade 85%",
  "Fade 90%",
  "Fade 95%",
  "Fade 99%",
  "Fade 100%",
  "Tier 1",
  "Tier 2",
  "Tier 3",
  "Tier 4",
  "Angel",
  "Diamond",
  "Heart",
  "Phoenix",
  "Zebra",
  "Center Web",
  "Triple Web",
] as const;

export const WEAPON_NAMES = [
  "AK-47",
  "M4A4",
  "M4A1-S",
  "AWP",
  "Desert Eagle",
  "USP-S",
  "Glock-18",
  "P250",
  "Five-SeveN",
  "Tec-9",
  "CZ75-Auto",
  "Dual Berettas",
  "R8 Revolver",
  "Galil AR",
  "FAMAS",
  "AUG",
  "SG 553",
  "SSG 08",
  "SCAR-20",
  "G3SG1",
  "MAC-10",
  "MP9",
  "MP7",
  "MP5-SD",
  "UMP-45",
  "P90",
  "PP-Bizon",
  "Nova",
  "XM1014",
  "MAG-7",
  "Sawed-Off",
  "Negev",
  "M249",
] as const;

export const KNIFE_NAMES = [
  "Bayonet",
  "M9 Bayonet",
  "Karambit",
  "Butterfly Knife",
  "Flip Knife",
  "Gut Knife",
  "Huntsman Knife",
  "Falchion Knife",
  "Bowie Knife",
  "Shadow Daggers",
  "Navaja Knife",
  "Stiletto Knife",
  "Talon Knife",
  "Ursus Knife",
  "Classic Knife",
  "Paracord Knife",
  "Survival Knife",
  "Nomad Knife",
  "Skeleton Knife",
  "Kukri Knife",
] as const;

export const GLOVE_NAMES = [
  "Sport Gloves",
  "Specialist Gloves",
  "Driver Gloves",
  "Hand Wraps",
  "Moto Gloves",
  "Bloodhound Gloves",
  "Hydra Gloves",
  "Broken Fang Gloves",
] as const;

export const DOPPLER_PHASE_DISPLAY: Record<string, string> = {
  phase1: "Phase 1",
  phase2: "Phase 2",
  phase3: "Phase 3",
  phase4: "Phase 4",
  ruby: "Ruby",
  sapphire: "Sapphire",
  blackpearl: "Black Pearl",
  emerald: "Emerald",
};

export const PAINT_INDEX_TO_PHASE: Record<number, string> = {
  418: "phase1",
  419: "phase2",
  420: "phase3",
  421: "phase4",
  415: "ruby",
  416: "sapphire",
  417: "blackpearl",
  618: "phase2",
  619: "sapphire",
  617: "blackpearl",
  852: "phase1",
  853: "phase2",
  854: "phase3",
  855: "phase4",
  849: "ruby",
  850: "sapphire",
  851: "blackpearl",
  569: "phase1",
  570: "phase2",
  571: "phase3",
  572: "phase4",
  568: "emerald",
  1120: "phase1",
  1121: "phase2",
  1122: "phase3",
  1123: "phase4",
  1119: "emerald",
};
