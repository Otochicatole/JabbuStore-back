ALTER TABLE "AdminSettings" ADD COLUMN "catalogFilterEquipmentEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminSettings" ADD COLUMN "catalogFilterPassesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminSettings" ADD COLUMN "catalogFilterKeysEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminSettings" ADD COLUMN "catalogFilterGiftsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminSettings" ADD COLUMN "catalogFilterTagsEnabled" BOOLEAN NOT NULL DEFAULT false;
