import {
  DOPPLER_PHASE_DISPLAY,
  GLOVE_NAMES,
  KNIFE_NAMES,
  MARKET_INDEPENDENT_DOPPLER_PHASES,
  PAINT_INDEX_TO_PHASE,
  WEAR_CONDITIONS,
  WEAPON_NAMES,
} from "../domain/constants";
import type { NormalizedMarketItem, WearCondition } from "../domain/types";

const WEAR_SUFFIX =
  /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i;

export interface DopplerDetectionInput {
  marketHashName: string;
  iconUrl?: string | null | undefined;
  paintIndex?: number | null | undefined;
}

export class MarketHashNameNormalizer {
  parse(marketHashName: string): NormalizedMarketItem {
    const trimmed = marketHashName?.trim() ?? "";
    const wear = this.extractWear(trimmed);
    const withoutWear = this.stripWear(trimmed);
    const isStatTrak = /stattrak/i.test(withoutWear);
    const isSouvenir = /^souvenir\s/i.test(withoutWear);
    const { baseName, phase } = this.splitDopplerPhase(withoutWear);
    const itemCategory = this.detectCategory(baseName);
    const weaponName = this.detectWeaponName(baseName, itemCategory);
    const isVanilla = this.isVanillaKnife(baseName, itemCategory);
    const { skinName, finishName } = this.extractSkinAndFinish(
      baseName,
      itemCategory,
      isVanilla,
    );

    return {
      marketHashName: trimmed,
      itemCategory,
      weaponName,
      skinName,
      finishName,
      variantName: phase,
      wear,
      isStatTrak,
      isSouvenir,
      isVanilla,
      patternType: null,
      isPatternBased: false,
      isIndependentVariant: false,
    };
  }

  stripWear(name: string): string {
    return name.replace(WEAR_SUFFIX, "").trim();
  }

  extractWear(name: string): WearCondition | null {
    const match = name.match(WEAR_SUFFIX);
    if (!match?.[1]) return null;
    const raw = match[1];
    const found = WEAR_CONDITIONS.find(
      (w) => w.toLowerCase() === raw.toLowerCase(),
    );
    return found ?? null;
  }

  splitDopplerPhase(fullName: string): { baseName: string; phase: string | null } {
    if (!fullName) return { baseName: "", phase: null };
    const parts = fullName.split(" | ");
    if (parts.length < 2) return { baseName: fullName, phase: null };

    const lastPart = parts[parts.length - 1]!.trim();
    if (
      (MARKET_INDEPENDENT_DOPPLER_PHASES as readonly string[]).includes(lastPart)
    ) {
      return {
        baseName: parts.slice(0, -1).join(" | "),
        phase: lastPart,
      };
    }
    return { baseName: fullName, phase: null };
  }

  buildPricingMarketHashName(input: DopplerDetectionInput): string {
    let name = input.marketHashName?.trim() ?? "";
    if (!name || !name.includes("Doppler")) return name;

    const { phase: existingPhase } = this.splitDopplerPhase(name);
    if (existingPhase) return name;

    const detected = this.detectDopplerPhase(input);
    if (!detected) return name;

    const phaseLabel = DOPPLER_PHASE_DISPLAY[detected];
    if (!phaseLabel || name.includes(phaseLabel)) return name;
    return `${name} | ${phaseLabel}`;
  }

  detectDopplerPhase(input: DopplerDetectionInput): string | null {
    const { marketHashName, iconUrl, paintIndex } = input;
    if (!marketHashName?.includes("Doppler")) return null;

    if (paintIndex != null && paintIndex in PAINT_INDEX_TO_PHASE) {
      return PAINT_INDEX_TO_PHASE[paintIndex] ?? null;
    }

    const iconHash = iconUrl?.includes("economy/image/")
      ? iconUrl.split("economy/image/")[1] ?? null
      : iconUrl ?? null;

    if (iconHash?.startsWith("-9a8")) {
      try {
        const dopplerPhaseDetector = require("csgo-doppler-phase");
        const detected = dopplerPhaseDetector.detect(marketHashName, iconHash);
        if (
          detected &&
          typeof detected === "string" &&
          !detected.startsWith("Something wrong")
        ) {
          return detected;
        }
      } catch {
        // librería opcional
      }
    }
    return null;
  }

  baseTemplateKey(normalized: NormalizedMarketItem): string {
    const { baseName } = this.splitDopplerPhase(
      this.stripWear(normalized.marketHashName),
    );
    return baseName;
  }

  private detectCategory(name: string): NormalizedMarketItem["itemCategory"] {
    const lower = name.toLowerCase();
    if (
      name.startsWith("★") ||
      KNIFE_NAMES.some((k) => lower.includes(k.toLowerCase()))
    ) {
      return "knife";
    }
    if (GLOVE_NAMES.some((g) => lower.includes(g.toLowerCase()))) {
      return "glove";
    }
    if (WEAPON_NAMES.some((w) => lower.includes(w.toLowerCase()))) {
      return "weapon";
    }
    return "other";
  }

  private detectWeaponName(
    name: string,
    category: NormalizedMarketItem["itemCategory"],
  ): string | null {
    const pool =
      category === "knife"
        ? KNIFE_NAMES
        : category === "glove"
          ? GLOVE_NAMES
          : category === "weapon"
            ? WEAPON_NAMES
            : [];
    const lower = name.toLowerCase();
    const sorted = [...pool].sort((a, b) => b.length - a.length);
    for (const candidate of sorted) {
      if (lower.includes(candidate.toLowerCase())) return candidate;
    }
    return null;
  }

  private isVanillaKnife(
    name: string,
    category: NormalizedMarketItem["itemCategory"],
  ): boolean {
    if (category !== "knife") return false;
    const stripped = name.replace(/^★\s*/, "").replace(/^StatTrak™\s+/i, "").trim();
    return KNIFE_NAMES.some((k) => stripped === k || stripped === `★ ${k}`);
  }

  private extractSkinAndFinish(
    name: string,
    category: NormalizedMarketItem["itemCategory"],
    isVanilla: boolean,
  ): { skinName: string | null; finishName: string | null } {
    if (isVanilla) return { skinName: null, finishName: "Vanilla" };
    if (category === "other") return { skinName: name, finishName: null };

    const parts = name
      .replace(/^★\s*/, "")
      .replace(/^StatTrak™\s+/i, "")
      .replace(/^Souvenir\s+/i, "")
      .split(" | ")
      .map((p) => p.trim());

    if (parts.length >= 2) {
      return { skinName: parts[1] ?? null, finishName: parts[1] ?? null };
    }
    return { skinName: parts[0] ?? null, finishName: null };
  }
}
