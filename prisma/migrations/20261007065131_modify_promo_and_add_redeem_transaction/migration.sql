-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('general_voucher', 'loyalty_voucher');

-- AlterTable
ALTER TABLE "Promo" ADD COLUMN     "promo_type" "PromoType" NOT NULL DEFAULT 'loyalty_voucher',
ADD COLUMN     "terms_conditions" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "RedeemTransaction" (
    "redeem_transaction_id" TEXT NOT NULL,
    "promo_code_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedeemTransaction_pkey" PRIMARY KEY ("redeem_transaction_id")
);

-- CreateIndex
CREATE INDEX "RedeemTransaction_promo_code_id_idx" ON "RedeemTransaction"("promo_code_id");

-- CreateIndex
CREATE INDEX "RedeemTransaction_customer_id_idx" ON "RedeemTransaction"("customer_id");

-- AddForeignKey
ALTER TABLE "RedeemTransaction" ADD CONSTRAINT "RedeemTransaction_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "PromoCode"("promo_code_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemTransaction" ADD CONSTRAINT "RedeemTransaction_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
