-- AlterTable
ALTER TABLE "SaleTransaction" ADD COLUMN     "available_point" INTEGER,
ADD COLUMN     "earned_pont" INTEGER,
ADD COLUMN     "products" JSONB,
ADD COLUMN     "redeemed_point" TEXT,
ADD COLUMN     "total_point" INTEGER;
