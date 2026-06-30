-- Add paint index metadata used for Doppler/Gamma Doppler variant pricing.
ALTER TABLE "StoreItem" ADD COLUMN "paintIndex" INTEGER;
ALTER TABLE "UserInventoryItem" ADD COLUMN "paintIndex" INTEGER;
