import type { Request, Response } from "express";
import { GetDisplayRatesUseCase } from "../application/GetDisplayRatesUseCase";

export class CurrencyConversionController {
  constructor(private readonly getDisplayRatesUseCase: GetDisplayRatesUseCase) {}

  async getDisplayRates(_req: Request, res: Response) {
    try {
      const result = await this.getDisplayRatesUseCase.execute();
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json(result);
    } catch (error) {
      console.error("[Currency Conversion] Could not load display rates:", error);
      return res.status(503).json({
        error: "La conversion de moneda no esta disponible temporalmente.",
      });
    }
  }
}
