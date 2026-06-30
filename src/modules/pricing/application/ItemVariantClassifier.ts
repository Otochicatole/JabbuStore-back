import {
  COMMUNITY_PATTERN_LABELS,
  MARKET_INDEPENDENT_DOPPLER_PHASES,
} from "../domain/constants";
import type { NormalizedMarketItem, VariantClassification } from "../domain/types";
import { MarketHashNameNormalizer } from "./MarketHashNameNormalizer";

export class ItemVariantClassifier {
  constructor(private normalizer = new MarketHashNameNormalizer()) {}

  classify(marketHashName: string): VariantClassification {
    const normalized = this.normalizer.parse(marketHashName);
    const independentVariantReasons: string[] = [];
    const metadataOnlyReasons: string[] = [];
    const warnings: string[] = [];

    if (normalized.isStatTrak) {
      independentVariantReasons.push("StatTrak™ — market_hash_name distinto");
    }
    if (normalized.isSouvenir) {
      independentVariantReasons.push("Souvenir — market_hash_name distinto");
    }
    if (normalized.isVanilla) {
      independentVariantReasons.push("Cuchillo Vanilla — item base propio");
    }
    if (normalized.wear) {
      metadataOnlyReasons.push(
        `Desgaste ${normalized.wear} — misma skin, condición/precio distinto`,
      );
    }
    if (normalized.variantName) {
      if (
        (MARKET_INDEPENDENT_DOPPLER_PHASES as readonly string[]).includes(
          normalized.variantName,
        )
      ) {
        independentVariantReasons.push(
          `Fase Doppler/Gamma "${normalized.variantName}" — variant en catálogo YouPin`,
        );
      } else {
        warnings.push(`Fase desconocida en nombre: ${normalized.variantName}`);
      }
    }

    for (const label of COMMUNITY_PATTERN_LABELS) {
      if (marketHashName.includes(label)) {
        normalized.patternType = label;
        normalized.isPatternBased = true;
        metadataOnlyReasons.push(
          `"${label}" — patrón comunitario, no market_hash_name propio`,
        );
      }
    }

    normalized.isIndependentVariant = independentVariantReasons.length > 0;

    if (
      !normalized.isIndependentVariant &&
      !normalized.wear &&
      normalized.itemCategory === "other"
    ) {
      warnings.push("Item no clasificado con confianza — revisar market_hash_name");
    }

    return {
      normalized,
      independentVariantReasons,
      metadataOnlyReasons,
      warnings,
    };
  }
}
