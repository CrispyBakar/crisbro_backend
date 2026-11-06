UPDATE "UserBirthdayTreat"
SET status = 'expired_unclaimed'
WHERE status = 'expired';
