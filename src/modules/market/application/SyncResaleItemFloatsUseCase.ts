import { IMarketRepository } from "../domain/IMarketRepository";
import { FloatItem } from "../domain/FloatItem";
import { config } from "../../../shared/config";
import { PriceEnrichmentService } from "../../../shared/infrastructure/PriceEnrichmentService";


export class SyncResaleItemFloatsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(resaleItemId: string, marketHashName: string): Promise<FloatItem[]> {
    const apiKey = config.steamwebapiApiKey;
    if (!apiKey) {
      console.warn("[Sync Resale Floats] STEAMWEBAPI_API_KEY no configurado. Omitiendo.");
      return [];
    }

    const { baseName, phase } = PriceEnrichmentService.getBaseNameAndPhase(marketHashName);

    // Codificación estricta de paréntesis requerida por SteamWebAPI para evitar 404
    const encodedName = encodeURIComponent(baseName)
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");

    const baseUrl = `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}`;

    console.log(
      `[Sync Resale Floats] Buscando floats para "${baseName}"` +
        (phase ? ` (Fase requerida: "${phase}")` : "") +
        ` (Original: "${marketHashName}", Resale ID: ${resaleItemId})...`
    );

    // Soportar YouPin y CSFloat para asegurar disponibilidad de floats en ítems de baja liquidez
    const sources = ["youpin", "csfloat"] as const;

    // La API de SteamWebAPI devuelve 10 resultados por página y soporta paginación con &page=N.
    // Paginamos hasta MAX_PAGES páginas por source para obtener la mayor cantidad de floats posible
    // sin saturar el rate limit del plan Float small (80 req/min).
    const PAGE_SIZE = 10;
    const MAX_PAGES = 5; // Hasta 50 floats por source

    const fetchSource = async (source: string): Promise<any[]> => {
      const allResults: any[] = [];

      for (let page = 1; page <= MAX_PAGES; page++) {
        try {
          const url = `${baseUrl}&source=${source}&page=${page}`;
          const res = await fetch(url);

          if (res.status === 404) {
            if (page === 1) {
              console.warn(`[Sync Resale Floats] ${source}: ítem "${baseName}" no encontrado (404).`);
            }
            break;
          }
          if (res.status === 429) {
            console.warn(`[Sync Resale Floats] ${source}: rate limit alcanzado (429) en página ${page}. Usando ${allResults.length} resultados obtenidos.`);
            break;
          }
          if (!res.ok) {
            console.warn(`[Sync Resale Floats] ${source}: error ${res.status} en página ${page}.`);
            break;
          }

          const text = await res.text();
          let parsed: any;
          try {
            parsed = JSON.parse(text);
          } catch {
            console.error(`[Sync Resale Floats] ${source}: error al parsear JSON en página ${page}.`);
            break;
          }

          const pageResults = Array.isArray(parsed)
            ? parsed
            : parsed && Array.isArray(parsed.data)
              ? parsed.data
              : [];

          allResults.push(...pageResults);

          // Si la página devolvió menos de PAGE_SIZE, ya no hay más resultados
          if (pageResults.length < PAGE_SIZE) {
            break;
          }
        } catch (err: any) {
          console.error(`[Sync Resale Floats] ${source}: error de red en página ${page}: ${err.message}`);
          break;
        }
      }

      if (allResults.length > 0) {
        console.log(`[Sync Resale Floats] ${source}: obtenidos ${allResults.length} assets en total.`);
      }

      return allResults;
    };

    try {
      const allAssets: any[] = [];
      for (const source of sources) {
        const assets = await fetchSource(source);
        allAssets.push(...assets);
      }

      // Deduplicar por assetid, priorizando youpin sobre csfloat si un mismo asset aparece en ambos
      const deduped = new Map<string, any>();
      for (const asset of allAssets) {
        if (!asset || !asset.assetid) continue;
        const key = String(asset.assetid);
        const existing = deduped.get(key);
        if (!existing || (asset.source === "youpin" && existing.source !== "youpin")) {
          deduped.set(key, asset);
        }
      }
      const uniqueAssets = Array.from(deduped.values());

      // Filtrar únicamente los listados con precio disponible o derivable y que coincidan con la fase (si aplica)
      const marketAssets = uniqueAssets.filter((asset) => {
        if (!asset) return false;

        // Validar que el source sea admitido
        if (asset.source !== "youpin" && asset.source !== "csfloat") {
          return false;
        }

        // Obtener o calcular precio (para csfloat viene en metadata.price_cents)
        let price = Number(asset.price);
        if (!price || price <= 0) {
          if (asset.metadata && asset.metadata.price_cents) {
            price = Number(asset.metadata.price_cents) / 100;
          }
        }

        // Si no hay precio disponible de ninguna forma, omitir
        if (!price || price <= 0) {
          return false;
        }

        // Guardar precio resuelto directamente en el objeto temporal
        asset.resolvedPrice = price;

        // Si el listado original tiene una fase específica, filtrar los assets para que solo queden los de esa fase
        if (phase) {
          let assetPhase: string | null = asset.phase || null;

          // Si el asset no trae la propiedad phase en la API, intentar detectarla usando el paintindex
          if (!assetPhase && asset.paintindex !== undefined && asset.paintindex !== null) {
            const detectedRaw = PriceEnrichmentService.detectDopplerPhase(
              baseName,
              null,
              asset.paintindex
            );
            if (detectedRaw) {
              const phaseMap: Record<string, string> = {
                phase1: "Phase 1",
                phase2: "Phase 2",
                phase3: "Phase 3",
                phase4: "Phase 4",
                ruby: "Ruby",
                sapphire: "Sapphire",
                blackpearl: "Black Pearl",
                emerald: "Emerald",
              };
              assetPhase = phaseMap[detectedRaw.toLowerCase()] || null;
            }
          }

          if (!assetPhase || assetPhase.toLowerCase() !== phase.toLowerCase()) {
            return false;
          }
        }

        return true;
      });

      const floats: FloatItem[] = marketAssets.map((asset) => {
        const price = Number(asset.resolvedPrice || asset.price);

        // Reconstrucción del inspect link de CS:GO siguiendo la estructura preview de Steam
        let inspectLink: string | null = null;
        if (asset.marketid && asset.certificate) {
          inspectLink = `steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20M${asset.marketid}A${asset.assetid}D${asset.certificate}`;
        } else if (asset.steamid && asset.certificate) {
          inspectLink = `steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S${asset.steamid}A${asset.assetid}D${asset.certificate}`;
        }

        return {
          assetId: String(asset.assetid),
          floatValue: Number(asset.float),
          paintSeed: Number(asset.paintseed) || 0,
          market: "YOUPIN" as const,
          price: price,
          inspectLink: inspectLink,
          available: true,
          externalId: asset.marketid ? String(asset.marketid) : String(asset.id),
          resaleItemId: resaleItemId,
        };
      });

      // Guardar de forma atómica en la base de datos
      await this.marketRepository.saveFloats(resaleItemId, floats);
      console.log(`[Sync Resale Floats] Sincronizados ${floats.length} floats para "${marketHashName}".`);
      return floats;
    } catch (error: any) {
      console.error(`[Sync Resale Floats Error] Error al sincronizar floats para "${marketHashName}":`, error.message || error);
      throw error;
    }
  }
}
