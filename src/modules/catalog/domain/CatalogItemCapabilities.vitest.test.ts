import { describe, expect, it } from "vitest";
import { classifyCatalogItem } from "./CatalogItemCapabilities";

describe("classifyCatalogItem", () => {
  it("marks weapon skin groups as float-stock compatible", () => {
    expect(
      classifyCatalogItem({
        itemgroup: "rifle",
        name: "AK-47 | Redline (Factory New)",
      }),
    ).toEqual({ itemType: "rifle", supportsFloatStock: true, priceFilterEligible: true });

    expect(
      classifyCatalogItem({
        itemgroup: "knife",
        name: "★ Karambit | Doppler (Factory New)",
      }),
    ).toEqual({ itemType: "knife", supportsFloatStock: true, priceFilterEligible: true });

    expect(
      classifyCatalogItem({
        itemgroup: "equipment",
        itemtype: "Zeus X27",
        name: "Zeus X27 | Olympus (Factory New)",
      }),
    ).toEqual({ itemType: "equipment", supportsFloatStock: true, priceFilterEligible: true });
  });

  it.each([
    ["sticker", "sticker"],
    ["container", "container"],
    ["charm", "charm"],
    ["agent", "agent"],
    ["music kit", "music_kit"],
  ])("does not expose float stock for %s", (itemgroup, itemType) => {
    expect(classifyCatalogItem({ itemgroup })).toEqual({
      itemType,
      supportsFloatStock: false,
      priceFilterEligible: false,
    });
  });

  it("fails closed for unknown item types", () => {
    expect(
      classifyCatalogItem({
        itemgroup: "unknown",
        name: "Unrecognized Catalog Item",
      }),
    ).toEqual({ itemType: "other", supportsFloatStock: false, priceFilterEligible: false });
  });
});
