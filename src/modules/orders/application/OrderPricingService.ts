import { prisma } from "../../../shared/infrastructure/PrismaClient";

type ModifierType =
  | "percentage_increase"
  | "percentage_decrease"
  | "fixed_increase"
  | "fixed_decrease";

export interface CheckoutPricingSettings {
  globalPriceModifierType: string;
  globalPriceModifierValue: number;
  globalPriceModifierEnabled: boolean;
  userSellModifierType: string;
  userSellModifierValue: number;
  userSellModifierEnabled: boolean;
  marketModifierType: string;
  marketModifierValue: number;
  marketModifierEnabled: boolean;
  minimumUserSellPrice: number;
  manualTransferEnabled: boolean;
}

const DEFAULT_SETTINGS: CheckoutPricingSettings = {
  globalPriceModifierType: "percentage_increase",
  globalPriceModifierValue: 0,
  globalPriceModifierEnabled: false,
  userSellModifierType: "percentage_decrease",
  userSellModifierValue: 0,
  userSellModifierEnabled: false,
  marketModifierType: "percentage_increase",
  marketModifierValue: 0,
  marketModifierEnabled: false,
  minimumUserSellPrice: 1,
  manualTransferEnabled: false,
};

const isModifierType = (type: string): type is ModifierType => {
  return (
    type === "percentage_increase" ||
    type === "percentage_decrease" ||
    type === "fixed_increase" ||
    type === "fixed_decrease"
  );
};

export const roundMoney = (value: number) => {
  return Math.round(value * 100) / 100;
};

export const applyPriceModifier = (
  basePrice: number,
  type: string,
  value: number,
  enabled: boolean,
) => {
  const normalizedBasePrice = Number.isFinite(basePrice) ? basePrice : 0;
  const normalizedValue = Number.isFinite(value) ? value : 0;

  if (!enabled || !isModifierType(type) || normalizedValue === 0) {
    return Math.max(0, roundMoney(normalizedBasePrice));
  }

  let modifier = 0;
  switch (type) {
    case "percentage_increase":
      modifier = (normalizedBasePrice * normalizedValue) / 100;
      break;
    case "percentage_decrease":
      modifier = -((normalizedBasePrice * normalizedValue) / 100);
      break;
    case "fixed_increase":
      modifier = normalizedValue;
      break;
    case "fixed_decrease":
      modifier = -normalizedValue;
      break;
  }

  return Math.max(0, roundMoney(normalizedBasePrice + modifier));
};

export const getAdminSettingsOrDefaults = async (): Promise<CheckoutPricingSettings> => {
  const settings = await prisma.adminSettings.findFirst();
  if (!settings) return DEFAULT_SETTINGS;

  return {
    globalPriceModifierType:
      settings.globalPriceModifierType ?? DEFAULT_SETTINGS.globalPriceModifierType,
    globalPriceModifierValue:
      settings.globalPriceModifierValue ?? DEFAULT_SETTINGS.globalPriceModifierValue,
    globalPriceModifierEnabled:
      settings.globalPriceModifierEnabled ?? DEFAULT_SETTINGS.globalPriceModifierEnabled,
    userSellModifierType:
      settings.userSellModifierType ?? DEFAULT_SETTINGS.userSellModifierType,
    userSellModifierValue:
      settings.userSellModifierValue ?? DEFAULT_SETTINGS.userSellModifierValue,
    userSellModifierEnabled:
      settings.userSellModifierEnabled ?? DEFAULT_SETTINGS.userSellModifierEnabled,
    marketModifierType:
      settings.marketModifierType ?? DEFAULT_SETTINGS.marketModifierType,
    marketModifierValue:
      settings.marketModifierValue ?? DEFAULT_SETTINGS.marketModifierValue,
    marketModifierEnabled:
      settings.marketModifierEnabled ?? DEFAULT_SETTINGS.marketModifierEnabled,
    minimumUserSellPrice:
      settings.minimumUserSellPrice ?? DEFAULT_SETTINGS.minimumUserSellPrice,
    manualTransferEnabled:
      settings.manualTransferEnabled ?? DEFAULT_SETTINGS.manualTransferEnabled,
  };
};

export const getBotCheckoutPrice = (
  basePrice: number,
  settings: CheckoutPricingSettings,
) => {
  return applyPriceModifier(
    basePrice,
    settings.globalPriceModifierType,
    settings.globalPriceModifierValue,
    settings.globalPriceModifierEnabled,
  );
};

export const getMarketCheckoutPrice = (
  basePrice: number,
  settings: CheckoutPricingSettings,
) => {
  return applyPriceModifier(
    basePrice,
    settings.marketModifierType,
    settings.marketModifierValue,
    settings.marketModifierEnabled,
  );
};

export const getUserSellCheckoutPrice = (
  basePrice: number,
  settings: CheckoutPricingSettings,
) => {
  return applyPriceModifier(
    basePrice,
    settings.userSellModifierType,
    settings.userSellModifierValue,
    settings.userSellModifierEnabled,
  );
};
