import { config } from "../config";
import { prisma } from "./PrismaClient";

export interface PriceableItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  price: number;
}

export class PriceEnrichmentService {
  private static byMykelImagesMap: Map<string, string> | null = null;

  /**
   * Detectar la fase exacta de un Doppler o Gamma Doppler usando icon_url o el paintIndex oficial de CS2
   */
  static detectDopplerPhase(
    marketHashName: string,
    iconUrl: string | null,
    paintIndex?: number | null,
  ): string | null {
    if (!marketHashName) return null;
    if (!marketHashName.includes("Doppler")) return null;

    // 1. Detección exacta mediante Paint Index (Finish Catalog) si está disponible
    if (paintIndex !== undefined && paintIndex !== null) {
      const paintIndexMap: Record<number, string> = {
        // Doppler Gen 1
        418: "phase1",
        419: "phase2",
        420: "phase3",
        421: "phase4",
        415: "ruby",
        416: "sapphire",
        417: "blackpearl",
        // Doppler Gen 2 (Spectrum: Butterfly, Huntsman, Falchion, Shadow Daggers, Bowie)
        618: "phase2",
        619: "sapphire",
        617: "blackpearl",
        // Doppler Gen 3 (Prisma: Talon, Ursus, Navaja, Stiletto)
        852: "phase1",
        853: "phase2",
        854: "phase3",
        855: "phase4",
        849: "ruby",
        850: "sapphire",
        851: "blackpearl",

        // Gamma Doppler Gen 1
        569: "phase1",
        570: "phase2",
        571: "phase3",
        572: "phase4",
        568: "emerald",
        // Gamma Doppler Gen 2 (Dreams & Nightmares, etc)
        1119: "phase1",
        1120: "phase2",
        1121: "phase3",
        1122: "phase4",
        1118: "emerald",
      };
      if (paintIndexMap[paintIndex]) {
        return paintIndexMap[paintIndex];
      }
    }

    // 2. Intentar usar la librería offline si el hash tiene el formato clásico de CS:GO (-9a8)
    if (iconUrl && iconUrl.startsWith("-9a8")) {
      try {
        const dopplerPhaseDetector = require("csgo-doppler-phase");
        let cleanIconUrl = iconUrl;
        if (iconUrl.includes("economy/image/")) {
          cleanIconUrl = iconUrl.split("economy/image/")[1] || iconUrl;
        }

        const detected = dopplerPhaseDetector.detect(
          marketHashName,
          cleanIconUrl,
        );
        if (
          detected &&
          typeof detected === "string" &&
          !detected.startsWith("Something wrong")
        ) {
          return detected;
        }
      } catch (error) {
        console.error(
          "[PriceEnrichmentService] Error detecting Doppler phase via library:",
          error,
        );
      }
    }

    return null;
  }

  /**
   * Corrige el precio de las variantes Doppler legendarias (Ruby, Sapphire, Black Pearl, Emerald)
   * si el valor reportado por la API es erróneo o demasiado bajo en comparación con el precio base.
   */
  static adjustHighTierDopplerPrice(name: string, price: number, basePrice: number): number {
    const isRuby = name.includes(" | Ruby");
    const isSapphire = name.includes(" | Sapphire");
    const isBlackPearl = name.includes(" | Black Pearl");
    const isEmerald = name.includes(" | Emerald");

    if (!isRuby && !isSapphire && !isBlackPearl && !isEmerald) {
      return price;
    }

    let multiplier = 1.0;
    if (isBlackPearl) multiplier = 8.0;
    else if (isRuby) multiplier = 9.0;
    else if (isSapphire) multiplier = 10.0;
    else if (isEmerald) multiplier = 12.0;

    const minPrice = basePrice * multiplier;
    if (price < minPrice) {
      console.log(`[Doppler Price Correction] Correcting price for "${name}" from $${price} to $${minPrice} (Base: $${basePrice}, Multiplier: ${multiplier}x)`);
      return minPrice;
    }

    return price;
  }

  /**
   * Descompone un nombre completo de ítem (con fase opcional añadida) en el nombre base de mercado y la fase.
   */
  static getBaseNameAndPhase(fullName: string): {
    baseName: string;
    phase: string | null;
  } {
    if (!fullName) return { baseName: "", phase: null };

    const parts = fullName.split(" | ");
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1]!;
      const phaseNames = [
        "Phase 1",
        "Phase 2",
        "Phase 3",
        "Phase 4",
        "Ruby",
        "Sapphire",
        "Black Pearl",
        "Emerald",
      ];
      if (phaseNames.includes(lastPart)) {
        const baseName = parts.slice(0, -1).join(" | ");
        return { baseName, phase: lastPart };
      }
    }
    return { baseName: fullName, phase: null };
  }

  /**
   * Enriquecer una lista de artículos con precios del mercado real (vía DB local de MarketListing) o fallbacks deterministas.
   */
  static async enrichItemsWithMarketPrices<T extends PriceableItem>(
    items: T[],
  ): Promise<T[]> {
    // Generar nombres de búsqueda primarios y alternativos (ej: Sticker | vs Sticker Slab |)
    const lookupNames = new Set<string>();
    for (const item of items) {
      if (!item.name) continue;
      lookupNames.add(item.name);

      // Si es un Doppler con fase, también buscar el precio de la skin base para posibles correcciones
      const { baseName, phase } = this.getBaseNameAndPhase(item.name);
      if (phase && baseName) {
        lookupNames.add(baseName);
      }

      if (item.name.startsWith("Sticker | ")) {
        lookupNames.add(item.name.replace("Sticker | ", "Sticker Slab | "));
      } else if (item.name.startsWith("Sticker Slab | ")) {
        lookupNames.add(item.name.replace("Sticker Slab | ", "Sticker | "));
      }
    }

    const lookupList = Array.from(lookupNames);
    const pricesMap = new Map<string, number>();

    if (lookupList.length > 0) {
      try {
        console.log(
          `[Price Enrichment Service] Buscando precios en la DB local para ${lookupList.length} nombres de ítem...`,
        );
        // Consultar precios de una pasada
        const dbListings = await prisma.marketListing.findMany({
          where: { name: { in: lookupList } },
          select: { name: true, price: true },
        });

        const dbPricesMap = new Map<string, number>();
        for (const listing of dbListings) {
          dbPricesMap.set(listing.name, listing.price);
        }

        // Mapear los precios de vuelta a los ítems, considerando alternativas
        for (const item of items) {
          let price = dbPricesMap.get(item.name);
          if (price === undefined) {
            if (item.name.startsWith("Sticker | ")) {
              price = dbPricesMap.get(
                item.name.replace("Sticker | ", "Sticker Slab | "),
              );
            } else if (item.name.startsWith("Sticker Slab | ")) {
              price = dbPricesMap.get(
                item.name.replace("Sticker Slab | ", "Sticker | "),
              );
            }
          }

          if (price !== undefined) {
            pricesMap.set(item.name, price);
          }
        }

        // Para cualquier item faltante, intentar buscar por baseName (sin fase Doppler)
        const missingItems = items.filter((item) => !pricesMap.has(item.name));
        if (missingItems.length > 0) {
          const baseNamesToLookup = missingItems
            .map((item) => this.getBaseNameAndPhase(item.name).baseName)
            .filter(Boolean);

          if (baseNamesToLookup.length > 0) {
            // Generar alternativos también para los nombres base
            const baseLookupNames = new Set<string>();
            for (const bName of baseNamesToLookup) {
              baseLookupNames.add(bName);
              if (bName.startsWith("Sticker | ")) {
                baseLookupNames.add(
                  bName.replace("Sticker | ", "Sticker Slab | "),
                );
              } else if (bName.startsWith("Sticker Slab | ")) {
                baseLookupNames.add(
                  bName.replace("Sticker Slab | ", "Sticker | "),
                );
              }
            }

            const dbBaseListings = await prisma.marketListing.findMany({
              where: { name: { in: Array.from(baseLookupNames) } },
              select: { name: true, price: true },
            });

            const basePricesMap = new Map<string, number>();
            for (const listing of dbBaseListings) {
              basePricesMap.set(listing.name, listing.price);
            }

            for (const item of missingItems) {
              const { baseName } = this.getBaseNameAndPhase(item.name);
              let fallbackPrice = basePricesMap.get(baseName);
              if (fallbackPrice === undefined) {
                if (baseName.startsWith("Sticker | ")) {
                  fallbackPrice = basePricesMap.get(
                    baseName.replace("Sticker | ", "Sticker Slab | "),
                  );
                } else if (baseName.startsWith("Sticker Slab | ")) {
                  fallbackPrice = basePricesMap.get(
                    baseName.replace("Sticker Slab | ", "Sticker | "),
                  );
                }
              }

              if (fallbackPrice) {
                pricesMap.set(item.name, fallbackPrice);
              }
            }
          }
        }
      } catch (error) {
        console.error(
          "[Price Enrichment Service Error] Error al consultar precios en base de datos local:",
          error,
        );
      }
    }

    // Enriquecer cada ítem con el precio obtenido o con el fallback determinista
    return items.map((item) => {
      let finalPrice = pricesMap.get(item.name) || 0;

      // Aplicar corrección para Doppler de alto tier (Ruby, Sapphire, Black Pearl, Emerald)
      const { baseName, phase } = this.getBaseNameAndPhase(item.name);
      if (phase && baseName) {
        const basePrice = pricesMap.get(baseName) || 0;
        if (basePrice > 0) {
          finalPrice = this.adjustHighTierDopplerPrice(item.name, finalPrice, basePrice);
        }
      }

      if (finalPrice === 0) {
        finalPrice = this.calculateFallbackPrice(
          item.type,
          item.classId,
          item.assetId,
        );
      }

      return {
        ...item,
        price: finalPrice,
      };
    });
  }

  static parseItemDetails(
    description: any,
    assetId?: string,
  ): {
    rarity: string;
    exterior: string | null;
    category: string;
    isStatTrak: boolean;
    isSouvenir: boolean;
    float: number | null;
    pattern: number | null;
  } {
    const typeStr = description?.type || "";
    const name = description?.market_hash_name || description?.name || "";
    const tags = description?.tags || [];

    // 1. Rarity
    const rarity = this.getRarityFromType(typeStr, description?.classid || "");

    // 2. Exterior / Wear (desde tags)
    const exteriorTag = tags.find((t: any) => t.category === "Exterior");
    const exterior = exteriorTag ? exteriorTag.localized_tag_name : null;

    // 3. Category / Slot de arma
    let category = "other";
    const typeLower = typeStr.toLowerCase();
    if (typeLower.includes("cuchillo") || typeLower.includes("knife")) {
      category = "knife";
    } else if (typeLower.includes("guantes") || typeLower.includes("gloves")) {
      category = "gloves";
    } else {
      const weaponTag = tags.find(
        (t: any) => t.category === "Weapon" || t.category === "Type",
      );
      if (weaponTag) {
        const tagName = (
          weaponTag.localized_tag_name ||
          weaponTag.internal_name ||
          ""
        ).toLowerCase();
        if (
          [
            "ak-47",
            "m4a4",
            "m4a1-s",
            "awp",
            "scout",
            "ssg 08",
            "sg 553",
            "aug",
            "galil",
            "famas",
            "g3sg1",
            "scar-20",
          ].some((r) => tagName.includes(r))
        ) {
          category = "rifle";
        } else if (
          [
            "pistola",
            "pistol",
            "glock-18",
            "usp-s",
            "desert eagle",
            "deagle",
            "p250",
            "cz75",
            "five-seven",
            "tec-9",
            "dual berettas",
            "revolver",
          ].some((p) => tagName.includes(p))
        ) {
          category = "pistol";
        } else if (
          [
            "subfusil",
            "smg",
            "mac-10",
            "mp9",
            "mp7",
            "mp5",
            "ump-45",
            "p90",
            "bizon",
          ].some((s) => tagName.includes(s))
        ) {
          category = "smg";
        } else if (
          [
            "escopeta",
            "shotgun",
            "nova",
            "xm1014",
            "mag-7",
            "sawed-off",
            "negev",
            "m249",
          ].some((sh) => tagName.includes(sh))
        ) {
          category = "heavy";
        }
      }
    }

    // Fallbacks si las etiquetas de Steam son demasiado estrictas o están ausentes
    if (category === "other") {
      if (typeLower.includes("rifle") || typeLower.includes("fusil"))
        category = "rifle";
      else if (typeLower.includes("pistol") || typeLower.includes("pistola"))
        category = "pistol";
      else if (typeLower.includes("subfusil") || typeLower.includes("smg"))
        category = "smg";
      else if (typeLower.includes("knife") || typeLower.includes("cuchillo"))
        category = "knife";
      else if (typeLower.includes("gloves") || typeLower.includes("guantes"))
        category = "gloves";
      else if (typeLower.includes("sticker") || typeLower.includes("pegatina"))
        category = "sticker";
    }

    // 4. StatTrak & Souvenir
    const isStatTrak = name.includes("StatTrak™") || name.includes("StatTrak");
    const isSouvenir = name.includes("Souvenir");

    return {
      rarity,
      exterior,
      category,
      isStatTrak,
      isSouvenir,
      float: null,
      pattern: null,
    };
  }

  private static calculateFallbackPrice(
    type: string,
    classId: string,
    assetId: string,
  ): number {
    const typeLower = type.toLowerCase();

    // Guardián contra precios falsos exorbitantes para consumibles o coleccionables comunes (stickers, cajas, graffitis, etc.)
    if (
      typeLower.includes("sticker") ||
      typeLower.includes("pegatina") ||
      typeLower.includes("graffiti") ||
      typeLower.includes("patch") ||
      typeLower.includes("parche") ||
      typeLower.includes("music") ||
      typeLower.includes("música") ||
      typeLower.includes("pin") ||
      typeLower.includes("badge") ||
      typeLower.includes("insignia") ||
      typeLower.includes("container") ||
      typeLower.includes("contenedor") ||
      typeLower.includes("case") ||
      typeLower.includes("caja") ||
      typeLower.includes("capsule") ||
      typeLower.includes("cápsula") ||
      typeLower.includes("key") ||
      typeLower.includes("llave") ||
      typeLower.includes("pass") ||
      typeLower.includes("pase") ||
      typeLower.includes("tool") ||
      typeLower.includes("herramienta") ||
      typeLower.includes("package") ||
      typeLower.includes("paquete") ||
      typeLower.includes("gift") ||
      typeLower.includes("regalo")
    ) {
      return 0.15; // precio ultra-seguro por defecto para consumibles comunes
    }

    const rarity = this.getRarityFromType(type, classId);
    let basePrice = 0.05; // default para common/consumer weapon

    const isHighTier =
      typeLower.includes("knife") ||
      typeLower.includes("cuchillo") ||
      typeLower.includes("gloves") ||
      typeLower.includes("guantes");

    if (isHighTier) {
      basePrice = 120.0; // Base segura para cuchillos y guantes si no tienen precio real en catálogo
    } else {
      // Armas estándar con precios de fallback muy realistas y seguros contra abusos
      if (rarity === "ancient")
        basePrice = 25.0; // Covert
      else if (rarity === "legendary")
        basePrice = 6.0; // Classified
      else if (rarity === "mythical")
        basePrice = 1.5; // Restricted
      else if (rarity === "rare")
        basePrice = 0.4; // Mil-spec
      else if (rarity === "uncommon") basePrice = 0.15; // Industrial
    }

    const variance = (this.hashCode(assetId) % 100) / 100; // 0.0 to 1.0
    const finalPrice =
      Math.round(basePrice * (0.8 + variance * 0.4) * 100) / 100; // variance of +/-20%
    return finalPrice;
  }

  static getRarityFromType(type: string, classId: string): string {
    const typeLower = type.toLowerCase();
    if (
      typeLower.includes("encubierto") ||
      typeLower.includes("covert") ||
      typeLower.includes("cuchillo") ||
      typeLower.includes("knife") ||
      typeLower.includes("guantes") ||
      typeLower.includes("gloves") ||
      typeLower.includes("extraordinario") ||
      typeLower.includes("contrabando")
    ) {
      return "ancient";
    } else if (
      typeLower.includes("clasificado") ||
      typeLower.includes("classified")
    ) {
      return "legendary";
    } else if (
      typeLower.includes("restringido") ||
      typeLower.includes("restricted")
    ) {
      return "mythical";
    } else if (
      typeLower.includes("militar") ||
      typeLower.includes("mil-spec")
    ) {
      return "rare";
    } else if (typeLower.includes("industrial")) {
      return "uncommon";
    } else if (
      typeLower.includes("consumo") ||
      typeLower.includes("consumer")
    ) {
      return "common";
    } else {
      const rarities = [
        "common",
        "uncommon",
        "rare",
        "mythical",
        "legendary",
        "ancient",
      ];
      const index = Math.abs(this.hashCode(classId)) % rarities.length;
      return rarities[index] || "common";
    }
  }

  private static hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  static inferDetailsFromMarketHashName(name: string): {
    type: string;
    rarity: string;
    exterior: string | null;
    category: string;
    isStatTrak: boolean;
    isSouvenir: boolean;
  } {
    const nameLower = name.toLowerCase();

    // Exterior
    let exterior: string | null = null;
    if (name.includes("(Factory New)")) exterior = "Factory New";
    else if (name.includes("(Minimal Wear)")) exterior = "Minimal Wear";
    else if (name.includes("(Field-Tested)")) exterior = "Field-Tested";
    else if (name.includes("(Well-Worn)")) exterior = "Well-Worn";
    else if (name.includes("(Battle-Scarred)")) exterior = "Battle-Scarred";

    // Rarity & Category
    let rarity = "common";
    let category = "other";
    let type = "Weapon";

    const isKnife =
      name.includes("★") ||
      [
        "knife",
        "bayonet",
        "karambit",
        "flip",
        "gut",
        "falchion",
        "bowie",
        "huntsman",
        "talon",
        "ursus",
        "stiletto",
        "navaja",
        "nomad",
        "survival",
        "paracord",
        "skeleton",
      ].some((k) => nameLower.includes(k));
    const isGloves = ["gloves", "wraps"].some((g) => nameLower.includes(g));

    if (isKnife) {
      rarity = "ancient";
      category = "knife";
      type = "★ Knife";
    } else if (isGloves) {
      rarity = "ancient";
      category = "gloves";
      type = "★ Gloves";
    } else {
      if (
        [
          "ak-47",
          "m4a4",
          "m4a1-s",
          "awp",
          "scout",
          "ssg 08",
          "sg 553",
          "aug",
          "galil",
          "famas",
          "g3sg1",
          "scar-20",
        ].some((r) => nameLower.includes(r))
      ) {
        category = "rifle";
        type = "Rifle";
        rarity =
          nameLower.includes("ak-47") ||
          nameLower.includes("awp") ||
          nameLower.includes("m4a")
            ? "legendary"
            : "mythical";
      } else if (
        [
          "glock-18",
          "usp-s",
          "desert eagle",
          "deagle",
          "p250",
          "cz75",
          "five-seven",
          "tec-9",
          "dual berettas",
          "revolver",
        ].some((p) => nameLower.includes(p))
      ) {
        category = "pistol";
        type = "Pistol";
        rarity =
          nameLower.includes("desert eagle") || nameLower.includes("usp-s")
            ? "mythical"
            : "rare";
      } else if (
        ["mac-10", "mp9", "mp7", "mp5", "ump-45", "p90", "bizon"].some((s) =>
          nameLower.includes(s),
        )
      ) {
        category = "smg";
        type = "SMG";
        rarity = "rare";
      } else if (
        ["nova", "xm1014", "mag-7", "sawed-off", "negev", "m249"].some((sh) =>
          nameLower.includes(sh),
        )
      ) {
        category = "heavy";
        type = "Heavy";
        rarity = "uncommon";
      }
    }

    const isStatTrak = name.includes("StatTrak™") || name.includes("StatTrak");
    const isSouvenir = name.includes("Souvenir");

    return {
      type,
      rarity,
      exterior,
      category,
      isStatTrak,
      isSouvenir,
    };
  }

  static cleanNameForImageLookup(name: string): string {
    if (!name) return "";
    let clean = name;

    // 1. Quitar el exterior entre paréntesis al final (ej. " (Factory New)", " (Field-Tested)")
    const exteriorMatch = clean.match(/\s*\([^)]+\)\s*$/);
    if (exteriorMatch) {
      clean = clean.replace(exteriorMatch[0], "");
    }

    // 2. Quitar Doppler phases al final
    const phaseNames = [
      "Phase 1",
      "Phase 2",
      "Phase 3",
      "Phase 4",
      "Ruby",
      "Sapphire",
      "Black Pearl",
      "Emerald",
    ];
    for (const phase of phaseNames) {
      if (clean.endsWith(` | ${phase}`)) {
        clean = clean.substring(0, clean.length - (phase.length + 3));
        break;
      }
    }

    // 3. Eliminar prefijos clásicos de mercado de Steam
    clean = clean.replace(/^★\s+/, ""); // Quitar estrella de cuchillos/guantes
    clean = clean.replace(/^StatTrak™\s+/, ""); // Quitar StatTrak
    clean = clean.replace(/^Souvenir\s+/, ""); // Quitar Souvenir

    return clean.trim();
  }

  static async fetchByMykelSkinsImages(): Promise<Map<string, string>> {
    if (this.byMykelImagesMap) return this.byMykelImagesMap;

    const map = new Map<string, string>();
    const endpoints = [
      "skins.json",
      "stickers.json",
      "crates.json",
      "agents.json",
      "music_kits.json",
      "patches.json",
      "keys.json",
      "graffiti.json",
      "collectibles.json",
    ];

    console.log(
      `[Price Enrichment Service] Loading skin, sticker, agent, patch, crate & music images from ByMykel API...`,
    );

    const promises = endpoints.map(async (file) => {
      const url = `https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/${file}`;
      const response = await fetch(url);
      if (response.ok) {
        return { file, data: (await response.json()) as any[] };
      }
      throw new Error(`Failed to fetch ${file}`);
    });

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { file, data } = result.value;
        let count = 0;
        for (const item of data) {
          if (item && item.name && item.image) {
            // Mapeo 1: Nombre original de ByMykel
            map.set(item.name, item.image);

            // Mapeo 2: Nombre de ByMykel limpio
            const cleanMykelName = this.cleanNameForImageLookup(item.name);
            if (cleanMykelName && cleanMykelName !== item.name) {
              map.set(cleanMykelName, item.image);
            }
            count++;
          }
        }
        console.log(`  -> Loaded ${count} mappings from ${file}`);
      } else {
        console.warn(
          `[Price Enrichment Service] Failed to load some image mappings:`,
          result.reason,
        );
      }
    }

    this.byMykelImagesMap = map;
    console.log(
      `[Price Enrichment Service] Loaded total of ${map.size} unique image mappings from ByMykel.`,
    );
    return map;
  }
}
