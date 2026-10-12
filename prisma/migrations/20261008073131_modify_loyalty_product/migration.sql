/*
  Warnings:

  - A unique constraint covering the columns `[product_id]` on the table `LoyaltyProduct` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `product_id` to the `LoyaltyProduct` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LoyaltyProduct" ADD COLUMN     "product_id" TEXT NOT NULL,
ADD COLUMN     "promo_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProduct_product_id_key" ON "LoyaltyProduct"("product_id");

-- CreateIndex
CREATE INDEX "LoyaltyProduct_product_id_idx" ON "LoyaltyProduct"("product_id");

-- CreateIndex
CREATE INDEX "LoyaltyProduct_promo_id_idx" ON "LoyaltyProduct"("promo_id");

-- AddForeignKey
ALTER TABLE "LoyaltyProduct" ADD CONSTRAINT "LoyaltyProduct_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyProduct" ADD CONSTRAINT "LoyaltyProduct_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "Promo"("promo_id") ON DELETE SET NULL ON UPDATE CASCADE;
