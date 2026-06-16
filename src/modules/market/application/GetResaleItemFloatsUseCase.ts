import { prisma } from "../../../shared/infrastructure/PrismaClient";
import { IMarketRepository } from "../domain/IMarketRepository";
import { FloatItem } from "../domain/FloatItem";
import { SyncResaleItemFloatsUseCase } from "./SyncResaleItemFloatsUseCase";

function applyModifier(basePrice: number, enabled: boolean, type: string, value: number): number {
  if (!enabled) return basePrice;

  let modifier = 0;
  switch (type) {
    case 'percentage_increase': modifier = (basePrice * value) / 100; break;
    case 'percentage_decrease': modifier = -((basePrice * value) / 100); break;
    case 'fixed_increase': modifier = value; break;
    case 'fixed_decrease': modifier = -value; break;
  }

  return Math.max(0, Math.round((basePrice + modifier) * 100) / 100);
}

export class GetResaleItemFloatsUseCase {
  private syncFloatsUseCase: SyncResaleItemFloatsUseCase;

  constructor(private marketRepository: IMarketRepository) {
    this.syncFloatsUseCase = new SyncResaleItemFloatsUseCase(marketRepository);
  }

  async execute(resaleItemId: string): Promise<(FloatItem & { displayPrice: number })[]> {
    // 1. Obtener el listing de base de la DB
    const listing = resaleItemId.startsWith("market-")
      ? await prisma.marketListing.findUnique({
          where: { name: resaleItemId.replace(/^market-/, "") }
        })
      : await prisma.marketListing.findUnique({
          where: { id: resaleItemId }
        });

    if (!listing) {
      throw new Error(`Market listing con ID ${resaleItemId} no existe.`);
    }

    // 2. Buscar floats persistidos en base de datos usando el ID real
    let floats = await this.marketRepository.findFloatsByResaleItemId(listing.id);

    // 3. Estrategia de cache: Si no hay floats o el último sync fue hace más de 5 minutos, resincronizar en tiempo real
    const lastSyncTime = floats.length > 0 && floats[0] ? floats[0].lastSyncAt : null;
    const isFresh = lastSyncTime && (Date.now() - new Date(lastSyncTime).getTime() < 5 * 60 * 1000); // 5 min cache

    if (!isFresh) {
      console.log(`[Get Resale Floats] Cache expirado o inexistente para "${listing.name}". Refrescando on-demand...`);
      try {
        await this.syncFloatsUseCase.execute(listing.id, listing.name);
        // Volver a leer los floats frescos insertados
        floats = await this.marketRepository.findFloatsByResaleItemId(listing.id);
      } catch (err: any) {
        console.warn(`[Get Resale Floats Warning] Error en sync on-demand para "${listing.name}": ${err.message}. Usando floats de la DB.`);
      }
    }

    // 4. Obtener las configuraciones de tarifas/recargos de admin
    const settings = await prisma.adminSettings.findFirst();
    const settingsData = settings ?? {
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase',
      marketModifierValue: 0,
    };

    // 5. Mapear precios originales a precios con markup del admin para el usuario final
    return floats.map((f) => ({
      ...f,
      displayPrice: applyModifier(
        f.price,
        settingsData.marketModifierEnabled,
        settingsData.marketModifierType,
        settingsData.marketModifierValue
      )
    }));
  }
}
