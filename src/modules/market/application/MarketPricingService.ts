/**
 * Servicio de precios exclusivo para el mercado YouPin.
 *
 * Reglas obligatorias:
 * - youpinAsk almacena el precio externo original (sin modificador).
 * - No sobrescribir price cuando isPriceManual = true.
 * - No aplicar el modificador mas de una vez.
 * - No aplicar modificadores de bots a productos de YouPin.
 */

export interface MarketModifierSettings {
  marketModifierEnabled: boolean;
  marketModifierType: string;
  marketModifierValue: number;
}

export class MarketPricingService {
  /**
   * Calcula el precio final de un listing YouPin a partir de su youpinAsk
   * y la configuracion del modificador de mercado.
   * El precio resultante es el valor que se guarda en MarketListing.price
   * (salvo que isPriceManual = true, en cuyo caso el repositorio lo ignora).
   */
  static computeListingPrice(
    youpinAsk: number,
    settings: MarketModifierSettings,
  ): number {
    return MarketPricingService.applyModifier(youpinAsk, settings);
  }

  /**
   * Aplica el modificador de mercado a un precio base.
   * Devuelve el precio base sin modificaciones si el modificador esta desactivado.
   */
  static applyModifier(
    basePrice: number,
    settings: MarketModifierSettings,
  ): number {
    if (!settings.marketModifierEnabled) return basePrice;

    let delta = 0;
    switch (settings.marketModifierType) {
      case 'percentage_increase':
        delta = (basePrice * settings.marketModifierValue) / 100;
        break;
      case 'percentage_decrease':
        delta = -((basePrice * settings.marketModifierValue) / 100);
        break;
      case 'fixed_increase':
        delta = settings.marketModifierValue;
        break;
      case 'fixed_decrease':
        delta = -settings.marketModifierValue;
        break;
    }

    return Math.max(0, Math.round((basePrice + delta) * 100) / 100);
  }

  static defaultSettings(): MarketModifierSettings {
    return {
      marketModifierEnabled: false,
      marketModifierType: 'percentage_increase',
      marketModifierValue: 0,
    };
  }
}
