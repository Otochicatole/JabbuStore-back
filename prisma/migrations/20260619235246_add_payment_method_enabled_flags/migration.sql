-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdminSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "globalPriceModifierType" TEXT NOT NULL DEFAULT 'percentage_increase',
    "globalPriceModifierValue" REAL NOT NULL DEFAULT 0.0,
    "globalPriceModifierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "userSellModifierType" TEXT NOT NULL DEFAULT 'percentage_decrease',
    "userSellModifierValue" REAL NOT NULL DEFAULT 0.0,
    "userSellModifierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "marketModifierType" TEXT NOT NULL DEFAULT 'percentage_increase',
    "marketModifierValue" REAL NOT NULL DEFAULT 0.0,
    "marketModifierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minimumUserSellPrice" REAL NOT NULL DEFAULT 1.0,
    "webhookUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "mercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paypalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "nowpaymentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "manualTransferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "manualBankAlias" TEXT,
    "manualBankCbu" TEXT,
    "manualBankHolder" TEXT,
    "manualBankInstructions" TEXT,
    "manualCryptoAddress" TEXT,
    "manualCryptoNetwork" TEXT,
    "manualCryptoInstructions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AdminSettings" ("createdAt", "currency", "globalPriceModifierEnabled", "globalPriceModifierType", "globalPriceModifierValue", "id", "manualBankAlias", "manualBankCbu", "manualBankHolder", "manualBankInstructions", "manualCryptoAddress", "manualCryptoInstructions", "manualCryptoNetwork", "manualTransferEnabled", "marketModifierEnabled", "marketModifierType", "marketModifierValue", "minimumUserSellPrice", "updatedAt", "userSellModifierEnabled", "userSellModifierType", "userSellModifierValue", "webhookUrl") SELECT "createdAt", "currency", "globalPriceModifierEnabled", "globalPriceModifierType", "globalPriceModifierValue", "id", "manualBankAlias", "manualBankCbu", "manualBankHolder", "manualBankInstructions", "manualCryptoAddress", "manualCryptoInstructions", "manualCryptoNetwork", "manualTransferEnabled", "marketModifierEnabled", "marketModifierType", "marketModifierValue", "minimumUserSellPrice", "updatedAt", "userSellModifierEnabled", "userSellModifierType", "userSellModifierValue", "webhookUrl" FROM "AdminSettings";
DROP TABLE "AdminSettings";
ALTER TABLE "new_AdminSettings" RENAME TO "AdminSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
