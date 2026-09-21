-- AlterTable
ALTER TABLE "LoyaltyProduct" ADD COLUMN     "image_url" TEXT;

-- CreateIndex
CREATE INDEX "LoyaltyProduct_runchise_loyalty_product_id_idx" ON "LoyaltyProduct"("runchise_loyalty_product_id");

-- CreateIndex
CREATE INDEX "LoyaltyProduct_runchise_product_id_idx" ON "LoyaltyProduct"("runchise_product_id");

-- CreateIndex
CREATE INDEX "LoyaltyProduct_product_name_idx" ON "LoyaltyProduct"("product_name");
