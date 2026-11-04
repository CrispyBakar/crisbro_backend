-- CreateEnum
CREATE TYPE "UserBirthdayStatus" AS ENUM ('pending', 'claimed', 'expired', 'failed');

-- CreateTable
CREATE TABLE "UserBirthdayTreat" (
    "user_birthday_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "birthday_date" DATE NOT NULL,
    "treat_year" INTEGER NOT NULL,
    "promo_code_id" TEXT NOT NULL,
    "status" "UserBirthdayStatus" NOT NULL DEFAULT 'pending',
    "claimed_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBirthdayTreat_pkey" PRIMARY KEY ("user_birthday_id")
);
