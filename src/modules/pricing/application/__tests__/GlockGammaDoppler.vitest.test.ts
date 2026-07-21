import { describe, expect, it } from "vitest";
import { resolvePaintIndexForPhase } from "../../../market/application/floatSyncHelpers";
import { PAINT_INDEX_TO_PHASE } from "../../domain/constants";
import { MarketHashNameNormalizer } from "../MarketHashNameNormalizer";

describe("Glock-18 Gamma Doppler phases", () => {
  const expected = [
    [1119, "emerald", "Emerald"],
    [1120, "phase1", "Phase 1"],
    [1121, "phase2", "Phase 2"],
    [1122, "phase3", "Phase 3"],
    [1123, "phase4", "Phase 4"],
  ] as const;

  it("usa los paint indexes presentes en items-catalog.json", () => {
    const normalizer = new MarketHashNameNormalizer();
    for (const [paintIndex, phaseKey, phaseLabel] of expected) {
      expect(PAINT_INDEX_TO_PHASE[paintIndex]).toBe(phaseKey);
      expect(
        normalizer.detectDopplerPhase({
          marketHashName: "Glock-18 | Gamma Doppler (Factory New)",
          paintIndex,
        }),
      ).toBe(phaseKey);
      expect(
        resolvePaintIndexForPhase(
          phaseLabel,
          "Glock-18 | Gamma Doppler (Factory New)",
        ),
      ).toBe(paintIndex);
    }
  });
});
