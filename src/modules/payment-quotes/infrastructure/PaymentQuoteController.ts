import { Request, Response } from "express";
import { CreatePaymentQuoteUseCase } from "../application/PaymentQuoteUseCases";

export class PaymentQuoteController {
  constructor(private createPaymentQuoteUseCase: CreatePaymentQuoteUseCase) {}

  async create(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const quote = await this.createPaymentQuoteUseCase.execute({
        userId,
        type: req.body.type,
        itemIds: req.body.itemIds,
        items: req.body.items,
        raffleId: req.body.raffleId,
        ticketsCount: req.body.ticketsCount,
        paymentMethod: req.body.paymentMethod,
        manualTransferType: req.body.manualTransferType ?? null,
      });

      return res.json(quote);
    } catch (error: any) {
      return res.status(400).json({
        error: error.message || "No se pudo generar la cotización de pago.",
      });
    }
  }
}
