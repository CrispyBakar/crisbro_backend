-- Runchise mengirim point_type di luar enum (mis. "adjustment_point_from_expired"),
-- jadi kolom diubah ke TEXT. Data lama dikonversi, bukan di-drop.
ALTER TABLE "CustomerPointHistory" ALTER COLUMN "point_type" SET DATA TYPE TEXT USING "point_type"::TEXT;

-- DropEnum
DROP TYPE "PointType";
