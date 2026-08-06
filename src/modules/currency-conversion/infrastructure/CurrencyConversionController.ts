import type { Request, Response } from "express";
import { GetDisplayRatesUseCase } from "../application/GetDisplayRatesUseCase";
import { dolarApiExchangeRateProvider } from "./CurrencyConversionDependencies";

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

  async getAllRates(_req: Request, res: Response) {
    try {
      const [blue, oficial, cripto] = await Promise.all([
        dolarApiExchangeRateProvider.getUsdArsRate("blue"),
        dolarApiExchangeRateProvider.getUsdArsRate("oficial"),
        dolarApiExchangeRateProvider.getUsdArsRate("cripto"),
      ]);
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json({ blue, oficial, cripto });
    } catch (error) {
      console.error("[Currency Conversion] Could not load all rates:", error);
      return res.status(503).json({
        error: "Las cotizaciones no estan disponibles temporalmente.",
      });
    }
  }
}
