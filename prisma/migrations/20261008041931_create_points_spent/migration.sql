/*
  Warnings:

  - A unique constraint covering the columns `[customer_id,promo_code_id]` on the table `RedeemTransaction` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "RedeemTransaction_customer_id_idx";

-- AlterTable
ALTER TABLE "RedeemTransaction" ADD COLUMN     "points_spent" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "RedeemTransaction_customer_id_promo_code_id_key" ON "RedeemTransaction"("customer_id", "promo_code_id");
