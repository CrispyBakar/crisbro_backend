-- AlterEnum
ALTER TYPE "UserBirthdayStatus" ADD VALUE IF NOT EXISTS 'expired_unclaimed';
ALTER TYPE "UserBirthdayStatus" ADD VALUE IF NOT EXISTS 'expired_redeem_timeout';

-- Update existing records with status 'expired' to 'expired_unclaimed'
-- (migrasi dari lama ke baru)
UPDATE "UserBirthdayTreat" SET status = 'expired_unclaimed' WHERE status = 'expired';

-- Note: Value 'expired' tidak bisa di-drop langsung jika ada constraint.
-- Jika perlu bersihkan, lakukan manual setelah memastikan tidak ada data dengan status 'expired'.