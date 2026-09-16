/*
  Warnings:

  - Added the required column `customer_id` to the `CustomerPointHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CustomerPointHistory" ADD COLUMN     "customer_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "CustomerPointHistory_runchise_id_idx" ON "CustomerPointHistory"("runchise_id");

-- CreateIndex
CREATE INDEX "CustomerPointHistory_customer_id_idx" ON "CustomerPointHistory"("customer_id");

-- AddForeignKey
ALTER TABLE "CustomerPointHistory" ADD CONSTRAINT "CustomerPointHistory_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
