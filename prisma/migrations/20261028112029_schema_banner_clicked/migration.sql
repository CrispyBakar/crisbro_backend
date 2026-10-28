/*
  Warnings:

  - The values [temporary] on the enum `BannerType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "RedirectType" AS ENUM ('internal', 'external');

-- AlterEnum
BEGIN;
CREATE TYPE "BannerType_new" AS ENUM ('default', 'campaign');
ALTER TABLE "public"."Banner" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Banner" ALTER COLUMN "type" TYPE "BannerType_new" USING (CASE WHEN "type"::text = 'temporary' THEN 'campaign' ELSE "type"::text END)::"BannerType_new";
ALTER TYPE "BannerType" RENAME TO "BannerType_old";
ALTER TYPE "BannerType_new" RENAME TO "BannerType";
DROP TYPE "public"."BannerType_old";
ALTER TABLE "Banner" ALTER COLUMN "type" SET DEFAULT 'default';
COMMIT;

-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "redirect_type" "RedirectType" DEFAULT 'internal',
ADD COLUMN     "url" TEXT;

-- CreateTable
CREATE TABLE "BannerClicked" (
    "banner_clicked_id" TEXT NOT NULL,
    "banner_id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerClicked_pkey" PRIMARY KEY ("banner_clicked_id")
);
