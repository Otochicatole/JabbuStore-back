import {
  DOPPLER_PHASE_DISPLAY,
  PAINT_INDEX_TO_PHASE,
} from "./constants";

export type DopplerPhaseLabel =
  | "Phase 1"
  | "Phase 2"
  | "Phase 3"
  | "Phase 4"
  | "Ruby"
  | "Sapphire"
  | "Black Pearl"
  | "Emerald";

const WEAR_SUFFIX =
  /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred|FN|MW|FT|WW|BS|Recién fabricado|Casi nuevo|Algo desgastado|Bastante desgastado|Deplorable)\)\s*$/i;

const PHASE_BY_ALIAS: Record<string, DopplerPhaseLabel> = {
  "1": "Phase 1",
  p1: "Phase 1",
  phase1: "Phase 1",
  "2": "Phase 2",
  p2: "Phase 2",
  phase2: "Phase 2",
  "3": "Phase 3",
  p3: "Phase 3",
  phase3: "Phase 3",
  "4": "Phase 4",
  p4: "Phase 4",
  phase4: "Phase 4",
  ruby: "Ruby",
  sapphire: "Sapphire",
  blackpearl: "Black Pearl",
  blackperl: "Black Pearl",
  emerald: "Emerald",
};

export function normalizeDopplerPhaseLabel(
  value: string | null | undefined,
): DopplerPhaseLabel | null {
  if (!value) return null;

  const compact = value
    .replace(WEAR_SUFFIX, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, "")
    .replace(/^doppler/, "");

  return PHASE_BY_ALIAS[compact] ?? null;
}

export function getDopplerPhaseLabelByPaintIndex(
  paintIndex: number | null | undefined,
): DopplerPhaseLabel | null {
  if (paintIndex == null || !Number.isFinite(paintIndex)) return null;
  const phaseKey = PAINT_INDEX_TO_PHASE[paintIndex];
  const display = phaseKey ? DOPPLER_PHASE_DISPLAY[phaseKey] : null;
  return normalizeDopplerPhaseLabel(display);
}
