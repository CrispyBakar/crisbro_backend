-- AlterEnum
ALTER TYPE "UserBirthdayStatus" ADD VALUE IF NOT EXISTS 'expired_unclaimed';
ALTER TYPE "UserBirthdayStatus" ADD VALUE IF NOT EXISTS 'expired_redeem_timeout';