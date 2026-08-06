-- Remove BRL from DisplayCurrency enum
-- For SQLite, enums are stored as TEXT so no schema change is needed.
-- Prisma client will enforce the new enum values at the application level.

-- Migrate any existing users with BRL preference to USD
UPDATE "User" SET "preferredCurrency" = 'USD' WHERE "preferredCurrency" = 'BRL';
