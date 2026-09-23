-- AlterForeignKey
ALTER TABLE "SaleTransaction" DROP CONSTRAINT "SaleTransaction_location_id_fkey";

-- AddForeignKey
ALTER TABLE "SaleTransaction" ADD CONSTRAINT "SaleTransaction_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("location_id") ON DELETE SET NULL ON UPDATE CASCADE;
