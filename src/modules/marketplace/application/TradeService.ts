import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { BotService } from './BotService';

export class TradeService {
  static async initiateTradeProcess(purchaseId: string) {
    return prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id: purchaseId },
        include: { buyer: true, listing: true }
      });

      if (!purchase) throw new Error('Compra no encontrada');
      if (purchase.paymentStatus !== 'paid') {
        throw new Error('REGLA CRÍTICA: No se puede enviar un trade si la compra no está pagada.');
      }

      // Si el listing tiene un bot asignado, usamos ese. Si no, asignamos uno disponible
      let botId = purchase.listing.botId || purchase.botId;

      if (!botId) {
        const bot = await BotService.getAvailableBot();
        if (!bot) throw new Error('No hay bots disponibles para procesar el trade');
        botId = bot.id;

        // Actualizamos la compra y el listing con el bot asignado
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { botId }
        });
      }

      // Creamos el registro de trade
      const trade = await tx.trade.create({
        data: {
          purchaseId: purchase.id,
          botId,
          userId: purchase.buyerId,
          status: 'pending'
        }
      });

      // Actualizamos estado de la compra
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { tradeStatus: 'pending', status: 'trade_pending' }
      });

      // Simulación de interacción con Steam API (Bot)
      // Aquí iría el código real que conecta con el bot de Node.js / Steam
      // setTimeout(() => { TradeService.simulateTradeSuccess(trade.id) }, 5000);

      return trade;
    });
  }

  static async simulateTradeSuccess(tradeId: string) {
    const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
    if (!trade) return;

    await prisma.trade.update({
      where: { id: tradeId },
      data: { status: 'sent', sentAt: new Date() }
    });

    await prisma.purchase.update({
      where: { id: trade.purchaseId },
      data: { tradeStatus: 'sent', status: 'trade_sent' }
    });
  }

  static async updateTradeStatus(tradeId: string, status: string, steamTradeOfferId?: string, errorMessage?: string) {
    const trade = await prisma.trade.update({
      where: { id: tradeId },
      data: {
        status,
        ...(steamTradeOfferId !== undefined && { steamTradeOfferId }),
        ...(errorMessage !== undefined && { errorMessage }),
        ...(status === 'accepted' ? { acceptedAt: new Date() } : {}),
        ...(status === 'cancelled' ? { cancelledAt: new Date() } : {})
      }
    });

    let purchaseStatus = 'trade_pending';
    let purchaseTradeStatus = status;

    if (status === 'accepted') purchaseStatus = 'trade_accepted';
    else if (status === 'sent') purchaseStatus = 'trade_sent';
    else if (status === 'failed') purchaseStatus = 'failed';
    else if (status === 'cancelled') purchaseStatus = 'cancelled';

    await prisma.purchase.update({
      where: { id: trade.purchaseId },
      data: {
        tradeStatus: purchaseTradeStatus,
        status: purchaseStatus
      }
    });

    return trade;
  }
}
