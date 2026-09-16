-- CreateEnum
CREATE TYPE "PointType" AS ENUM ('manual_adjustment', 'earned', 'redeemed');

-- CreateTable
CREATE TABLE "CustomerPointHistory" (
    "customer_point_history" TEXT NOT NULL,
    "runchise_id" INTEGER,
    "customer_point_id" INTEGER,
    "point_type" "PointType",
    "point_snapshot" INTEGER,
    "point" INTEGER,
    "sale_transaction_uuid" TEXT,
    "sale_transaction_id" INTEGER,
    "sales_return_id" INTEGER,
    "void_by" TEXT,
    "void_id" INTEGER,
    "void_reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "created_by_id" INTEGER,
    "location_id" INTEGER,
    "sales_no" INTEGER,
    "expired_point" INTEGER,
    "expired_at" TIMESTAMP(3),
    "customer_expired_point_id" INTEGER,
    "customer_order_uuid" TEXT,
    "formatted_created_at" TIMESTAMP(3),
    "issued_at_time" TIMESTAMP(3),
    "point_type_description" TEXT,
    "channel" TEXT,

    CONSTRAINT "CustomerPointHistory_pkey" PRIMARY KEY ("customer_point_history")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPointHistory_runchise_id_key" ON "CustomerPointHistory"("runchise_id");
