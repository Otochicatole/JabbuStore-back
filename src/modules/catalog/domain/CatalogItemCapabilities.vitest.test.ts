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

  it("classifies Steam inventory types accurately", () => {
    // Agents
    expect(
      classifyCatalogItem({
        itemgroup: "Exceptional Agent",
        category: "other",
        name: "Getaway Sally | The Professionals",
      }),
    ).toEqual({ itemType: "agent", supportsFloatStock: false, priceFilterEligible: false });

    expect(
      classifyCatalogItem({
        itemgroup: "Master Agent",
        category: "other",
        name: "Sir Bloody Loudmouth Darryl | The Professionals",
      }),
    ).toEqual({ itemType: "agent", supportsFloatStock: false, priceFilterEligible: false });

    expect(
      classifyCatalogItem({
        itemgroup: "Distinguished Agent",
        category: "other",
        name: "D Squadron Officer | NZSAS",
      }),
    ).toEqual({ itemType: "agent", supportsFloatStock: false, priceFilterEligible: false });

    // Gloves with Agent in finish name should remain gloves
    expect(
      classifyCatalogItem({
        itemgroup: "★ Extraordinary Gloves",
        category: "gloves",
        name: "★ Specialist Gloves | Field Agent (Well-Worn)",
      }),
    ).toEqual({ itemType: "gloves", supportsFloatStock: true, priceFilterEligible: false });

    // Charms
    expect(
      classifyCatalogItem({
        itemgroup: "Customized Remarkable Charm",
        category: "other",
        name: "Charm | Die-cast AK",
      }),
    ).toEqual({ itemType: "charm", supportsFloatStock: false, priceFilterEligible: false });

    // Containers
    expect(
      classifyCatalogItem({
        itemgroup: "Base Grade Container",
        category: "other",
        name: "Dreams & Nightmares Case",
      }),
    ).toEqual({ itemType: "container", supportsFloatStock: false, priceFilterEligible: false });

    // Shotguns with heavy category
    expect(
      classifyCatalogItem({
        itemgroup: "Consumer Grade Shotgun",
        category: "heavy",
        name: "Nova | Predator (Field-Tested)",
      }),
    ).toEqual({ itemType: "shotgun", supportsFloatStock: true, priceFilterEligible: true });

    // Sniper rifles with rifle category
    expect(
      classifyCatalogItem({
        itemgroup: "Restricted Sniper Rifle",
        category: "rifle",
        name: "AWP | Atheris (Field-Tested)",
      }),
    ).toEqual({ itemType: "sniper_rifle", supportsFloatStock: true, priceFilterEligible: true });

    // Machineguns
    expect(
      classifyCatalogItem({
        itemgroup: "Consumer Grade Machinegun",
        category: "other",
        name: "Negev | Army Sheen (Factory New)",
      }),
    ).toEqual({ itemType: "machinegun", supportsFloatStock: true, priceFilterEligible: true });

    // Graffiti
    expect(
      classifyCatalogItem({
        itemgroup: "Base Grade Graffiti",
        category: "other",
        name: "Sealed Graffiti | Jump Throw (Blood Red)",
      }),
    ).toEqual({ itemType: "graffiti", supportsFloatStock: false, priceFilterEligible: false });

    // Passes
    expect(
      classifyCatalogItem({
        itemgroup: "Base Grade Pass",
        category: "other",
        name: "Operation Riptide Pass",
      }),
    ).toEqual({ itemType: "pass", supportsFloatStock: false, priceFilterEligible: false });

    // Equipment
    expect(
      classifyCatalogItem({
        itemgroup: "Classified Equipment",
        category: "other",
        name: "Zeus x27 | Olympus (Field-Tested)",
      }),
    ).toEqual({ itemType: "equipment", supportsFloatStock: true, priceFilterEligible: true });
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
