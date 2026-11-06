/*
  Warnings:

  - The values [expired] on the enum `UserBirthdayStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "RedeemedType" AS ENUM ('loyalty', 'birthday');

-- AlterEnum
BEGIN;
CREATE TYPE "UserBirthdayStatus_new" AS ENUM ('pending', 'claimed', 'expired_unclaimed', 'expired_redeem_timeout', 'failed');
ALTER TABLE "public"."UserBirthdayTreat" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "UserBirthdayTreat" ALTER COLUMN "status" TYPE "UserBirthdayStatus_new" USING ("status"::text::"UserBirthdayStatus_new");
ALTER TYPE "UserBirthdayStatus" RENAME TO "UserBirthdayStatus_old";
ALTER TYPE "UserBirthdayStatus_new" RENAME TO "UserBirthdayStatus";
DROP TYPE "public"."UserBirthdayStatus_old";
ALTER TABLE "UserBirthdayTreat" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;

-- AlterTable
ALTER TABLE "RedeemTransaction" ADD COLUMN     "redeemed_type" "RedeemedType" NOT NULL DEFAULT 'loyalty';
