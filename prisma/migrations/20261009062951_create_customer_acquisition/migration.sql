-- CreateTable
CREATE TABLE "CustomerAcquisition" (
    "customer_acquisition_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "captured_via" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAcquisition_pkey" PRIMARY KEY ("customer_acquisition_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAcquisition_customer_id_key" ON "CustomerAcquisition"("customer_id");

-- CreateIndex
CREATE INDEX "CustomerAcquisition_customer_id_idx" ON "CustomerAcquisition"("customer_id");

-- AddForeignKey
ALTER TABLE "CustomerAcquisition" ADD CONSTRAINT "CustomerAcquisition_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("customer_id") ON DELETE NO ACTION ON UPDATE CASCADE;
