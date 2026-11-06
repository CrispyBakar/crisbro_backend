const { birthdayQueue } = require("../../lib/queue");

// Setiap hari jam 00:00 WIB (midnight) - saat tanggal berganti,
// proses expired treats lama, berikan treat baru, lalu kirim ucapan.
const CUSTOMER_BIRTHDAY_PATTERN = "0 0 * * *";
const CUSTOMER_BIRTHDAY_TZ = "Asia/Jakarta";

async function registerCustomerBirthdayScheduler() {
  // The cron is expressed in UTC; birthday selection still uses the WIB date.
  return birthdayQueue.upsertJobScheduler(
    "customer-birthday-daily",
    { every: 30_000, tz: CUSTOMER_BIRTHDAY_TZ },
    {
      name: "customer-birthday",
      data: {},
      opts: {
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );
}

module.exports = {
  registerCustomerBirthdayScheduler,
  CUSTOMER_BIRTHDAY_PATTERN,
  CUSTOMER_BIRTHDAY_TZ,
};
