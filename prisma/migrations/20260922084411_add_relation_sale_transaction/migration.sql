-- Make location_id nullable
ALTER TABLE "SaleTransaction" ALTER COLUMN "location_id" DROP NOT NULL;

-- Clear references to locations that no longer exist
UPDATE "SaleTransaction" st SET "location_id" = NULL
WHERE st."location_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Location" l WHERE l."location_id" = st."location_id");

-- CreateIndex
CREATE INDEX "SaleTransaction_location_id_idx" ON "SaleTransaction"("location_id");

-- CreateIndex
CREATE INDEX "SaleTransaction_runchise_id_idx" ON "SaleTransaction"("runchise_id");

-- AddForeignKey
ALTER TABLE "SaleTransaction" ADD CONSTRAINT "SaleTransaction_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
