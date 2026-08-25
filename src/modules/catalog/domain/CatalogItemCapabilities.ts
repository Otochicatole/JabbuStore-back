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

type CatalogItemClassificationInput = {
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

const ITEM_GROUP_ALIASES: Record<string, CatalogItemType> = {
  pistol: "pistol",
  knife: "knife",
  rifle: "rifle",
  smg: "smg",
  "sniper rifle": "sniper_rifle",
  sniper_rifle: "sniper_rifle",
  shotgun: "shotgun",
  machinegun: "machinegun",
  "machine gun": "machinegun",
  machine_gun: "machinegun",
  gloves: "gloves",
  glove: "gloves",
  equipment: "equipment",
  sticker: "sticker",
  container: "container",
  agent: "agent",
  charm: "charm",
  graffiti: "graffiti",
  patch: "patch",
  "music kit": "music_kit",
  music_kit: "music_kit",
  collectible: "collectible",
  pass: "pass",
  key: "key",
  gift: "gift",
  tool: "tool",
  tag: "tag",
};

const CATEGORY_ALIASES: Record<string, CatalogItemType> = {
  knife: "knife",
  knives: "knife",
  glove: "gloves",
  gloves: "gloves",
  rifle: "rifle",
  rifles: "rifle",
  pistol: "pistol",
  pistols: "pistol",
  smg: "smg",
  smgs: "smg",
  sniper: "sniper_rifle",
  snipers: "sniper_rifle",
  "sniper rifle": "sniper_rifle",
  shotguns: "shotgun",
  shotgun: "shotgun",
  heavy: "machinegun",
  machine_guns: "machinegun",
  machinegun: "machinegun",
  sticker: "sticker",
  stickers: "sticker",
  container: "container",
  containers: "container",
  case: "container",
  cases: "container",
  agent: "agent",
  agents: "agent",
  charm: "charm",
  charms: "charm",
  keychain: "charm",
  keychains: "charm",
  graffiti: "graffiti",
  patch: "patch",
  patches: "patch",
  "music kit": "music_kit",
  music_kits: "music_kit",
};

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

export function classifyCatalogItem(
  input: CatalogItemClassificationInput,
): CatalogItemCapabilities {
  const itemGroup = normalize(input.itemgroup);
  const category = normalize(input.category);
  const itemType =
    ITEM_GROUP_ALIASES[itemGroup] ??
    CATEGORY_ALIASES[category] ??
    classifyByName(normalize(input.name));

  const normalizedItemType = normalize(input.itemtype);
  const normalizedName = normalize(input.name);
  const isFloatCapableEquipment =
    itemType === "equipment" &&
    (normalizedItemType.includes("zeus") || normalizedName.includes("zeus"));

  return {
    itemType,
    supportsFloatStock:
      FLOAT_CAPABLE_ITEM_TYPES.has(itemType) || isFloatCapableEquipment,
    priceFilterEligible:
      PRICE_FILTER_ELIGIBLE_ITEM_TYPES.has(itemType) || isFloatCapableEquipment,
  };
}
