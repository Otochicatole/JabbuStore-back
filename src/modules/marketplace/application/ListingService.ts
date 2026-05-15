import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { PricingService } from './PricingService';
import { AdminSettingsService } from './AdminSettingsService';

export class ListingService {
  static async createListing(userId: string, skinId: string, requestedPrice: number) {
    const settings = await AdminSettingsService.getSettings();
    if (requestedPrice < settings.minimumUserSellPrice) {
      throw new Error(`El precio mínimo de venta es ${settings.minimumUserSellPrice}`);
    }

    // Comprobar si el usuario tiene el item
    const inventoryItem = await prisma.userInventoryItem.findFirst({
      where: { userId, assetId: skinId }
    });

    if (!inventoryItem) {
      throw new Error('Item no encontrado en el inventario del usuario');
    }

    // Comprobar si ya está a la venta
    const existingListing = await prisma.skinListing.findFirst({
      where: { skinId, status: { in: ['active', 'reserved'] } }
    });

    if (existingListing) {
      throw new Error('El item ya está listado para la venta');
    }

    // El precio base es el solicitado, el finalPrice es el mismo (el usuario asume comisiones o se vende a ese precio)
    // O si el marketplace aplica una tarifa extra al comprador, finalPrice puede ser diferente.
    // Por requerimientos: "El backend valida que el precio no esté por debajo del mínimo..."
    const { finalPrice } = await PricingService.calculateFinalPrice(requestedPrice);

    return prisma.skinListing.create({
      data: {
        userId,
        skinId,
        basePrice: requestedPrice,
        finalPrice: finalPrice, // Precio que pagará el comprador
        status: 'active'
      }
    });
  }

  static async getActiveListings() {
    return prisma.skinListing.findMany({
      where: { status: 'active' },
      include: {
        user: { select: { name: true, avatar: true } }
      }
    });
  }

  static async getListingById(id: string) {
    return prisma.skinListing.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, avatar: true } }
      }
    });
  }

  static async cancelListing(id: string, userId: string) {
    const listing = await prisma.skinListing.findUnique({ where: { id } });
    if (!listing) throw new Error('Listing no encontrado');
    if (listing.userId !== userId) throw new Error('No autorizado');
    if (listing.status !== 'active') throw new Error('El listing no está activo');

    return prisma.skinListing.update({
      where: { id },
      data: { status: 'cancelled' }
    });
  }
}
