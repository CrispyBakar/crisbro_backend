-- CreateTable
CREATE TABLE "Products" (
    "product_id" TEXT NOT NULL,
    "runchise_id" INTEGER,
    "name" TEXT,
    "sku" TEXT,
    "upc" TEXT,
    "description" TEXT,
    "internal_price" TEXT,
    "sell_price" TEXT,
    "status" TEXT,
    "product_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Products_pkey" PRIMARY KEY ("product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Products_runchise_id_key" ON "Products"("runchise_id");

-- CreateIndex
CREATE INDEX "Products_runchise_id_idx" ON "Products"("runchise_id");

-- CreateIndex
CREATE INDEX "Products_name_idx" ON "Products"("name");
