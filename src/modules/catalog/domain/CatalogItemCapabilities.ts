export type CatalogItemType =
  | "pistol"
  | "knife"
  | "rifle"
  | "smg"
  | "sniper_rifle"
  | "shotgun"
  | "machinegun"
  | "gloves"
  | "equipment"
  | "sticker"
  | "container"
  | "agent"
  | "charm"
  | "graffiti"
  | "patch"
  | "music_kit"
  | "collectible"
  | "pass"
  | "key"
  | "gift"
  | "tool"
  | "tag"
  | "other";

export interface CatalogItemCapabilities {
  itemType: CatalogItemType;
  supportsFloatStock: boolean;
  priceFilterEligible: boolean;
}

export type CatalogItemClassificationInput = {
  itemgroup?: unknown;
  itemtype?: unknown;
  category?: unknown;
  name?: unknown;
};

const FLOAT_CAPABLE_ITEM_TYPES = new Set<CatalogItemType>([
  "pistol",
  "knife",
  "rifle",
  "smg",
  "sniper_rifle",
  "shotgun",
  "machinegun",
  "gloves",
]);

const PRICE_FILTER_ELIGIBLE_ITEM_TYPES = new Set<CatalogItemType>([
  "pistol",
  "knife",
  "rifle",
  "smg",
  "sniper_rifle",
  "shotgun",
  "machinegun",
]);

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

function classifyByName(name: string): CatalogItemType {
  if (!name) return "other";
  if (name.startsWith("★")) {
    return name.includes("glove") || name.includes("hand wrap") ? "gloves" : "knife";
  }

  const weaponPrefixes: Array<[string, CatalogItemType]> = [
    ["ak-47", "rifle"],
    ["m4a4", "rifle"],
    ["m4a1-s", "rifle"],
    ["awp", "sniper_rifle"],
    ["ssg 08", "sniper_rifle"],
    ["sg 553", "rifle"],
    ["aug", "rifle"],
    ["famas", "rifle"],
    ["galil ar", "rifle"],
    ["g3sg1", "sniper_rifle"],
    ["scar-20", "sniper_rifle"],
    ["glock-18", "pistol"],
    ["usp-s", "pistol"],
    ["desert eagle", "pistol"],
    ["p250", "pistol"],
    ["five-seven", "pistol"],
    ["tec-9", "pistol"],
    ["cz75-auto", "pistol"],
    ["dual berettas", "pistol"],
    ["r8 revolver", "pistol"],
    ["p2000", "pistol"],
    ["mp9", "smg"],
    ["mac-10", "smg"],
    ["mp7", "smg"],
    ["mp5-sd", "smg"],
    ["ump-45", "smg"],
    ["p90", "smg"],
    ["pp-bizon", "smg"],
    ["nova", "shotgun"],
    ["xm1014", "shotgun"],
    ["mag-7", "shotgun"],
    ["sawed-off", "shotgun"],
    ["negev", "machinegun"],
    ["m249", "machinegun"],
  ];

  const prefix = weaponPrefixes.find(([weapon]) => name.startsWith(`${weapon} |`));
  return prefix?.[1] ?? "other";
}

export function resolveCatalogItemType(
  input: CatalogItemClassificationInput,
): CatalogItemType {
  const group = normalize(input.itemgroup);
  const type = normalize(input.itemtype);
  const category = normalize(input.category);
  const rawName = normalize(input.name);
  const cleanName = rawName
    .replace(/^★\s*/, "")
    .replace(/^stattrak™\s*/i, "")
    .replace(/^stattrak\s*/i, "")
    .replace(/^souvenir\s*/i, "")
    .trim();

  // 1. Gloves (checked before agents to prevent "Field Agent" gloves matching agent)
  if (
    rawName.startsWith("★") &&
    (rawName.includes("gloves") ||
      rawName.includes("hand wrap") ||
      group.includes("gloves") ||
      type.includes("gloves"))
  ) {
    return "gloves";
  }
  if (
    group.includes("gloves") ||
    group.includes("glove") ||
    type.includes("gloves") ||
    type.includes("glove") ||
    category === "gloves" ||
    category === "glove"
  ) {
    return "gloves";
  }

  // 2. Knives (checked before weapons)
  if (
    rawName.startsWith("★") ||
    group.includes("knife") ||
    type.includes("knife") ||
    type.includes("bayonet") ||
    type.includes("karambit") ||
    type.includes("daggers") ||
    category === "knife" ||
    category === "knives"
  ) {
    return "knife";
  }

  // 3. Equipment / Zeus
  if (
    cleanName.startsWith("zeus x27") ||
    cleanName === "zeus" ||
    group.includes("equipment") ||
    group.includes("zeus") ||
    type.includes("equipment") ||
    type.includes("zeus") ||
    category === "equipment"
  ) {
    return "equipment";
  }

  // 4. Snipers (MUST be checked BEFORE generic rifle)
  if (
    group.includes("sniper rifle") ||
    group.includes("sniper") ||
    type.includes("sniper rifle") ||
    type.includes("sniper") ||
    category === "sniper" ||
    category === "snipers" ||
    category === "sniper rifle"
  ) {
    return "sniper_rifle";
  }
  if (
    ["awp", "ssg 08", "g3sg1", "scar-20"].some(
      (w) => type === w || cleanName.startsWith(`${w} |`) || cleanName === w,
    )
  ) {
    return "sniper_rifle";
  }

  // 5. Shotguns (MUST be checked BEFORE machinegun and generic heavy)
  if (
    group.includes("shotgun") ||
    type.includes("shotgun") ||
    category === "shotgun" ||
    category === "shotguns"
  ) {
    return "shotgun";
  }
  if (
    ["nova", "xm1014", "mag-7", "sawed-off"].some(
      (w) => type === w || cleanName.startsWith(`${w} |`) || cleanName === w,
    )
  ) {
    return "shotgun";
  }

  // 6. Machineguns
  if (
    group.includes("machinegun") ||
    group.includes("machine gun") ||
    group.includes("machine_gun") ||
    type.includes("machinegun") ||
    type.includes("machine gun") ||
    type.includes("machine_gun") ||
    category === "machinegun" ||
    category === "machine_guns" ||
    category === "heavy"
  ) {
    return "machinegun";
  }
  if (
    ["negev", "m249"].some(
      (w) => type === w || cleanName.startsWith(`${w} |`) || cleanName === w,
    )
  ) {
    return "machinegun";
  }

  // 7. Rifles
  if (
    group.includes("rifle") ||
    type.includes("rifle") ||
    category === "rifle" ||
    category === "rifles"
  ) {
    return "rifle";
  }
  if (
    ["ak-47", "m4a4", "m4a1-s", "sg 553", "aug", "famas", "galil ar"].some(
      (w) => type === w || cleanName.startsWith(`${w} |`) || cleanName === w,
    )
  ) {
    return "rifle";
  }

  // 8. Pistols
  if (
    group.includes("pistol") ||
    type.includes("pistol") ||
    category === "pistol" ||
    category === "pistols"
  ) {
    return "pistol";
  }
  if (
    [
      "glock-18",
      "usp-s",
      "desert eagle",
      "p250",
      "five-seven",
      "tec-9",
      "cz75-auto",
      "dual berettas",
      "r8 revolver",
      "p2000",
    ].some(
      (w) => type === w || cleanName.startsWith(`${w} |`) || cleanName === w,
    )
  ) {
    return "pistol";
  }

  // 9. SMGs
  if (
    group.includes("smg") ||
    group.includes("submachine") ||
    type.includes("smg") ||
    category === "smg" ||
    category === "smgs"
  ) {
    return "smg";
  }
  if (
    ["mp9", "mac-10", "mp7", "mp5-sd", "ump-45", "p90", "pp-bizon"].some(
      (w) => type === w || cleanName.startsWith(`${w} |`) || cleanName === w,
    )
  ) {
    return "smg";
  }

  // 10. Agents
  if (
    group.includes("agent") ||
    type.includes("agent") ||
    category === "agent" ||
    category === "agents"
  ) {
    return "agent";
  }

  // 11. Charms
  if (
    group.includes("charm") ||
    type.includes("charm") ||
    category === "charm" ||
    category === "charms" ||
    category === "keychain" ||
    category === "keychains" ||
    cleanName.startsWith("charm |")
  ) {
    return "charm";
  }

  // 12. Containers
  if (
    group.includes("container") ||
    group.includes("case") ||
    group.includes("capsule") ||
    group.includes("package") ||
    type.includes("container") ||
    type.includes("case") ||
    type.includes("capsule") ||
    type.includes("package") ||
    category === "container" ||
    category === "containers" ||
    category === "case" ||
    category === "cases" ||
    cleanName.endsWith(" case") ||
    cleanName.endsWith(" capsule") ||
    cleanName.endsWith(" package")
  ) {
    return "container";
  }

  // 13. Graffiti
  if (
    group.includes("graffiti") ||
    type.includes("graffiti") ||
    category === "graffiti" ||
    cleanName.startsWith("sealed graffiti |")
  ) {
    return "graffiti";
  }

  // 14. Patches
  if (
    group.includes("patch") ||
    type.includes("patch") ||
    category === "patch" ||
    category === "patches" ||
    cleanName.startsWith("patch |")
  ) {
    return "patch";
  }

  // 15. Stickers
  if (
    group.includes("sticker") ||
    type.includes("sticker") ||
    category === "sticker" ||
    category === "stickers" ||
    cleanName.startsWith("sticker |")
  ) {
    return "sticker";
  }

  // 16. Music Kits
  if (
    group.includes("music kit") ||
    group.includes("music_kit") ||
    type.includes("music kit") ||
    type.includes("music_kit") ||
    category === "music kit" ||
    category === "music_kit" ||
    category === "music kits" ||
    category === "music_kits" ||
    cleanName.startsWith("music kit |")
  ) {
    return "music_kit";
  }

  // 17. Passes
  if (
    group.includes("pass") ||
    type.includes("pass") ||
    category === "pass" ||
    category === "passes" ||
    cleanName.endsWith(" pass") ||
    cleanName.endsWith(" ticket")
  ) {
    return "pass";
  }

  // 18. Collectibles
  if (
    group.includes("collectible") ||
    type.includes("collectible") ||
    category === "collectible" ||
    category === "collectibles" ||
    cleanName.endsWith(" pin")
  ) {
    return "collectible";
  }

  // 19. Tools
  if (
    group.includes("tool") ||
    type.includes("tool") ||
    category === "tool" ||
    category === "tools"
  ) {
    return "tool";
  }

  // 20. Tags
  if (
    group.includes("tag") ||
    type.includes("tag") ||
    category === "tag" ||
    category === "tags" ||
    cleanName === "name tag"
  ) {
    return "tag";
  }

  // 21. Keys
  if (
    (group.includes("key") && !group.includes("keychain")) ||
    (type.includes("key") && !type.includes("keychain")) ||
    category === "key" ||
    category === "keys" ||
    cleanName.endsWith(" key")
  ) {
    return "key";
  }

  // 22. Gifts
  if (
    group.includes("gift") ||
    type.includes("gift") ||
    category === "gift" ||
    category === "gifts"
  ) {
    return "gift";
  }

  // Fallback by weapon name
  return classifyByName(cleanName);
}

export function classifyCatalogItem(
  input: CatalogItemClassificationInput,
): CatalogItemCapabilities {
  const itemType = resolveCatalogItemType(input);

  const normalizedItemType = normalize(input.itemtype);
  const normalizedName = normalize(input.name);
  const normalizedGroup = normalize(input.itemgroup);
  const isFloatCapableEquipment =
    itemType === "equipment" &&
    (normalizedItemType.includes("zeus") ||
      normalizedName.includes("zeus") ||
      normalizedGroup.includes("zeus"));

  return {
    itemType,
    supportsFloatStock:
      FLOAT_CAPABLE_ITEM_TYPES.has(itemType) || isFloatCapableEquipment,
    priceFilterEligible:
      PRICE_FILTER_ELIGIBLE_ITEM_TYPES.has(itemType) || isFloatCapableEquipment,
  };
}
