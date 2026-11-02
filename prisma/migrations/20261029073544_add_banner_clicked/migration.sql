-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "dine_in_url" TEXT;

-- CreateIndex
CREATE INDEX "BannerClicked_banner_id_idx" ON "BannerClicked"("banner_id");

-- CreateIndex
CREATE INDEX "BannerClicked_user_id_idx" ON "BannerClicked"("user_id");

-- AddForeignKey
ALTER TABLE "BannerClicked" ADD CONSTRAINT "BannerClicked_banner_id_fkey" FOREIGN KEY ("banner_id") REFERENCES "Banner"("banner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerClicked" ADD CONSTRAINT "BannerClicked_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
