/*
  Warnings:

  - You are about to drop the column `imageData` on the `Banner` table. All the data in the column will be lost.
  - You are about to drop the column `mimeType` on the `Banner` table. All the data in the column will be lost.
  - Added the required column `image_data` to the `Banner` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mime_type` to the `Banner` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Banner" DROP COLUMN "imageData",
DROP COLUMN "mimeType",
ADD COLUMN     "image_data" BYTEA NOT NULL,
ADD COLUMN     "mime_type" TEXT NOT NULL;
