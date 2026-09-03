import { describe, expect, it } from "vitest";
import { createCatalogSearch, createCatalogSearchDocument } from "./CatalogSearch";

const redline = createCatalogSearchDocument({
  fullName: "StatTrak™ AK-47 | Redline (Field-Tested)",
  weapon: "StatTrak™ AK-47",
  name: "Redline",
  exterior: "Field-Tested",
});

const doppler = createCatalogSearchDocument({
  fullName: "M4A1-S | Doppler (Factory New)",
  weapon: "M4A1-S",
  name: "Doppler",
  exterior: "Factory New",
  phase: "Phase 2",
});

describe("catalog text search", () => {
  it.each([
    "ak47 redline",
    "REDLINE AK47",
    "  ak_47 \\ redline  ",
    "ak 47 | redline (field_tested)",
    "ak redl",
    "StatTrak™ AK-47 | Redline (Field-Tested)",
    "stattrak fieldtested redline",
  ])("finds the item with text, fragments and separators: %s", (query) => {
    expect(createCatalogSearch(query).matches(redline)).toBe(true);
  });

  it("requires every search term even when terms are in a different order", () => {
    expect(createCatalogSearch("redline awp").matches(redline, true)).toBe(false);
    expect(createCatalogSearch("redline ak47").matches(redline)).toBe(true);
  });

  it("removes compatibility symbols before they can become searchable letters", () => {
    expect(createCatalogSearch("statrrak ak47").matches(redline, true)).toBe(true);
    expect(createCatalogSearch("tm").matches(redline)).toBe(false);
  });

  it.each([
    ["Negev | Mjölnir", "mjolnir negev"],
    ["Music Kit | Ghost, Skeletá", "skeleta ghost"],
    ["MAC-10 | Saibā Oni", "saiba oni"],
    ["M4A4 | 龍王 (Dragon King)", "龍王 dragon"],
  ])("supports accents and Unicode in %s", (fullName, query) => {
    const item = createCatalogSearchDocument({ fullName, weapon: "", name: "" });
    expect(createCatalogSearch(query).matches(item)).toBe(true);
  });

  it("searches the original name beyond the second pipe", () => {
    const sticker = createCatalogSearchDocument({
      fullName: "Sticker | GuardiaN (Gold) | London 2018",
      weapon: "Sticker",
      name: "GuardiaN (Gold)",
    });
    expect(createCatalogSearch("guardian gold london 2018").matches(sticker)).toBe(true);
    expect(createCatalogSearch("london2018").matches(sticker)).toBe(true);
    expect(createCatalogSearch("london 201").matches(sticker, true)).toBe(false);
  });

  it.each([undefined, "", " \t\n ", "() | -_\\ ★ ™"])(
    "treats empty or symbol-only input as no search: %s",
    (query) => {
      const search = createCatalogSearch(query);
      expect(search.isEmpty).toBe(true);
      expect(search.canUseFuzzy).toBe(false);
      expect(search.matches(redline)).toBe(true);
    },
  );
});

describe("catalog compact names and numeric terms", () => {
  it.each([
    ["USP-S | Neo-Noir", "usps neo noir"],
    ["M4A1-S | Printstream", "m4a1s printstream"],
    ["Music Kit | M.U.D.D. FORCE", "mudd force"],
  ])("finds compact weapon and finish names: %s", (fullName, query) => {
    const item = createCatalogSearchDocument({ fullName, weapon: "", name: "" });
    expect(createCatalogSearch(query).matches(item)).toBe(true);
  });

  it("supports compact wear and phase fields", () => {
    expect(createCatalogSearch("m4a1s factorynew phase2").matches(doppler)).toBe(true);
    const blackPearl = createCatalogSearchDocument({
      fullName: "★ Karambit | Doppler (Factory New)",
      weapon: "★ Karambit",
      name: "Doppler",
      phase: "Black Pearl",
    });
    expect(createCatalogSearch("blackpearl karambit").matches(blackPearl)).toBe(true);
  });

  it.each(["m4a1sdoppler", "plerfactory", "newphase", "dopplerphase"])(
    "does not create matches by joining independent fields: %s",
    (query) => {
      expect(createCatalogSearch(query).matches(doppler, true)).toBe(false);
    },
  );

  it("matches numeric terms as whole tokens instead of digits in weapon codes", () => {
    expect(createCatalogSearch("doppler phase 2").matches(doppler)).toBe(true);
    expect(createCatalogSearch("doppler phase 1").matches(doppler, true)).toBe(false);
    expect(createCatalogSearch("4").matches(doppler, true)).toBe(false);
    expect(createCatalogSearch("47").matches(redline)).toBe(true);
    expect(createCatalogSearch("7").matches(redline, true)).toBe(false);
  });

  it("does not confuse a phase number with the prefix of another number", () => {
    const phase21 = createCatalogSearchDocument({
      fullName: "Example | Finish",
      weapon: "Example",
      name: "Finish",
      phase: "Phase 21",
    });
    expect(createCatalogSearch("phase 2").matches(phase21, true)).toBe(false);
  });
});

describe("catalog typo matching", () => {
  it.each(["redlien", "redlne", "redliine", "redlone"])(
    "accepts one edit or adjacent transposition only when enabled: %s",
    (word) => {
      const search = createCatalogSearch(`ak47 ${word}`);
      expect(search.canUseFuzzy).toBe(true);
      expect(search.matches(redline)).toBe(false);
      expect(search.matches(redline, true)).toBe(true);
    },
  );

  it.each([
    ["M4A1-S | Printstream", "m4a1s printstrem"],
    ["★ Karambit | Gamma Doppler", "karambti gamma dopler"],
  ])("matches common small mistakes in %s", (fullName, query) => {
    const item = createCatalogSearchDocument({ fullName, weapon: "", name: "" });
    expect(createCatalogSearch(query).matches(item)).toBe(false);
    expect(createCatalogSearch(query).matches(item, true)).toBe(true);
  });

  it("rejects more than one edit and transpositions of nonadjacent letters", () => {
    expect(createCatalogSearch("ak47 redlian").matches(redline, true)).toBe(false);
    expect(createCatalogSearch("ak47 relinde").matches(redline, true)).toBe(false);
  });

  it("never fuzzy-matches short words or alphanumeric weapon codes", () => {
    const awp = createCatalogSearchDocument({
      fullName: "AWP | Fade",
      weapon: "AWP",
      name: "Fade",
    });
    expect(createCatalogSearch("awq").canUseFuzzy).toBe(false);
    expect(createCatalogSearch("awq").matches(awp, true)).toBe(false);
    expect(createCatalogSearch("ak48").canUseFuzzy).toBe(false);
    expect(createCatalogSearch("ak48 redline").matches(redline, true)).toBe(false);
    expect(createCatalogSearch("m4a2s doppler").matches(doppler, true)).toBe(false);
    expect(createCatalogSearch("pahse2").matches(doppler, true)).toBe(false);
  });

  it("allows a four-letter query to have one insertion in a three-letter finish", () => {
    const goo = createCatalogSearchDocument({
      fullName: "MP9 | Goo",
      weapon: "MP9",
      name: "Goo",
    });
    expect(createCatalogSearch("gooo mp9").matches(goo)).toBe(false);
    expect(createCatalogSearch("gooo mp9").matches(goo, true)).toBe(true);
    expect(createCatalogSearch("gop mp9").canUseFuzzy).toBe(false);
    expect(createCatalogSearch("gop mp9").matches(goo, true)).toBe(false);
  });

  it("leaves approximate matches opt-in so the caller can prefer textual results", () => {
    const cash = createCatalogSearchDocument({
      fullName: "Sealed Graffiti | Jump Shot (Cash Green)",
      weapon: "Sealed Graffiti",
      name: "Jump Shot (Cash Green)",
    });
    const search = createCatalogSearch("case");
    expect(search.matches(cash)).toBe(false);
    expect(search.matches(cash, true)).toBe(true);
  });
});
