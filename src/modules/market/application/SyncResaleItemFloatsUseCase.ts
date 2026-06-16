import { IMarketRepository } from "../domain/IMarketRepository";
import { FloatItem } from "../domain/FloatItem";
import { config } from "../../../shared/config";

export class SyncResaleItemFloatsUseCase {
  constructor(private marketRepository: IMarketRepository) {}

  async execute(resaleItemId: string, marketHashName: string): Promise<FloatItem[]> {
    const apiKey = config.steamwebapiApiKey;
    if (!apiKey) {
      console.warn("[Sync Resale Floats] STEAMWEBAPI_API_KEY no configurado. Omitiendo.");
      return [];
    }

    // Codificación estricta de paréntesis requerida por SteamWebAPI para evitar 404
    const encodedName = encodeURIComponent(marketHashName)
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");

    const baseUrl = `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}`;

    console.log(`[Sync Resale Floats] Buscando floats para "${marketHashName}" (Resale ID: ${resaleItemId})...`);

    // El plan Float Small requiere filtrar por fuente específica.
    // Llamar sin source retorna solo items de inventario (source=inventory) sin precios.
    // Debemos hacer llamadas separadas por cada marketplace para obtener sus listados con precios.
    const sources = ["youpin", "buff"] as const;

    const fetchSource = async (source: string): Promise<any[]> => {
      try {
        const url = `${baseUrl}&source=${source}`;
        const res = await fetch(url);

        if (res.status === 404) {
          console.warn(`[Sync Resale Floats] ${source}: ítem "${marketHashName}" no encontrado (404).`);
          return [];
        }
        if (res.status === 429) {
          console.warn(`[Sync Resale Floats] ${source}: rate limit alcanzado (429). Omitiendo.`);
          return [];
        }
        if (!res.ok) {
          console.warn(`[Sync Resale Floats] ${source}: error ${res.status} obteniendo floats.`);
          return [];
        }

        const text = await res.text();
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          console.error(`[Sync Resale Floats] ${source}: error al parsear JSON.`);
          return [];
        }

        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.data)) return parsed.data;
        return [];
      } catch (err: any) {
        console.error(`[Sync Resale Floats] ${source}: error de red: ${err.message}`);
        return [];
      }
    };

    try {
      // Ejecutamos en serie para respetar límites de la API (una llamada por source)
      const allAssets: any[] = [];
      for (const source of sources) {
        const assets = await fetchSource(source);
        allAssets.push(...assets);
      }

      // Filtrar únicamente los listados con precio disponible
      const marketAssets = allAssets.filter(
        (asset) =>
          asset &&
          (asset.source === "buff" || asset.source === "youpin") &&
          asset.price !== undefined &&
          asset.price !== null &&
          Number(asset.price) > 0
      );

      const floats: FloatItem[] = marketAssets.map((asset) => {
        const sourceMarket = (asset.source || "youpin").toUpperCase() as "BUFF" | "YOUPIN";
        const price = Number(asset.price);

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
          market: sourceMarket,
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
