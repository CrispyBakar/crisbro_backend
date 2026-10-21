/*
  Warnings:

  - You are about to drop the column `is_default` on the `Banner` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "BannerType" AS ENUM ('default', 'temporary');

-- CreateEnum
CREATE TYPE "BannerStatus" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "Banner" DROP COLUMN "is_default",
ADD COLUMN     "end_date" TIMESTAMP(3),
ADD COLUMN     "start_date" TIMESTAMP(3),
ADD COLUMN     "status" "BannerStatus" NOT NULL DEFAULT 'inactive',
ADD COLUMN     "type" "BannerType" NOT NULL DEFAULT 'default';
