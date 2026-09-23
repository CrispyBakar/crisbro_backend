-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_user_id_fkey";

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
