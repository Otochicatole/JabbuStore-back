import { Router } from "express";
import { GetDisplayRatesUseCase } from "../application/GetDisplayRatesUseCase";
import { CurrencyConversionController } from "./CurrencyConversionController";
import { dolarApiExchangeRateProvider } from "./CurrencyConversionDependencies";

const router = Router();
const controller = new CurrencyConversionController(
  new GetDisplayRatesUseCase(dolarApiExchangeRateProvider),
);

router.get("/display-rates", (req, res) => controller.getDisplayRates(req, res));

export default router;
