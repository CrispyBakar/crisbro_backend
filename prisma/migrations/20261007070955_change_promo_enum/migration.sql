-- AlterEnum
-- Rename the values in place so existing rows (and the column default) keep their meaning.
ALTER TYPE "PromoType" RENAME VALUE 'general_voucher' TO 'general_promo';
ALTER TYPE "PromoType" RENAME VALUE 'loyalty_voucher' TO 'loyalty_promo';

-- AlterTable
ALTER TABLE "Promo" ALTER COLUMN "promo_type" SET DEFAULT 'loyalty_promo';
