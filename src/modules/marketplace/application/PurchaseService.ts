import { PricingService } from './PricingService';
import { TradeService } from './TradeService';
import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class PurchaseService {
  static async reserveAndPurchase(buyerId: string, listingId: string) {
    // Usar transacción de Prisma para evitar race conditions
    return prisma.$transaction(async (tx) => {
      // 1. Bloquear y buscar el listing
      const listing = await tx.skinListing.findUnique({
        where: { id: listingId }
      });

      if (!listing) throw new Error('Listing no encontrado');
      if (listing.status !== 'active') throw new Error('El item no está disponible para compra');
      if (listing.userId === buyerId) throw new Error('No puedes comprar tu propio item');

      // 2. Recalcular precio real en backend
      const { finalPrice } = await PricingService.calculateFinalPrice(listing.basePrice);

      // 3. Reservar el listing
      await tx.skinListing.update({
        where: { id: listingId },
        data: {
          status: 'reserved',
          reservedByUserId: buyerId,
          reservedUntil: new Date(Date.now() + 15 * 60000), // 15 minutos de reserva
          finalPrice // Actualizar por si las reglas cambiaron
        }
      });

      // 4. Crear la compra en pending
      const purchase = await tx.purchase.create({
        data: {
          buyerId,
          listingId,
          skinId: listing.skinId,
          botId: listing.botId,
          basePrice: listing.basePrice,
          finalPrice: finalPrice,
          status: 'pending_payment',
          paymentStatus: 'pending_payment',
          tradeStatus: 'pending'
        }
      });

      return purchase;
    });
  }

  static async confirmPayment(purchaseId: string) {
    return prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({ where: { id: purchaseId }, include: { listing: true } });
      if (!purchase) throw new Error('Compra no encontrada');
      if (purchase.paymentStatus === 'paid') return purchase; // Ya estaba pagado

      // Marcar como pagado
      const updatedPurchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          paymentStatus: 'paid',
          status: 'paid',
          paidAt: new Date()
        }
      });

      // Marcar listing como vendido
      await tx.skinListing.update({
        where: { id: purchase.listingId },
        data: { status: 'sold' }
      });

      // Disparar proceso de trade de forma asíncrona pero segura
      // Se podría llamar a TradeService aquí, o encolar un job.
      // Por simplicidad, llamamos al método que genera el trade.
      TradeService.initiateTradeProcess(updatedPurchase.id).catch(err => {
        console.error('[PurchaseService] Error initiating trade after payment:', err);
      });

      return updatedPurchase;
    });
  }

  static async getAllPurchases() {
    return prisma.purchase.findMany({
      include: {
        buyer: { select: { name: true, email: true } },
        bot: { select: { name: true } },
        listing: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  static async getUserPurchases(userId: string) {
    return prisma.purchase.findMany({
      where: { buyerId: userId },
      include: {
        listing: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
